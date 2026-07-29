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
