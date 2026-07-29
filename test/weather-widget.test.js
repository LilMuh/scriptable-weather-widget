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
