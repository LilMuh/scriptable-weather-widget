# 温度 + 降雨双细线时间轴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有中号 Scriptable 天气组件下半部分,新增一块通栏曲线区,用两条 1.5px 平滑细线展示当天 24 小时的温度与降雨概率走势。

**Architecture:** 全部代码写进单文件 `src/weather-widget.js`(bootstrap 只下载这一个 entry 文件并 `importModule`,不能拆模块)。把所有纯计算(数据提取、null 插值、当前时刻、坐标缩放、Catmull-Rom 平滑、插值取点)抽成**无 Scriptable 依赖的纯函数**并 `module.exports` 出来,用 Node 内置 `node:test` 断言;曲线绘制用 `DrawContext` 画成一张图 `addImage`,这部分靠真机视觉验证。

**Tech Stack:** JavaScript (CommonJS)、Scriptable 运行时(`DrawContext`/`Path`/`Color`/`Size`/`Point`/`Rect`)、Node.js 内置测试(`node --test`,无第三方依赖)。

## Global Constraints

- **单文件核心**:所有实现改动只落在 `src/weather-widget.js`;不得新建被它 `require` 的运行时模块(device 上没有本地文件可 require)。测试文件 `test/*.test.js` 只在 Node 侧,不参与设备加载。
- **CommonJS 导出**:沿用文件底部 `module.exports = { ... }` 形式,新增纯函数追加到导出对象。
- **顶层零 Scriptable 依赖**:新增代码里对 `DrawContext`/`Color`/`Path` 等 Scriptable 全局的引用只能出现在函数体内,绝不能在模块顶层求值(否则 `node --test` 里 `require` 会崩)。
- **无第三方依赖**:测试用 Node ≥ 18 内置 `node:test` + `node:assert/strict`;项目无 `package.json`,用 `node --test test/weather-widget.test.js` 运行。
- **保留现状**:蓝色日/夜渐变背景、header、大温度、三行指标(体感/最高最低/降雨%)全部原样保留;曲线区是新增。不改 `bootstrap/Weather.js`。
- **不上传**:实现期间只做**本地 git commit**,**不 push**;**不动 `version.json` / `CORE_VERSION`**(改版本号并 push 才会触发设备自动更新,那是用户后续手动的部署步骤)。设计文档 `docs/superpowers/specs/2026-07-28-*.md` 不加入任何 commit。
- **配色/常量**(verbatim):温度线 `#FFC24B`、降雨线 `#FFFFFF`、now 竖线白色透明度 `0.25`、线宽 `1.5`、`CHART_W=320`、`CHART_H=46`、`CHART_PAD_Y=5`。
- **降雨线固定 0–100 映射**;温度线按当天 24 值 min/max 归一化;24 采样点横向铺满 `x(i)=(i/(n-1))*W`。

---

## 文件结构

- **Modify:** `src/weather-widget.js`
  - 新增纯函数:`fillNullsLinear`、`extractHourly`、`parseWeather`、`currentDayFraction`、`tempFrac`、`chartPoints`、`catmullRomToBezier`、`valueAtIndex`(全部导出)。
  - 新增绘制函数(Scriptable-only,不导出):`strokeCurve`、`fillDot`、`buildTimelineImage`,以及若干 `CHART_*`/`COLOR_*` 常量。
  - 改造:`fetchWeather()` 追加 hourly 请求字段并改为调用 `parseWeather(data)`;`render(ctx)` 尾部插入曲线区。
- **Create:** `test/weather-widget.test.js` — Node 侧纯函数单测。

---

## Task 1: 测试脚手架 + `fillNullsLinear`

**Files:**
- Modify: `src/weather-widget.js`(新增 `fillNullsLinear` 并加入 `module.exports`)
- Test: `test/weather-widget.test.js`(新建)

**Interfaces:**
- Produces: `fillNullsLinear(arr: (number|null)[]): number[]` — 用左右最近的非 null 值线性插值填补 null;首/尾 null 取最近非 null;整段全 null 返回等长的 0 数组。

- [ ] **Step 1: 写失败测试**

新建 `test/weather-widget.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const w = require("../src/weather-widget.js");

test("fillNullsLinear 内部线性插值", () => {
  assert.deepEqual(w.fillNullsLinear([1, null, 3]), [1, 2, 3]);
  assert.deepEqual(w.fillNullsLinear([1, null, null, 4]), [1, 2, 3, 4]);
});

test("fillNullsLinear 首尾 null 取最近非 null", () => {
  assert.deepEqual(w.fillNullsLinear([null, 2, null]), [2, 2, 2]);
});

test("fillNullsLinear 全 null 返回 0", () => {
  assert.deepEqual(w.fillNullsLinear([null, null]), [0, 0]);
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `node --test test/weather-widget.test.js`
Expected: FAIL(`w.fillNullsLinear is not a function`)

- [ ] **Step 3: 实现 `fillNullsLinear`**

在 `src/weather-widget.js` 里(位置紧接 `describeWeather` 之后即可,任意顶层函数区)新增:

```js
// ---------------------------------------------------------------------------
// 小时序列的纯计算(无 Scriptable 依赖,便于在 Node 里测)
// ---------------------------------------------------------------------------
function fillNullsLinear(arr) {
  const n = arr.length;
  const out = arr.slice();
  const known = [];
  for (let i = 0; i < n; i++) if (out[i] != null) known.push(i);
  if (known.length === 0) return out.map(() => 0);
  for (let i = 0; i < n; i++) {
    if (out[i] != null) continue;
    let left = null;
    let right = null;
    for (let k = 0; k < known.length; k++) {
      if (known[k] < i) left = known[k];
      if (known[k] > i && right === null) right = known[k];
    }
    if (left === null) out[i] = arr[right];
    else if (right === null) out[i] = arr[left];
    else out[i] = arr[left] + (arr[right] - arr[left]) * ((i - left) / (right - left));
  }
  return out;
}
```

把文件底部的导出改为:

```js
module.exports = { buildWidget, CORE_VERSION, fillNullsLinear };
```

- [ ] **Step 4: 运行,确认通过**

Run: `node --test test/weather-widget.test.js`
Expected: PASS(3 个用例)

- [ ] **Step 5: 本地提交(不 push)**

```bash
git add src/weather-widget.js test/weather-widget.test.js
git commit -m "test: 新增小时序列 null 线性插值 fillNullsLinear"
```

---

## Task 2: `extractHourly`(从 API JSON 提取小时数组)

**Files:**
- Modify: `src/weather-widget.js`
- Test: `test/weather-widget.test.js`

**Interfaces:**
- Consumes: `fillNullsLinear`
- Produces: `extractHourly(data: object): { hourlyTemp: number[], hourlyProb: number[], utcOffsetSeconds: number }` — 取 `data.hourly` 前 24 条;温度走 `fillNullsLinear`;概率 null→0;`utcOffsetSeconds` 缺失时为 0。

- [ ] **Step 1: 写失败测试**

在 `test/weather-widget.test.js` 追加:

```js
test("extractHourly 截前24 + 概率null转0 + 温度插值", () => {
  const data = {
    utc_offset_seconds: -14400,
    hourly: {
      temperature_2m: Array.from({ length: 26 }, (_, i) => i),   // 0..25,取前24
      precipitation_probability: [null, 50].concat(Array(24).fill(10)),
    },
  };
  const r = w.extractHourly(data);
  assert.equal(r.hourlyTemp.length, 24);
  assert.equal(r.hourlyProb.length, 24);
  assert.equal(r.hourlyTemp[0], 0);
  assert.equal(r.hourlyProb[0], 0);      // null -> 0
  assert.equal(r.hourlyProb[1], 50);
  assert.equal(r.utcOffsetSeconds, -14400);
});

test("extractHourly 缺 utc_offset 时为 0", () => {
  const r = w.extractHourly({ hourly: { temperature_2m: [1], precipitation_probability: [1] } });
  assert.equal(r.utcOffsetSeconds, 0);
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `node --test test/weather-widget.test.js`
Expected: FAIL(`w.extractHourly is not a function`)

- [ ] **Step 3: 实现 `extractHourly`**

在 `fillNullsLinear` 之后新增:

```js
function extractHourly(data) {
  const h = (data && data.hourly) || {};
  const temps = (h.temperature_2m || []).slice(0, 24);
  const probs = (h.precipitation_probability || []).slice(0, 24);
  return {
    hourlyTemp: fillNullsLinear(temps),
    hourlyProb: probs.map((v) => (v == null ? 0 : v)),
    utcOffsetSeconds: typeof (data && data.utc_offset_seconds) === "number" ? data.utc_offset_seconds : 0,
  };
}
```

导出追加 `extractHourly`:

```js
module.exports = { buildWidget, CORE_VERSION, fillNullsLinear, extractHourly };
```

- [ ] **Step 4: 运行,确认通过**

Run: `node --test test/weather-widget.test.js`
Expected: PASS

- [ ] **Step 5: 本地提交**

```bash
git add src/weather-widget.js test/weather-widget.test.js
git commit -m "feat: extractHourly 从 Open-Meteo 提取24小时温度/降雨概率"
```

---

## Task 3: `parseWeather` + `fetchWeather` 扩展(请求 hourly 字段)

**Files:**
- Modify: `src/weather-widget.js:104-132`(`fetchWeather`)
- Test: `test/weather-widget.test.js`

**Interfaces:**
- Consumes: `extractHourly`
- Produces: `parseWeather(data: object): { temp, feelsLike, code, isDay, tempMax, tempMin, rainChance, hourlyTemp, hourlyProb, utcOffsetSeconds, fetchedAt }` — 纯函数,把 Open-Meteo 响应转成 weather 对象;缺 `current`/`daily`/`hourly` 抛错。`fetchWeather` 负责发请求后调用它。

- [ ] **Step 1: 写失败测试**

追加:

```js
test("parseWeather 组装 weather 对象含小时数组", () => {
  const data = {
    utc_offset_seconds: 0,
    current: { temperature_2m: 20, apparent_temperature: 19, weather_code: 2, is_day: 1 },
    daily: { temperature_2m_max: [26], temperature_2m_min: [18], precipitation_probability_max: [46] },
    hourly: {
      temperature_2m: Array(24).fill(20),
      precipitation_probability: Array(24).fill(30),
    },
  };
  const wx = w.parseWeather(data);
  assert.equal(wx.temp, 20);
  assert.equal(wx.tempMax, 26);
  assert.equal(wx.rainChance, 46);
  assert.equal(wx.isDay, true);
  assert.equal(wx.hourlyTemp.length, 24);
  assert.equal(wx.hourlyProb.length, 24);
  assert.equal(wx.utcOffsetSeconds, 0);
});

test("parseWeather 缺字段抛错", () => {
  assert.throws(() => w.parseWeather({ current: {}, daily: {} }));  // 无 hourly
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `node --test test/weather-widget.test.js`
Expected: FAIL(`w.parseWeather is not a function`)

- [ ] **Step 3: 新增 `parseWeather`,改造 `fetchWeather`**

新增纯函数(放在 `extractHourly` 之后):

```js
function parseWeather(data) {
  if (!data || !data.current || !data.daily || !data.hourly) {
    throw new Error("天气接口返回格式异常");
  }
  const { hourlyTemp, hourlyProb, utcOffsetSeconds } = extractHourly(data);
  return {
    temp: data.current.temperature_2m,
    feelsLike: data.current.apparent_temperature,
    code: data.current.weather_code,
    isDay: data.current.is_day === 1,
    tempMax: data.daily.temperature_2m_max[0],
    tempMin: data.daily.temperature_2m_min[0],
    rainChance: data.daily.precipitation_probability_max[0],
    hourlyTemp,
    hourlyProb,
    utcOffsetSeconds,
    fetchedAt: Date.now(),
  };
}
```

把 `fetchWeather` 改成(请求里加 `hourly=...`,body 用 `parseWeather`):

```js
async function fetchWeather(lat, lon) {
  const params = [
    `latitude=${lat.toFixed(4)}`,
    `longitude=${lon.toFixed(4)}`,
    "current=temperature_2m,apparent_temperature,weather_code,is_day",
    "daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    "hourly=precipitation_probability,temperature_2m",
    "timezone=auto",
    "forecast_days=1",
  ].join("&");

  const req = new Request(`https://api.open-meteo.com/v1/forecast?${params}`);
  req.timeoutInterval = 12;
  const data = await req.loadJSON();
  return parseWeather(data);
}
```

导出追加 `parseWeather`:

```js
module.exports = { buildWidget, CORE_VERSION, fillNullsLinear, extractHourly, parseWeather };
```

- [ ] **Step 4: 运行,确认通过**

Run: `node --test test/weather-widget.test.js`
Expected: PASS

- [ ] **Step 5: 本地提交**

```bash
git add src/weather-widget.js test/weather-widget.test.js
git commit -m "feat: fetchWeather 请求 hourly 字段并抽出 parseWeather"
```

---

## Task 4: `currentDayFraction`(时区感知的当前时刻)

**Files:**
- Modify: `src/weather-widget.js`
- Test: `test/weather-widget.test.js`

**Interfaces:**
- Produces: `currentDayFraction(nowMs: number, utcOffsetSeconds: number): number` — 返回当前时刻在 location 本地一天中的位置,范围 `[0, 24)`。负时区正确处理。

- [ ] **Step 1: 写失败测试**

追加:

```js
test("currentDayFraction 负时区正确", () => {
  // UTC 2026-07-28T04:30:00Z,多伦多 -4h → 本地 00:30 → 0.5
  const ms = Date.UTC(2026, 6, 28, 4, 30, 0);
  assert.ok(Math.abs(w.currentDayFraction(ms, -14400) - 0.5) < 1e-6);
});

test("currentDayFraction 跨零点回绕", () => {
  // UTC 02:00,-4h → 本地前一天 22:00 → 22.0
  const ms = Date.UTC(2026, 6, 28, 2, 0, 0);
  assert.ok(Math.abs(w.currentDayFraction(ms, -14400) - 22.0) < 1e-6);
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `node --test test/weather-widget.test.js`
Expected: FAIL(`w.currentDayFraction is not a function`)

- [ ] **Step 3: 实现**

新增:

```js
function currentDayFraction(nowMs, utcOffsetSeconds) {
  const localSec = (((nowMs / 1000 + utcOffsetSeconds) % 86400) + 86400) % 86400;
  return localSec / 3600;
}
```

导出追加 `currentDayFraction`。

- [ ] **Step 4: 运行,确认通过**

Run: `node --test test/weather-widget.test.js`
Expected: PASS

- [ ] **Step 5: 本地提交**

```bash
git add src/weather-widget.js test/weather-widget.test.js
git commit -m "feat: currentDayFraction 按 API 时区推算当前时刻"
```

---

## Task 5: `tempFrac` + `chartPoints`(坐标缩放)

**Files:**
- Modify: `src/weather-widget.js`
- Test: `test/weather-widget.test.js`

**Interfaces:**
- Produces:
  - `tempFrac(temps: number[]): (v: number) => number` — 返回把温度映射到 `[0,1]` 的函数(按 min/max;等值时恒 0.5)。
  - `chartPoints(values: number[], fracFn: (v,i)=>number, W: number, H: number, padY: number): {x:number,y:number}[]` — `x(i)=(i/(n-1))*W`;`y = H - padY - clamp(frac,0,1)*(H-2*padY)`。

- [ ] **Step 1: 写失败测试**

追加:

```js
test("tempFrac 按 min/max 归一化", () => {
  const f = w.tempFrac([10, 20]);
  assert.equal(f(10), 0);
  assert.equal(f(20), 1);
  assert.equal(f(15), 0.5);
  assert.equal(w.tempFrac([5, 5, 5])(5), 0.5);  // 等值防除零
});

test("chartPoints 映射与钳制", () => {
  const pts = w.chartPoints([0, 50, 100], (v) => v / 100, 100, 10, 0);
  assert.deepEqual(pts, [
    { x: 0, y: 10 },
    { x: 50, y: 5 },
    { x: 100, y: 0 },
  ]);
  // 概率>100 被钳到 1(y=0),<0 钳到 0(y=H)
  const c = w.chartPoints([200, -5], (v) => v / 100, 100, 10, 0);
  assert.equal(c[0].y, 0);
  assert.equal(c[1].y, 10);
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `node --test test/weather-widget.test.js`
Expected: FAIL(`w.tempFrac is not a function`)

- [ ] **Step 3: 实现**

新增:

```js
function tempFrac(temps) {
  const min = Math.min.apply(null, temps);
  const max = Math.max.apply(null, temps);
  const span = max - min;
  return function (v) {
    return span === 0 ? 0.5 : (v - min) / span;
  };
}

function chartPoints(values, fracFn, W, H, padY) {
  const n = values.length;
  const usable = H - 2 * padY;
  return values.map(function (v, i) {
    const x = n <= 1 ? 0 : (i / (n - 1)) * W;
    let f = fracFn(v, i);
    if (f < 0) f = 0;
    else if (f > 1) f = 1;
    return { x: x, y: H - padY - f * usable };
  });
}
```

导出追加 `tempFrac`、`chartPoints`。

- [ ] **Step 4: 运行,确认通过**

Run: `node --test test/weather-widget.test.js`
Expected: PASS

- [ ] **Step 5: 本地提交**

```bash
git add src/weather-widget.js test/weather-widget.test.js
git commit -m "feat: tempFrac/chartPoints 温度归一化与坐标映射"
```

---

## Task 6: `catmullRomToBezier`(平滑控制点)

**Files:**
- Modify: `src/weather-widget.js`
- Test: `test/weather-widget.test.js`

**Interfaces:**
- Produces: `catmullRomToBezier(points: {x,y}[]): {p1:{x,y},c1:{x,y},c2:{x,y},p2:{x,y}}[]` — 每对相邻点一段三次贝塞尔,端点用重复端点。控制点公式 `c1=p1+(p2-p0)/6`、`c2=p2-(p3-p1)/6`。

- [ ] **Step 1: 写失败测试**

追加:

```js
test("catmullRomToBezier 共线水平点控制点", () => {
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
  const segs = w.catmullRomToBezier(pts);
  assert.equal(segs.length, 3);
  // 第0段: p0=p1=(0,0), p2=(1,0), p3=(2,0)
  assert.ok(Math.abs(segs[0].c1.x - 1 / 6) < 1e-9);
  assert.ok(Math.abs(segs[0].c2.x - 2 / 3) < 1e-9);
  assert.equal(segs[0].c1.y, 0);
  assert.equal(segs[0].c2.y, 0);
  assert.deepEqual(segs[0].p2, { x: 1, y: 0 });
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `node --test test/weather-widget.test.js`
Expected: FAIL(`w.catmullRomToBezier is not a function`)

- [ ] **Step 3: 实现**

新增:

```js
function catmullRomToBezier(points) {
  const segs = [];
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || points[i + 1];
    segs.push({
      p1: p1,
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p2: p2,
    });
  }
  return segs;
}
```

导出追加 `catmullRomToBezier`。

- [ ] **Step 4: 运行,确认通过**

Run: `node --test test/weather-widget.test.js`
Expected: PASS

- [ ] **Step 5: 本地提交**

```bash
git add src/weather-widget.js test/weather-widget.test.js
git commit -m "feat: catmullRomToBezier 曲线平滑控制点"
```

---

## Task 7: `valueAtIndex`(now 点插值取值)

**Files:**
- Modify: `src/weather-widget.js`
- Test: `test/weather-widget.test.js`

**Interfaces:**
- Produces: `valueAtIndex(points: {x,y}[], idx: number): {x,y}` — 在折线的小数下标 `idx` 处线性插值取点;`idx` 钳到 `[0, n-1]`。用于 now 竖线的 x 与两条线上 now 圆点的坐标。

- [ ] **Step 1: 写失败测试**

追加:

```js
test("valueAtIndex 线性插值与钳制", () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }];
  assert.deepEqual(w.valueAtIndex(pts, 0.5), { x: 5, y: 5 });
  assert.deepEqual(w.valueAtIndex(pts, 1.5), { x: 15, y: 15 });
  assert.deepEqual(w.valueAtIndex(pts, 5), { x: 20, y: 20 });   // 上钳
  assert.deepEqual(w.valueAtIndex(pts, -1), { x: 0, y: 0 });    // 下钳
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `node --test test/weather-widget.test.js`
Expected: FAIL(`w.valueAtIndex is not a function`)

- [ ] **Step 3: 实现**

新增:

```js
function valueAtIndex(points, idx) {
  const n = points.length;
  let c = idx;
  if (c < 0) c = 0;
  else if (c > n - 1) c = n - 1;
  const lo = Math.floor(c);
  const hi = Math.min(n - 1, lo + 1);
  const t = c - lo;
  return {
    x: points[lo].x + (points[hi].x - points[lo].x) * t,
    y: points[lo].y + (points[hi].y - points[lo].y) * t,
  };
}
```

导出追加 `valueAtIndex`。最终导出应为:

```js
module.exports = {
  buildWidget,
  CORE_VERSION,
  fillNullsLinear,
  extractHourly,
  parseWeather,
  currentDayFraction,
  tempFrac,
  chartPoints,
  catmullRomToBezier,
  valueAtIndex,
};
```

- [ ] **Step 4: 运行,确认通过(全部纯函数用例)**

Run: `node --test test/weather-widget.test.js`
Expected: PASS(至此纯函数管线全绿)

- [ ] **Step 5: 本地提交**

```bash
git add src/weather-widget.js test/weather-widget.test.js
git commit -m "feat: valueAtIndex 折线插值取点(now 标记用)"
```

---

## Task 8: 曲线绘制(DrawContext,真机视觉验证)

Scriptable 的 `DrawContext`/`Path` 在 Node 里没有,**此任务不写单测**,靠真机验证 + 前面纯函数已保证坐标正确。

**Files:**
- Modify: `src/weather-widget.js`(新增 `CHART_*`/`COLOR_*` 常量与 `strokeCurve`/`fillDot`/`buildTimelineImage`)

**Interfaces:**
- Consumes: `catmullRomToBezier`、`valueAtIndex`、`tempFrac`、`chartPoints`
- Produces: `buildTimelineImage(hourlyTemp: number[], hourlyProb: number[], nowPos: number): Image` — 画好双线 + now 标记的图片,供 `render()` `addImage`。

- [ ] **Step 1: 新增常量**

在文件"可调参数"区(约 `src/weather-widget.js:14-17`,`GPS_TIMEOUT_MS` 之后)追加:

```js
// --- 曲线时间轴参数 ---------------------------------------------------------
const CHART_W = 320;            // 曲线画布宽(点);若某机型裁切,调这个
const CHART_H = 46;             // 曲线画布高(点)
const CHART_PAD_Y = 5;          // 上下留白
const CHART_LINE_W = 1.5;       // 线宽
const COLOR_TEMP_LINE = "#FFC24B";
const COLOR_RAIN_LINE = "#FFFFFF";
```

- [ ] **Step 2: 新增绘制函数**

放在界面区(`applyBackground` 附近):

```js
/** 沿一组点描一条 Catmull-Rom 平滑曲线 */
function strokeCurve(ctx, points, color, lineWidth) {
  const segs = catmullRomToBezier(points);
  const path = new Path();
  path.move(new Point(points[0].x, points[0].y));
  for (const s of segs) {
    path.addCurve(
      new Point(s.p2.x, s.p2.y),
      new Point(s.c1.x, s.c1.y),
      new Point(s.c2.x, s.c2.y)
    );
  }
  ctx.setStrokeColor(color);
  ctx.setLineWidth(lineWidth);
  ctx.addPath(path);
  ctx.strokePath();
}

/** 实心小圆点 */
function fillDot(ctx, cx, cy, r, color) {
  ctx.setFillColor(color);
  ctx.fillEllipse(new Rect(cx - r, cy - r, r * 2, r * 2));
}

/** 画温度 + 降雨概率双细线 + now 标记,返回图片 */
function buildTimelineImage(hourlyTemp, hourlyProb, nowPos) {
  const W = CHART_W;
  const H = CHART_H;
  const padY = CHART_PAD_Y;

  const tempPts = chartPoints(hourlyTemp, tempFrac(hourlyTemp), W, H, padY);
  const rainPts = chartPoints(hourlyProb, (v) => v / 100, W, H, padY);

  const ctx = new DrawContext();
  ctx.size = new Size(W, H);
  ctx.opaque = false;              // 透出蓝色渐变背景
  ctx.respectScreenScale = true;   // 按设备 scale 渲染,细线锐利

  // 先画降雨(白,底层),再画温度(琥珀,上层)
  strokeCurve(ctx, rainPts, new Color(COLOR_RAIN_LINE, 1), CHART_LINE_W);
  strokeCurve(ctx, tempPts, new Color(COLOR_TEMP_LINE, 1), CHART_LINE_W);

  // now 竖线(淡白)
  const nowX = Math.max(0, Math.min(W, valueAtIndex(tempPts, nowPos).x));
  const line = new Path();
  line.move(new Point(nowX, 0));
  line.addLine(new Point(nowX, H));
  ctx.setStrokeColor(new Color(COLOR_RAIN_LINE, 0.25));
  ctx.setLineWidth(1);
  ctx.addPath(line);
  ctx.strokePath();

  // 两条线在 now 处各一个圆点
  const rd = valueAtIndex(rainPts, nowPos);
  const td = valueAtIndex(tempPts, nowPos);
  fillDot(ctx, rd.x, rd.y, 2, new Color(COLOR_RAIN_LINE, 1));
  fillDot(ctx, td.x, td.y, 2, new Color(COLOR_TEMP_LINE, 1));

  return ctx.getImage();
}
```

- [ ] **Step 3: Node 快速自检(确认没引入顶层崩溃)**

Run: `node --test test/weather-widget.test.js`
Expected: PASS(仍全绿——证明新增 Scriptable 代码都在函数体内,`require` 不受影响)

- [ ] **Step 4: 本地提交**

```bash
git add src/weather-widget.js
git commit -m "feat: DrawContext 绘制温度/降雨双细线时间轴"
```

---

## Task 9: 接入 `render()` + 真机验证

**Files:**
- Modify: `src/weather-widget.js`(`render(ctx)`,约 `:274-313`)

**Interfaces:**
- Consumes: `buildTimelineImage`、`currentDayFraction`;读取 `weather.hourlyTemp`/`weather.hourlyProb`/`weather.utcOffsetSeconds`

- [ ] **Step 1: 在 body 之后插入曲线区**

`render()` 里,现有 `right` 三行指标构建完、`if (notice)` 之前,插入:

```js
  // --- 底部:温度 + 降雨概率 双细线时间轴 ---
  if (
    Array.isArray(weather.hourlyTemp) && weather.hourlyTemp.length >= 2 &&
    Array.isArray(weather.hourlyProb) && weather.hourlyProb.length >= 2
  ) {
    w.addSpacer(6);
    const nowPos = currentDayFraction(Date.now(), weather.utcOffsetSeconds || 0);
    const chartImg = buildTimelineImage(weather.hourlyTemp, weather.hourlyProb, nowPos);
    const imgEl = w.addImage(chartImg);
    imgEl.imageSize = new Size(CHART_W, CHART_H);
    imgEl.centerAlignImage();
  }
```

> 说明:`weather.hourlyTemp` 等来自 `parseWeather`。旧版缓存(升级前写的 `weather.json`)没有这些数组,`if` 守卫会跳过绘制、不崩;下次成功联网后即恢复。

- [ ] **Step 2: 收紧现有间距,给曲线区腾空间**

把三行指标的间距收紧:找到 `right.spacing = 6;`(约 `:298`)改为:

```js
  right.spacing = 4;
```

（若真机上大温度与曲线区仍打架,再把 `bigTemp.font = Font.lightSystemFont(46);` 降到 `42`。先按 46 验证。）

- [ ] **Step 3: Node 回归**

Run: `node --test test/weather-widget.test.js`
Expected: PASS(纯函数不受影响)

- [ ] **Step 4: 真机视觉验证(Scriptable App)**

在 Scriptable 里(本地把改好的 `src/weather-widget.js` 内容临时贴进一个脚本运行,或指向本地文件)运行并 `presentMedium()`,逐项确认:
- [ ] 下半部分出现两条细线:琥珀(温度)+ 白(降雨概率),线条平滑不锯齿。
- [ ] 温度线形态贴合当天走势;降雨线概率高处靠上、低处贴底。
- [ ] now 淡白竖线位置≈当前钟点;两条线在该处各有一个圆点。
- [ ] header / 大温度 / 三行指标未被裁切或挤出边界。
- [ ] 曲线图**左右没被裁切**;若被裁,调小 `CHART_W`(如 300)重试。
- [ ] 切到夜间配色(或等入夜)确认琥珀 + 白在深蓝底上依然清晰。
- [ ] 断网再刷新:走缓存显示、`isStale`,曲线仍能画(用缓存 hourly)。

（若某项不达标,按 Step 2 的备选和 `CHART_W` 常量微调后重验。）

- [ ] **Step 5: 本地提交**

```bash
git add src/weather-widget.js
git commit -m "feat: 组件下半部分接入双细线时间轴"
```

---

## 部署(用户后续手动,本计划不执行)

实现全部完成、真机验证通过后,由**用户决定**是否部署:

1. `CORE_VERSION`(`src/weather-widget.js:12`)与 `version.json` 的 `version` 各加一位。
2. `git push`(= 上传;push 后手机组件下次刷新自动更新)。

在用户明确要求前,**不 push、不改版本号**。

---

## 自查(spec 覆盖 / 占位符 / 类型一致)

- **spec 覆盖**:数据扩展(Task 3)、null 处理(Task 1/2)、时区当前时刻(Task 4)、温度归一化+降雨0–100映射(Task 5)、平滑曲线(Task 6/8)、now 标记(Task 7/8)、下半部分布局(Task 9)、缓存/回退守卫(Task 3/9)、配色常量(Task 8)、验证(Task 1–9 + Task 9 真机清单)、不上传/不改版本(Global Constraints + 部署段)——均有对应任务。
- **占位符**:无 TBD/TODO;所有步骤含可直接落地的代码。
- **类型一致**:`fillNullsLinear→extractHourly→parseWeather` 链条、`tempFrac`/`chartPoints`/`catmullRomToBezier`/`valueAtIndex` 在 Task 8 的 `buildTimelineImage` 中的调用签名与各自定义一致;导出对象在 Task 7 收尾为完整清单。
