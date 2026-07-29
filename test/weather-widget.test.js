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

test("extractHourly 截前24 + 概率null转0 + 温度插值", () => {
  const data = {
    utc_offset_seconds: -14400,
    hourly: {
      temperature_2m: Array.from({ length: 26 }, (_, i) => i),   // 0..25，取前24
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

test("currentDayFraction 负时区正确", () => {
  // UTC 2026-07-28T04:30:00Z，多伦多 -4h → 本地 00:30 → 0.5
  const ms = Date.UTC(2026, 6, 28, 4, 30, 0);
  assert.ok(Math.abs(w.currentDayFraction(ms, -14400) - 0.5) < 1e-6);
});

test("currentDayFraction 跨零点回绕", () => {
  // UTC 02:00，-4h → 本地前一天 22:00 → 22.0
  const ms = Date.UTC(2026, 6, 28, 2, 0, 0);
  assert.ok(Math.abs(w.currentDayFraction(ms, -14400) - 22.0) < 1e-6);
});

test("tempFrac 按 min/max 归一化", () => {
  const f = w.tempFrac([10, 20]);
  assert.equal(f(10), 0);
  assert.equal(f(20), 1);
  assert.equal(f(15), 0.5);
  assert.equal(w.tempFrac([5, 5, 5])(5), 0.5);  // 等值防除零
});

test("sampleAt 小数下标线性插值与钳制", () => {
  const v = [10, 20, 30];
  assert.equal(w.sampleAt(v, 0), 10);
  assert.equal(w.sampleAt(v, 0.5), 15);
  assert.equal(w.sampleAt(v, 1.75), 27.5);
  assert.equal(w.sampleAt(v, 9), 30);    // 上钳
  assert.equal(w.sampleAt(v, -3), 10);   // 下钳
});

test("lerpHex 两色之间插值", () => {
  assert.equal(w.lerpHex("#000000", "#FFFFFF", 0), "#000000");
  assert.equal(w.lerpHex("#000000", "#FFFFFF", 1), "#ffffff");
  assert.equal(w.lerpHex("#000000", "#FFFFFF", 0.5), "#808080");
  assert.equal(w.lerpHex("#FF0000", "#00FF00", 0.5), "#808000");
  assert.equal(w.lerpHex("#000000", "#FFFFFF", 5), "#ffffff");   // 上钳
  assert.equal(w.lerpHex("#000000", "#FFFFFF", -5), "#000000");  // 下钳
});

test("rampColor 多段色标", () => {
  const two = ["#000000", "#FFFFFF"];
  assert.equal(w.rampColor(two, 0), "#000000");
  assert.equal(w.rampColor(two, 0.5), "#808080");
  assert.equal(w.rampColor(two, 1), "#ffffff");

  const three = ["#000000", "#FF0000", "#FFFFFF"];
  assert.equal(w.rampColor(three, 0), "#000000");
  assert.equal(w.rampColor(three, 0.5), "#ff0000");   // 正中落在中间那档
  assert.equal(w.rampColor(three, 0.25), "#800000");  // 第一段的一半
  assert.equal(w.rampColor(three, 1), "#ffffff");
  assert.equal(w.rampColor(three, 3), "#ffffff");     // 上钳
  assert.equal(w.rampColor(three, -3), "#000000");    // 下钳
});

test("barCells 铺满宽度且下标落在 0..count-1", () => {
  const cells = w.barCells(24, 320, 1);
  assert.equal(cells.length, 320);
  assert.equal(cells[0].x, 0);
  assert.equal(cells[cells.length - 1].x + cells[cells.length - 1].w, 320);  // 无缝铺满
  assert.ok(cells[0].pos >= 0);
  assert.ok(cells[cells.length - 1].pos <= 23);
  // 步长除不尽时，最后一格收窄，不越界
  const odd = w.barCells(24, 10, 3);
  assert.equal(odd[odd.length - 1].x + odd[odd.length - 1].w, 10);
});

test("hasRain 全 0 才算无雨", () => {
  assert.equal(w.hasRain(Array(24).fill(0)), false);
  assert.equal(w.hasRain([]), false);
  assert.equal(w.hasRain(Array(24).fill(0).concat([1])), true);   // 只有 1% 也算有雨
  assert.equal(w.hasRain([0, 0, 80, 0]), true);
});

test("chartHeight 无雨时矮一条带", () => {
  const full = w.chartHeight(true);
  const slim = w.chartHeight(false);
  assert.ok(slim < full);
  assert.equal(full - slim, 7);   // BAR_H(4) + BAR_GAP(3)
});

test("capsuleColumn 中段满高、两端按半圆收窄", () => {
  const W = 320, H = 4;   // 半径 2
  const mid = w.capsuleColumn(160, W, H);
  assert.equal(mid.dy, 0);
  assert.equal(mid.h, H);

  // 距左缘 2pt 处（正好是半圆的圆心）仍是满高
  const r0 = w.capsuleColumn(2, W, H);
  assert.ok(Math.abs(r0.h - H) < 1e-9);

  // 距左缘 1pt：半高 = sqrt(2²-1²) = √3
  const half = w.capsuleColumn(1, W, H);
  assert.ok(Math.abs(half.h - 2 * Math.sqrt(3)) < 1e-9);
  assert.ok(Math.abs(half.dy - (2 - Math.sqrt(3))) < 1e-9);

  // 两端顶点高度归零，且左右对称
  assert.equal(w.capsuleColumn(0, W, H).h, 0);
  assert.equal(w.capsuleColumn(W, W, H).h, 0);
  assert.ok(Math.abs(w.capsuleColumn(1, W, H).h - w.capsuleColumn(W - 1, W, H).h) < 1e-9);

  // 任何一列都不会超出色带高度
  for (let x = 0; x <= W; x += 0.5) {
    const c = w.capsuleColumn(x, W, H);
    assert.ok(c.dy >= 0 && c.dy + c.h <= H + 1e-9);
  }
});

test("capsuleCell 整格严格缩在胶囊轮廓内", () => {
  const W = 320, H = 4, r = H / 2;
  // 胶囊在 x 处允许的竖向区间
  const allowed = (x) => {
    let dx = 0;
    if (x < r) dx = r - x;
    else if (x > W - r) dx = x - (W - r);
    const half = dx >= r ? 0 : Math.sqrt(r * r - dx * dx);
    return [r - half, r + half];
  };

  // 中段整格满高
  const mid = w.capsuleCell(160, 1, W, H);
  assert.equal(mid.dy, 0);
  assert.equal(mid.h, H);

  // 最左/最右那格贴到圆弧顶点，高度归零 —— 整格都在轮廓外，直接不画
  assert.equal(w.capsuleCell(0, 1, W, H).h, 0);
  assert.equal(w.capsuleCell(319, 1, W, H).h, 0);

  // 取列中心会漏出轮廓，取外侧边缘不会：逐格核对两侧边界
  for (let x = 0; x < W; x += 1) {
    const c = w.capsuleCell(x, 1, W, H);
    if (c.h <= 0) continue;
    for (const edge of [x, x + 1]) {
      const [lo, hi] = allowed(edge);
      assert.ok(c.dy >= lo - 1e-9, `x=${x} 上边漏出轮廓`);
      assert.ok(c.dy + c.h <= hi + 1e-9, `x=${x} 下边漏出轮廓`);
    }
  }

  // 代价可控：两端加起来最多少画 2pt 的颜色
  let cover = 0;
  for (let x = 0; x < W; x += 1) if (w.capsuleCell(x, 1, W, H).h > 0) cover += 1;
  assert.ok(cover >= W - 2, `少画太多: ${cover}`);
});

test("posToX 下标映射到像素并钳制", () => {
  assert.equal(w.posToX(0, 24, 320), 0);
  assert.equal(w.posToX(23, 24, 320), 320);
  assert.ok(Math.abs(w.posToX(11.5, 24, 320) - 160) < 1e-9);
  assert.equal(w.posToX(30, 24, 320), 320);   // 上钳（23:00 之后压在右缘）
  assert.equal(w.posToX(-1, 24, 320), 0);     // 下钳
});
