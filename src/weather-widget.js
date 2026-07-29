// ============================================================================
//  Weather Widget · 核心脚本
// ============================================================================
//  这个文件由 bootstrap/Weather.js 从 GitHub 自动下载并加载，
//  不需要手动放进 Scriptable。改完 push 上去，把 version.json 的 version
//  加一位即可下发。
//
//  数据源：Open-Meteo（免费、无需 API Key）
//  显示内容：当前温度 / 体感温度 / 今日最高最低温 / 今日降雨概率
// ============================================================================

const CORE_VERSION = "1.1.0";

// --- 可调参数 ---------------------------------------------------------------
const REFRESH_MINUTES = 30;      // 建议系统多久刷新一次
const STALE_HOURS = 3;           // 缓存数据超过这个时长就视为过期
const GPS_TIMEOUT_MS = 6000;     // 定位超时，超时后用上次的坐标

// --- 曲线时间轴参数 ---------------------------------------------------------
const CHART_W = 320;             // 曲线画布宽（点）；若某机型裁切，调这个
const CHART_H = 46;              // 曲线画布高（点）
const CHART_PAD_Y = 5;           // 上下留白
const CHART_LINE_W = 1.5;        // 线宽
const COLOR_TEMP_LINE = "#FFC24B";
const COLOR_RAIN_LINE = "#FFFFFF";

// ---------------------------------------------------------------------------
// WMO 天气代码 → 中文描述 + SF Symbol
// ---------------------------------------------------------------------------
const WEATHER_CODES = {
  0:  { text: "晴",       day: "sun.max.fill",        night: "moon.stars.fill" },
  1:  { text: "大部晴朗",  day: "sun.max.fill",        night: "moon.fill" },
  2:  { text: "多云",      day: "cloud.sun.fill",      night: "cloud.moon.fill" },
  3:  { text: "阴",        day: "cloud.fill",          night: "cloud.fill" },
  45: { text: "雾",        day: "cloud.fog.fill",      night: "cloud.fog.fill" },
  48: { text: "冻雾",      day: "cloud.fog.fill",      night: "cloud.fog.fill" },
  51: { text: "小毛毛雨",  day: "cloud.drizzle.fill",  night: "cloud.drizzle.fill" },
  53: { text: "毛毛雨",    day: "cloud.drizzle.fill",  night: "cloud.drizzle.fill" },
  55: { text: "大毛毛雨",  day: "cloud.drizzle.fill",  night: "cloud.drizzle.fill" },
  56: { text: "冻毛毛雨",  day: "cloud.sleet.fill",    night: "cloud.sleet.fill" },
  57: { text: "冻毛毛雨",  day: "cloud.sleet.fill",    night: "cloud.sleet.fill" },
  61: { text: "小雨",      day: "cloud.rain.fill",     night: "cloud.rain.fill" },
  63: { text: "中雨",      day: "cloud.rain.fill",     night: "cloud.rain.fill" },
  65: { text: "大雨",      day: "cloud.heavyrain.fill",night: "cloud.heavyrain.fill" },
  66: { text: "冻雨",      day: "cloud.sleet.fill",    night: "cloud.sleet.fill" },
  67: { text: "强冻雨",    day: "cloud.sleet.fill",    night: "cloud.sleet.fill" },
  71: { text: "小雪",      day: "cloud.snow.fill",     night: "cloud.snow.fill" },
  73: { text: "中雪",      day: "cloud.snow.fill",     night: "cloud.snow.fill" },
  75: { text: "大雪",      day: "snowflake",           night: "snowflake" },
  77: { text: "雪粒",      day: "cloud.snow.fill",     night: "cloud.snow.fill" },
  80: { text: "阵雨",      day: "cloud.sun.rain.fill", night: "cloud.moon.rain.fill" },
  81: { text: "强阵雨",    day: "cloud.sun.rain.fill", night: "cloud.moon.rain.fill" },
  82: { text: "暴雨",      day: "cloud.heavyrain.fill",night: "cloud.heavyrain.fill" },
  85: { text: "阵雪",      day: "cloud.snow.fill",     night: "cloud.snow.fill" },
  86: { text: "强阵雪",    day: "snowflake",           night: "snowflake" },
  95: { text: "雷阵雨",    day: "cloud.bolt.rain.fill",night: "cloud.bolt.rain.fill" },
  96: { text: "雷阵雨伴冰雹", day: "cloud.bolt.rain.fill", night: "cloud.bolt.rain.fill" },
  99: { text: "强雷暴冰雹",   day: "cloud.bolt.rain.fill", night: "cloud.bolt.rain.fill" },
};

function describeWeather(code, isDay) {
  const entry = WEATHER_CODES[code] || { text: "未知", day: "questionmark.circle", night: "questionmark.circle" };
  return { text: entry.text, symbol: isDay ? entry.day : entry.night };
}

// ---------------------------------------------------------------------------
// 小时序列的纯计算（无 Scriptable 依赖，便于在 Node 里测）
// ---------------------------------------------------------------------------

/** 用左右最近的非 null 值线性插值填补 null；首尾 null 取最近的非 null */
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

/** 从 Open-Meteo 响应里取出当天 24 小时的温度 / 降雨概率 */
function extractHourly(data) {
  const h = (data && data.hourly) || {};
  const temps = (h.temperature_2m || []).slice(0, 24);
  const probs = (h.precipitation_probability || []).slice(0, 24);
  return {
    hourlyTemp: fillNullsLinear(temps),
    hourlyProb: probs.map((v) => (v == null ? 0 : v)),
    utcOffsetSeconds:
      typeof (data && data.utc_offset_seconds) === "number" ? data.utc_offset_seconds : 0,
  };
}

/** 把 Open-Meteo 响应转成组件用的 weather 对象（纯函数，便于测） */
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

/** 当前时刻在 location 本地一天中的位置，0..24 的小数（不依赖设备时区） */
function currentDayFraction(nowMs, utcOffsetSeconds) {
  const localSec = (((nowMs / 1000 + utcOffsetSeconds) % 86400) + 86400) % 86400;
  return localSec / 3600;
}

/** 返回把温度按当天 min/max 映射到 [0,1] 的函数；等值时走中线防除零 */
function tempFrac(temps) {
  const min = Math.min.apply(null, temps);
  const max = Math.max.apply(null, temps);
  const span = max - min;
  return function (v) {
    return span === 0 ? 0.5 : (v - min) / span;
  };
}

/** 把一组值铺满画布宽度，纵向按 fracFn 映射（0 在底、1 在顶），越界钳制 */
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

/** Catmull-Rom（α=0.5）转三次贝塞尔，端点用重复端点 */
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

/** 在折线的小数下标 idx 处线性插值取点（now 标记用） */
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

// ---------------------------------------------------------------------------
// 位置
// ---------------------------------------------------------------------------

/** Promise 超时包装：定位偶尔会长时间挂起，组件里不能干等 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => Timer.schedule(ms, false, () => reject(new Error(`${label} 超时`)))),
  ]);
}

async function resolveLocation(store) {
  const cached = store.read("location.json", null);

  try {
    Location.setAccuracyToHundredMeters();
    const loc = await withTimeout(Location.current(), GPS_TIMEOUT_MS, "定位");

    let city = cached && cached.city ? cached.city : "当前位置";
    try {
      const places = await withTimeout(
        Location.reverseGeocode(loc.latitude, loc.longitude),
        4000,
        "地名解析"
      );
      if (places && places.length) {
        const p = places[0];
        city = p.locality || p.subAdministrativeArea || p.administrativeArea || city;
      }
    } catch (e) {
      // 地名解析失败不影响天气，沿用缓存里的城市名
    }

    const resolved = { latitude: loc.latitude, longitude: loc.longitude, city };
    store.write("location.json", resolved);
    return resolved;
  } catch (e) {
    if (cached) return cached;
    throw new Error("定位失败，且没有可用的历史位置。请在 Scriptable 里手动运行一次并允许定位权限。");
  }
}

// ---------------------------------------------------------------------------
// 天气数据
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// 本地缓存读写
// ---------------------------------------------------------------------------
function makeStore(fm, dir) {
  return {
    read(name, fallback) {
      try {
        const p = fm.joinPath(dir, name);
        if (!fm.fileExists(p)) return fallback;
        if (typeof fm.isFileDownloaded === "function" && !fm.isFileDownloaded(p)) {
          fm.downloadFileFromiCloud(p);
        }
        return JSON.parse(fm.readString(p));
      } catch (e) {
        return fallback;
      }
    },
    write(name, obj) {
      try {
        fm.writeString(fm.joinPath(dir, name), JSON.stringify(obj));
      } catch (e) {
        // 写缓存失败不影响本次显示
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 界面
// ---------------------------------------------------------------------------
const PALETTE = {
  day:   { from: "#2E7BC4", to: "#79B5E8", text: "#FFFFFF" },
  night: { from: "#12203A", to: "#2A3F63", text: "#FFFFFF" },
};

function applyBackground(widget, isDay) {
  const c = isDay ? PALETTE.day : PALETTE.night;
  const g = new LinearGradient();
  g.colors = [new Color(c.from), new Color(c.to)];
  g.locations = [0, 1];
  g.startPoint = new Point(0, 0);
  g.endPoint = new Point(1, 1);
  widget.backgroundGradient = g;
}

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

/** 画温度 + 降雨概率双细线 + now 标记，返回图片 */
function buildTimelineImage(hourlyTemp, hourlyProb, nowPos) {
  const W = CHART_W;
  const H = CHART_H;
  const padY = CHART_PAD_Y;

  const tempPts = chartPoints(hourlyTemp, tempFrac(hourlyTemp), W, H, padY);
  const rainPts = chartPoints(hourlyProb, (v) => v / 100, W, H, padY);

  const ctx = new DrawContext();
  ctx.size = new Size(W, H);
  ctx.opaque = false;              // 透出蓝色渐变背景
  ctx.respectScreenScale = true;   // 按设备 scale 渲染，细线锐利

  // 先画降雨（白，底层），再画温度（琥珀，上层）
  strokeCurve(ctx, rainPts, new Color(COLOR_RAIN_LINE, 1), CHART_LINE_W);
  strokeCurve(ctx, tempPts, new Color(COLOR_TEMP_LINE, 1), CHART_LINE_W);

  // now 竖线（淡白）
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

const SYMBOL_FALLBACKS = {
  "thermometer.medium": "thermometer",
  "cloud.heavyrain.fill": "cloud.rain.fill",
  "cloud.sleet.fill": "cloud.rain.fill",
  "arrow.up.arrow.down": "arrow.up.and.down",
};

/**
 * 取 SF Symbol 图片。部分图标是 iOS 16+ 才有的，
 * 取不到就依次退回后面的候选名，避免老系统上直接崩掉。
 */
function symbolImage(name, size) {
  const candidates = [name, SYMBOL_FALLBACKS[name], "circle.fill"].filter(Boolean);
  for (const n of candidates) {
    const sym = SFSymbol.named(n);
    if (sym) {
      sym.applyFont(Font.systemFont(size));
      return sym.image;
    }
  }
  return null;
}

/** 右栏的一行指标：图标 + 文字 */
function addMetricRow(stack, symbolName, text, opacity = 0.9) {
  const row = stack.addStack();
  row.centerAlignContent();

  const img = symbolImage(symbolName, 11);
  if (img) {
    const icon = row.addImage(img);
    icon.imageSize = new Size(13, 13);
    icon.tintColor = new Color("#FFFFFF", opacity);
    icon.resizable = true;
    row.addSpacer(5);
  }

  const label = row.addText(text);
  label.font = Font.mediumSystemFont(13);
  label.textColor = new Color("#FFFFFF", opacity);
  label.lineLimit = 1;
}

function fmtTemp(v) {
  return (v === null || v === undefined) ? "--°" : `${Math.round(v)}°`;
}

function fmtPercent(v) {
  return (v === null || v === undefined) ? "--%" : `${Math.round(v)}%`;
}

function fmtClock(date) {
  const df = new DateFormatter();
  df.dateFormat = "HH:mm";
  return df.string(date);
}

// ---------------------------------------------------------------------------
// 组装组件
// ---------------------------------------------------------------------------
function render(ctx) {
  const { place, weather, isStale, notice } = ctx;
  const cond = describeWeather(weather.code, weather.isDay);

  const w = new ListWidget();
  applyBackground(w, weather.isDay);
  w.setPadding(14, 16, 14, 16);
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);

  // --- 顶部：图标 + 城市 ...... 更新时间 ---
  const header = w.addStack();
  header.centerAlignContent();

  const headImg = symbolImage(cond.symbol, 12);
  if (headImg) {
    const headIcon = header.addImage(headImg);
    headIcon.imageSize = new Size(15, 15);
    headIcon.tintColor = new Color("#FFFFFF", 0.95);
    headIcon.resizable = true;
    header.addSpacer(6);
  }

  const cityText = header.addText(place.city);
  cityText.font = Font.semiboldSystemFont(13);
  cityText.textColor = new Color("#FFFFFF", 0.95);
  cityText.lineLimit = 1;

  header.addSpacer();

  const stamp = header.addText(
    (isStale ? "· " : "") + fmtClock(new Date(weather.fetchedAt))
  );
  stamp.font = Font.systemFont(11);
  stamp.textColor = new Color("#FFFFFF", isStale ? 0.5 : 0.7);

  w.addSpacer();

  // --- 主体：左边大温度，右边三项指标 ---
  const body = w.addStack();
  body.bottomAlignContent();

  const left = body.addStack();
  left.layoutVertically();

  const bigTemp = left.addText(fmtTemp(weather.temp));
  bigTemp.font = Font.lightSystemFont(46);
  bigTemp.textColor = Color.white();
  bigTemp.minimumScaleFactor = 0.6;
  bigTemp.lineLimit = 1;

  const condText = left.addText(cond.text);
  condText.font = Font.systemFont(13);
  condText.textColor = new Color("#FFFFFF", 0.85);
  condText.lineLimit = 1;

  body.addSpacer();

  const right = body.addStack();
  right.layoutVertically();
  right.spacing = 4;

  addMetricRow(right, "thermometer.medium", `体感 ${fmtTemp(weather.feelsLike)}`);
  addMetricRow(right, "arrow.up.arrow.down", `${fmtTemp(weather.tempMax)} / ${fmtTemp(weather.tempMin)}`);
  addMetricRow(right, "umbrella.fill", `降雨 ${fmtPercent(weather.rainChance)}`);

  // --- 底部：温度 + 降雨概率 双细线时间轴 ---
  // 旧版缓存的 weather.json 没有 hourly 数组，这里守卫一下，跳过绘制而不是崩掉
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

  if (notice) {
    w.addSpacer(4);
    const note = w.addText(notice);
    note.font = Font.systemFont(9);
    note.textColor = new Color("#FFD86B", 0.9);
    note.lineLimit = 1;
  }

  return w;
}

// ---------------------------------------------------------------------------
// 入口：由 bootstrap 调用
// ---------------------------------------------------------------------------
async function buildWidget(opts) {
  const { fileManager, cacheDir, notice } = opts;
  const store = makeStore(fileManager, cacheDir);

  const place = await resolveLocation(store);

  let weather;
  let isStale = false;

  try {
    weather = await fetchWeather(place.latitude, place.longitude);
    store.write("weather.json", weather);
  } catch (e) {
    // 网络挂了：用缓存顶上，只要没过期太久
    const cached = store.read("weather.json", null);
    const age = cached ? Date.now() - cached.fetchedAt : Infinity;
    if (!cached || age > STALE_HOURS * 3600 * 1000) {
      throw new Error(`获取天气失败：${e.message}`);
    }
    weather = cached;
    isStale = true;
  }

  return render({ place, weather, isStale, notice });
}

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
