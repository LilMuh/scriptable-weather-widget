# 设计文档:小时级"温度 + 降雨"双细线时间轴

- 日期:2026-07-28
- 目标文件:`src/weather-widget.js`
- 状态:已实现;形态在真机试跑后修订,见下

> **修订(2026-07-29,真机试跑后)**:形态由**折线**改为**平直色带**。
> 真机上折线的起伏是不想要的效果——高低应当靠**颜色深浅**表达,而不是纵向位移。
> 现行实现:两条通栏水平色带,温度 `#FFF0C9`(当天最低)→ `#FF8A2B`(当天最高);
> 降雨白色 alpha `0.10`(0%)→ `1.0`(100%);两条下面各垫一层 alpha `0.10` 的槽,
> 空数据时也看得出条带位置;now 竖线白色 alpha `0.55` 贯穿两条。
> 下文 5.2/5.3/5.5(纵向归一化、Catmull-Rom 平滑、now 圆点)已作废,
> 第 3 章(数据获取、null 处理、时区推算)与 5.4 的取色思路仍然有效。
- 注意:本文档仅存本地,**不 commit、不 push**(用户要求"文档不要上传")

## 1. 概述

在现有中号 Scriptable 天气组件的**下半部分**新增一块通栏曲线区,用**两条 1.5px 细线**展示当天 24 小时的走势:

- **温度线** —— `hourly.temperature_2m`
- **降雨概率线** —— `hourly.precipitation_probability`

两条线**叠在同一图区**,各用一种颜色,平滑曲线,追求 iOS 天气 App 那种干净的观感。组件其余部分(蓝色日/夜渐变背景、header、大温度、三行指标)保持不变,曲线区是**新增**,不替换任何现有内容。

## 2. 背景与已定决策

这个特性经过几轮收敛,以下为最终拍板结果,取代 `design_handoff_rain_timeline/` 里的原始方案:

| 决策点 | 结论 | 说明 |
|---|---|---|
| 视觉形态 | **双细线 sparkline** | 放弃 handoff 的 24 格粗色块条,也放弃环形双环 |
| 背景 | **保留蓝色日/夜渐变** | 不改深色卡片;曲线颜色为蓝底重新适配 |
| 温度线数据 | `hourly.temperature_2m` | 按当天 min/max 归一化 |
| 降雨线数据 | `hourly.precipitation_probability`(%) | **不用 mm**,故请求里也不再要 precipitation |
| 两线排布 | **叠在同一图区** | 各自独立缩放到图高 |
| 位置 | 组件**下半部分**通栏 | 约 45–46pt 高 |
| 线宽 | 1.5px,圆角线帽,平滑曲线 | Catmull-Rom → 三次贝塞尔 |
| 颜色 | 温度=琥珀橙 `#FFC24B`,降雨=白 `#FFFFFF` | 蓝底上高对比,日/夜都清楚 |
| 降雨映射 | **固定 0–100** | 100% 到顶,低概率贴底,真实反映高低 |
| now 标记 | 淡白竖线(透明度~0.25)+ 两条线各一小圆点 | |
| 去掉 | 坐标轴、0/6/12/18 刻度、降雨起止红字、图例 | 保持干净 |

## 3. 数据需求(Open-Meteo,已实测)

在 `fetchWeather()` 的请求里追加:

```
hourly=precipitation_probability,temperature_2m
```

保留现有 `current`、`daily`、`timezone=auto`、`forecast_days=1`。

**已用多伦多坐标实测确认**:
- `forecast_days=1` 精确返回 **24 条** hourly 数据,`time` 从当天 `00:00` 到 `23:00`(location 本地时区),与"hour 0–23 of today"完全对齐,无需切片。
- 三字段长度均为 24。免费、无需 API key。

从响应中提取并缓存(随现有 `weather.json`,沿用过期回退逻辑):

- `hourlyTemp[i]` = `hourly.temperature_2m[i]`(°C)
- `hourlyProb[i]` = `hourly.precipitation_probability[i]`(0–100)
- `utcOffsetSeconds` = `data.utc_offset_seconds`(算"当前小时"用)

### 健壮性

- **概率 null → 当 0**(部分地区/模型某些小时会返回 null,不能崩)。
- **温度 null → 用左右相邻值线性插值**;首尾为 null 则取最近的非 null 值;整段全 null(极罕见)则退化为一条平线。
- **当前小时不用 `Date.getHours()`**,改用 API 的本地时区推算,避免用户出差时错位:
  ```
  localSec = ((Date.now()/1000 + utcOffsetSeconds) % 86400 + 86400) % 86400
  nowPos   = localSec / 3600           // 0..24 的小数,当前时刻在一天中的位置
  ```
- 网络失败时:若缓存 `weather.json` 未超过 `STALE_HOURS`,用缓存(含 hourly 数组)显示,`isStale=true`,与现状一致。

## 4. 布局

中号组件很宽但矮(内容区约 340×130pt,去掉 padding 后)。竖向预算大致:

```
header            ~18pt   (图标 + 城市 …… 时间)
body              ~62pt   (大温度 + 天气文字 在左;三行指标 在右)
曲线区            ~46pt   (新增,通栏)
```

为腾出曲线区,对现有部分做**轻度收紧**(不改结构):

- 三行指标的 `right.spacing` 由 6 收到 4。
- 大温度字号 46 →(如放不下)可降到 40–42,`minimumScaleFactor` 已有。
- body 与曲线区之间用 `w.addSpacer(6)` 分隔。

曲线区是一张 `DrawContext` 图片,通栏加入,置于所有内容之下。

## 5. 曲线绘制

### 5.1 画布

用 `DrawContext`,一次性画好整张图再 `addImage`:

```js
const ctx = new DrawContext();
ctx.size = new Size(CHART_W, CHART_H);   // 点坐标
ctx.opaque = false;                       // 透出蓝色渐变背景
ctx.respectScreenScale = true;            // 自动按设备 scale 渲染,保证细线锐利
```

- `CHART_W = 320`,`CHART_H = 46`(点)。中号组件各机型内宽约 300–330pt;320 接近,首版够用。图片以 **非 resizable、通栏顶对齐**加入;若某机型偏差明显,调 `CHART_W` 常量即可(后续可用 `Device.screenSize()` 精确推算,首版不做)。
- 上下留白 `PAD_Y = 5pt`,避免线贴边。

### 5.2 坐标映射

24 个采样点横向铺满:

```
x(i) = (i / 23) * CHART_W          // i = 0..23,hour0 在左缘,hour23 在右缘
```

- **温度**:`minT / maxT` 取 24 个温度的极值;`maxT===minT` 时走中线防除零。
  ```
  yTemp(i) = CHART_H - PAD_Y - ((temp[i]-minT)/(maxT-minT)) * (CHART_H - 2*PAD_Y)
  ```
- **降雨(固定 0–100)**:
  ```
  yRain(i) = CHART_H - PAD_Y - (prob[i]/100) * (CHART_H - 2*PAD_Y)
  ```

### 5.3 平滑与描边

- 用 **Catmull-Rom 经过 24 个点**,转成三次贝塞尔逐段 `path.addCurve(pt, c1, c2)`。张力 α=0.5 的标准转换:
  ```
  c1 = p1 + (p2 - p0) / 6
  c2 = p2 - (p3 - p1) / 6      // 端点用重复端点 p0=p1 / p3=p2
  ```
- `ctx.setLineWidth(1.5)`;`ctx.setStrokeColor(color)`;圆角线帽(Scriptable 描边默认圆头,足够)。先画降雨线,再画温度线(温度在上层更醒目)。

### 5.4 配色

| 元素 | 颜色 | 透明度 |
|---|---|---|
| 温度线 | `#FFC24B`(琥珀橙) | 1.0 |
| 降雨线 | `#FFFFFF`(白) | 1.0 |
| now 竖线 | `#FFFFFF` | 0.25 |
| now 温度点 | `#FFC24B` | 1.0 |
| now 降雨点 | `#FFFFFF` | 1.0 |

日间浅蓝、夜间深蓝渐变下,琥珀 + 白都保持清晰,故两种背景共用同一套颜色。

### 5.5 now 标记

- 竖线:`x = clamp((nowPos/23)*CHART_W, 0, CHART_W)`,从图顶到图底,`#FFFFFF` 透明度 0.25,线宽 1。
- 两个圆点:半径 2pt,画在各自曲线在 `nowPos` 处的值上;y 用相邻两采样点**线性插值**(1.5px 线宽下与平滑曲线视觉无差)。

## 6. 复用现有代码

- 沿用 `symbolImage()`、`addMetricRow()`、`PALETTE`、`applyBackground()`、`makeStore()`、`fmtTemp/fmtPercent/fmtClock`。
- 三行指标(体感 / 最高最低 / 降雨%)**原样保留**,降雨% 仍取 `daily.precipitation_probability_max`。
- 新增内容集中在 `render()` 尾部新增的曲线区,以及 `fetchWeather()` 的字段扩展。建议把纯计算(数据提取、插值、缩放、Catmull-Rom、当前小时)抽成**无 Scriptable 依赖的纯函数**,便于在 Node 里测。

## 7. 不做(Non-goals)

- 不做环形双环、不做 24 格粗色块条。
- 不按 mm 做降雨强度着色。
- 不画降雨起止红色标签、不画 0/6/12/18 刻度、不画坐标轴与图例。
- 不删除/替换任何现有指标或结构。
- 不改 `bootstrap/Weather.js`。

## 8. 可调常量

```js
const CHART_W = 320;      // 曲线画布宽(点)
const CHART_H = 46;       // 曲线画布高(点)
const CHART_PAD_Y = 5;    // 上下留白
const CHART_LINE_W = 1.5; // 线宽
const COLOR_TEMP_LINE = "#FFC24B";
const COLOR_RAIN_LINE = "#FFFFFF";
```

(本设计不需要"降雨阈值"常量——线图直接画概率,不做 raining 判定。)

## 9. 验证

- **纯函数单测(Node)**:对数据提取 / null 插值 / 温度归一化 / 降雨映射 / 当前小时推算 / Catmull-Rom 控制点,用 handoff 里的 5 个场景(no_rain / evening_start / morning_stop / multi_window / all_day)做断言,确认坐标落点符合预期。
- **真机视觉验证**:在 Scriptable App 里手动跑一次,确认曲线形态、颜色对比、now 标记位置、下半部分排版在中号组件里不溢出/不裁切。
- **回退验证**:断网后确认走缓存(`isStale`)且曲线仍能画(用缓存的 hourly 数组)。

## 10. 部署(用户后续自行执行,本次不做)

- 改完后 `CORE_VERSION` 与 `version.json` 的 `version` 各加一位,push 到 GitHub,由 bootstrap 自动下发。
- 本设计文档按用户要求**不上传**。
