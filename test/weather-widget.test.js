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

test("chartPoints 映射与钳制", () => {
  const pts = w.chartPoints([0, 50, 100], (v) => v / 100, 100, 10, 0);
  assert.deepEqual(pts, [
    { x: 0, y: 10 },
    { x: 50, y: 5 },
    { x: 100, y: 0 },
  ]);
  // 概率>100 被钳到 1（y=0），<0 钳到 0（y=H）
  const c = w.chartPoints([200, -5], (v) => v / 100, 100, 10, 0);
  assert.equal(c[0].y, 0);
  assert.equal(c[1].y, 10);
});

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

test("valueAtIndex 线性插值与钳制", () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }];
  assert.deepEqual(w.valueAtIndex(pts, 0.5), { x: 5, y: 5 });
  assert.deepEqual(w.valueAtIndex(pts, 1.5), { x: 15, y: 15 });
  assert.deepEqual(w.valueAtIndex(pts, 5), { x: 20, y: 20 });   // 上钳
  assert.deepEqual(w.valueAtIndex(pts, -1), { x: 0, y: 0 });    // 下钳
});
