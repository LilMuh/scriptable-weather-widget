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

test("posToX 下标映射到像素并钳制", () => {
  assert.equal(w.posToX(0, 24, 320), 0);
  assert.equal(w.posToX(23, 24, 320), 320);
  assert.ok(Math.abs(w.posToX(11.5, 24, 320) - 160) < 1e-9);
  assert.equal(w.posToX(30, 24, 320), 320);   // 上钳（23:00 之后压在右缘）
  assert.equal(w.posToX(-1, 24, 320), 0);     // 下钳
});
