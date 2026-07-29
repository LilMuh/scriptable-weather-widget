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

const CORE_VERSION = "1.2.0";

// --- 可调参数 ---------------------------------------------------------------
const REFRESH_MINUTES = 30;      // 建议系统多久刷新一次
const STALE_HOURS = 3;           // 缓存数据超过这个时长就视为过期
const GPS_TIMEOUT_MS = 6000;     // 定位超时，超时后用上次的坐标

// --- 色带时间轴参数 ---------------------------------------------------------
//  两条平直色带，高低不靠起伏、靠颜色深浅表达。
const CHART_W = 320;             // 画布宽（点）；若某机型裁切，调这个
const BAR_H = 4;                 // 每条色带的高度
const BAR_GAP = 3;               // 两条之间的间距（要容下两条黑边）
const NOW_CAP_H = 5;             // 顶部 now 三角指针占的高度
const CHART_STEP = 1;            // 取样步长（点），越小颜色过渡越细腻
// 画布高度见 chartHeight()：全天无雨时只留温度那一条

// 温度色标：当天最低 → 中间 → 最高。三段拉开深浅对比
const TEMP_RAMP = ["#FFF6DC", "#FFB03C", "#C42E00"];
const COLOR_RAIN      = "#FFFFFF";   // 降雨用白色，靠透明度表达概率
const RAIN_ALPHA_MIN  = 0.10;        // 0% 时几乎看不见
const RAIN_ALPHA_MAX  = 1.0;         // 100% 时纯白
const TRACK_ALPHA     = 0.10;        // 色带底槽，空数据时也看得出条带在哪

// 色带外形：胶囊（圆角半径 = 高度一半）+ 纯黑细描边
const BAR_STROKE_W    = 0.75;
const COLOR_BAR_EDGE  = "#000000";

// now 标记：三角指针 + 贯穿竖条 + 深色描边（压在纯白色带上也分得清）
const NOW_W       = 2.5;
const NOW_HALO_W  = 5;
const COLOR_NOW_HALO = "#07142A";
const NOW_HALO_ALPHA = 0.45;
const NOW_CAP_W   = 9;

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

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 当天是否有降雨可能；全 0 就完全不画那条带 */
function hasRain(probs) {
  return probs.some((v) => v > 0);
}

/**
 * 胶囊形色带在某一列上的竖向范围（相对色带顶边）。
 * DrawContext 没有裁剪 API，圆角端只能这么逐列收窄画出来：
 * 距左右缘不到半径 r 的地方，按半圆 sqrt(r²-dx²) 压低这一列。
 */
function capsuleColumn(cx, W, h) {
  const r = h / 2;
  let dx = 0;
  if (cx < r) dx = r - cx;
  else if (cx > W - r) dx = cx - (W - r);
  const half = dx >= r ? 0 : Math.sqrt(r * r - dx * dx);
  return { dy: r - half, h: half * 2 };
}

/**
 * 一整格（宽 w）能安全落在胶囊内的竖向范围。
 * 取列中心会让端头那几格戳出圆弧、在黑边外露一点颜色；这里取整格里最窄的
 * 那一侧。胶囊侧影是"升→平→降"的单峰形，最小值必在两端边界上，取两者更窄的即可。
 */
function capsuleCell(x, w, W, h) {
  const a = capsuleColumn(x, W, h);
  const b = capsuleColumn(x + w, W, h);
  return a.h <= b.h ? a : b;
}

/** 画布高度：无雨时省掉降雨带和中间的间距 */
function chartHeight(showRain) {
  return NOW_CAP_H + BAR_H + (showRain ? BAR_GAP + BAR_H : 0);
}

/** 在小数下标 pos 处对序列线性插值取值；pos 钳到 [0, n-1] */
function sampleAt(values, pos) {
  const n = values.length;
  let c = pos;
  if (c < 0) c = 0;
  else if (c > n - 1) c = n - 1;
  const lo = Math.floor(c);
  const hi = Math.min(n - 1, lo + 1);
  return values[lo] + (values[hi] - values[lo]) * (c - lo);
}

/** 两个 #rrggbb 之间线性插值，t 钳到 [0,1] */
function lerpHex(a, b, t) {
  const k = clamp01(t);
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const mix = (shift) => {
    const ca = (pa >> shift) & 255;
    const cb = (pb >> shift) & 255;
    return Math.round(ca + (cb - ca) * k);
  };
  const hex = ((mix(16) << 16) | (mix(8) << 8) | mix(0)).toString(16).padStart(6, "0");
  return "#" + hex;
}

/** 沿一串色标取色，t 钳到 [0,1]。段数越多，深浅拉得越开 */
function rampColor(stops, t) {
  const last = stops.length - 1;
  if (last <= 0) return stops[0];
  const k = clamp01(t);
  const seg = Math.min(last - 1, Math.floor(k * last));
  return lerpHex(stops[seg], stops[seg + 1], k * last - seg);
}

/**
 * 把画布宽度切成一排小格，每格带上它在序列里的（小数）下标。
 * 逐格填色就得到一条颜色连续变化的色带。
 */
function barCells(count, W, step) {
  const cells = [];
  for (let x = 0; x < W; x += step) {
    const cw = Math.min(step, W - x);
    cells.push({ x: x, w: cw, pos: ((x + cw / 2) / W) * (count - 1) });
  }
  return cells;
}

/** 序列下标 → 画布横坐标，越界钳到两端 */
function posToX(pos, count, W) {
  return clamp01(pos / (count - 1)) * W;
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

/** 一条色带的胶囊外形；inset 用来把描边收进色带里，免得糊出画布 */
function barCapsulePath(y, inset) {
  const p = new Path();
  const r = BAR_H / 2 - inset;
  p.addRoundedRect(new Rect(inset, y + inset, CHART_W - inset * 2, BAR_H - inset * 2), r, r);
  return p;
}

/**
 * 画一条胶囊形色带：淡底槽 → 逐格填色（两端按半圆收窄）→ 黑色细描边。
 * colorFn 拿到该格插值出来的数值，返回这一格的颜色。
 */
function fillBar(ctx, y, values, colorFn) {
  ctx.setFillColor(new Color(COLOR_RAIN, TRACK_ALPHA));
  ctx.addPath(barCapsulePath(y, 0));
  ctx.fillPath();

  for (const cell of barCells(values.length, CHART_W, CHART_STEP)) {
    const col = capsuleCell(cell.x, cell.w, CHART_W, BAR_H);
    if (col.h <= 0) continue;
    ctx.setFillColor(colorFn(sampleAt(values, cell.pos)));
    ctx.fillRect(new Rect(cell.x, y + col.dy, cell.w, col.h));
  }

  // 描边压在最外圈上，正好盖掉逐列填色留下的锯齿边
  ctx.setStrokeColor(new Color(COLOR_BAR_EDGE, 1));
  ctx.setLineWidth(BAR_STROKE_W);
  ctx.addPath(barCapsulePath(y, BAR_STROKE_W / 2));
  ctx.strokePath();
}

/** now 标记：色带上方一个白三角，下面一条贯穿两带的白竖条（带深色描边） */
function drawNowMarker(ctx, nowX, barsBottom) {
  const barsTop = NOW_CAP_H;

  // 深色描边：压在 100% 的纯白降雨带上也能分辨
  ctx.setFillColor(new Color(COLOR_NOW_HALO, NOW_HALO_ALPHA));
  ctx.fillRect(new Rect(nowX - NOW_HALO_W / 2, barsTop, NOW_HALO_W, barsBottom - barsTop));

  ctx.setFillColor(new Color(COLOR_RAIN, 1));
  ctx.fillRect(new Rect(nowX - NOW_W / 2, barsTop, NOW_W, barsBottom - barsTop));

  // 顶上的三角指针，整体贴到画布边缘时往里收，避免只画出一半
  const half = NOW_CAP_W / 2;
  const cx = Math.max(half, Math.min(CHART_W - half, nowX));
  const cap = new Path();
  cap.move(new Point(cx - half, 0));
  cap.addLine(new Point(cx + half, 0));
  cap.addLine(new Point(cx, NOW_CAP_H));
  cap.addLine(new Point(cx - half, 0));
  ctx.addPath(cap);
  ctx.fillPath();
}

/** 画温度 + 降雨概率两条色带 + now 标记，返回图片 */
function buildTimelineImage(hourlyTemp, hourlyProb, nowPos) {
  const showRain = hasRain(hourlyProb);
  const h = chartHeight(showRain);

  const ctx = new DrawContext();
  ctx.size = new Size(CHART_W, h);
  ctx.opaque = false;              // 透出蓝色渐变背景
  ctx.respectScreenScale = true;   // 按设备 scale 渲染

  // 上：温度。当天最低→最高走三段色标，浅奶油→琥珀→深红
  const frac = tempFrac(hourlyTemp);
  fillBar(ctx, NOW_CAP_H, hourlyTemp, (v) => new Color(rampColor(TEMP_RAMP, frac(v)), 1));

  // 下：降雨概率。0→100 映射成 近乎透明→纯白。全天无雨就整条不画
  if (showRain) {
    fillBar(ctx, NOW_CAP_H + BAR_H + BAR_GAP, hourlyProb, (v) =>
      new Color(COLOR_RAIN, RAIN_ALPHA_MIN + (RAIN_ALPHA_MAX - RAIN_ALPHA_MIN) * clamp01(v / 100))
    );
  }

  drawNowMarker(ctx, posToX(nowPos, hourlyTemp.length, CHART_W), h);

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
  right.spacing = 6;

  addMetricRow(right, "thermometer.medium", `体感 ${fmtTemp(weather.feelsLike)}`);
  addMetricRow(right, "arrow.up.arrow.down", `${fmtTemp(weather.tempMax)} / ${fmtTemp(weather.tempMin)}`);
  addMetricRow(right, "umbrella.fill", `降雨 ${fmtPercent(weather.rainChance)}`);

  // --- 底部：温度 + 降雨概率 双色带时间轴 ---
  // 旧版缓存的 weather.json 没有 hourly 数组，这里守卫一下，跳过绘制而不是崩掉
  if (
    Array.isArray(weather.hourlyTemp) && weather.hourlyTemp.length >= 2 &&
    Array.isArray(weather.hourlyProb) && weather.hourlyProb.length >= 2
  ) {
    w.addSpacer(6);
    const nowPos = currentDayFraction(Date.now(), weather.utcOffsetSeconds || 0);
    const chartImg = buildTimelineImage(weather.hourlyTemp, weather.hourlyProb, nowPos);
    const imgEl = w.addImage(chartImg);
    imgEl.imageSize = new Size(CHART_W, chartHeight(hasRain(weather.hourlyProb)));
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
  sampleAt,
  lerpHex,
  rampColor,
  barCells,
  posToX,
  hasRain,
  chartHeight,
  capsuleColumn,
  capsuleCell,
};
