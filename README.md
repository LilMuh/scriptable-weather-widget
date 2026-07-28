# Scriptable 天气小组件

iOS [Scriptable](https://scriptable.app) 天气小组件，中号尺寸，显示：

- 当前温度 + 天气状况
- **体感温度**
- **今日最高 / 最低温**
- **今日降雨概率**

代码托管在 GitHub，手机上的脚本会自动检查版本并拉取更新，改功能不用重新往手机上复制代码。

---

## 目录结构

```
scriptable-weather-widget/
├── version.json            # 版本清单，手机端靠它判断要不要更新
├── bootstrap/
│   └── Weather.js          # 唯一需要手动复制进 Scriptable 的文件
└── src/
    └── weather-widget.js   # 核心逻辑，由 bootstrap 自动下载
```

分工很简单：

| 文件 | 谁来读 | 什么时候改 |
|---|---|---|
| `bootstrap/Weather.js` | 手机上手动装一次 | 几乎不用改（改了要重新复制到手机） |
| `src/weather-widget.js` | 手机自动下载 | 日常改功能都改这里 |
| `version.json` | 手机每次运行都读 | 每次改完核心脚本，把 `version` 加一位 |

---

## 安装

### 1. 建 GitHub 仓库

在 GitHub 上新建一个 **public** 仓库（必须公开，`raw.githubusercontent.com` 才能匿名访问），
把本目录内容推上去：

```bash
cd D:\develop\Code\scriptable-weather-widget
git init
git add .
git commit -m "feat: 初始版本的 Scriptable 天气小组件"
git branch -M main
git remote add origin https://github.com/<你的用户名>/scriptable-weather-widget.git
git push -u origin main
```

### 2. 改配置

打开 `bootstrap/Weather.js`，把顶部三个常量改成你自己的：

```js
const GITHUB_USER   = "YOUR_GITHUB_USERNAME";      // ← 你的 GitHub 用户名
const GITHUB_REPO   = "scriptable-weather-widget"; // ← 仓库名
const GITHUB_BRANCH = "main";                      // ← 分支名
```

### 3. 装到手机

1. iPhone 上安装 Scriptable
2. 新建脚本，命名为 `Weather`
3. 把改好的 `bootstrap/Weather.js` 全部内容粘贴进去
4. 在 Scriptable 里先**手动运行一次**（重要：这一步会弹定位权限，必须允许）
5. 回到桌面 → 长按 → 添加小组件 → Scriptable → **中号（Medium）**
6. 长按新加的组件 → 编辑小组件 → Script 选 `Weather`

---

## 日常怎么更新

改 `src/weather-widget.js` → 把 `version.json` 的 `version` 加一位 → push。

```jsonc
{
  "version": "1.0.1",           // ← 只有这个数字变大，手机才会去下载
  "entry": "src/weather-widget.js",
  "bootstrapVersion": "1.0.0",
  "notes": "改了啥"
}
```

手机端下次刷新时会：读 `version.json` → 发现版本高于本地 → 下载新的核心脚本 → 缓存到本地 → 运行。

> `raw.githubusercontent.com` 有大约 5 分钟的 CDN 缓存。脚本已经在请求上加了时间戳参数来绕过，
> 但偶尔仍可能慢几分钟才生效，属正常现象。

如果改的是 `bootstrap/Weather.js` 本身（这种情况很少），把 `bootstrapVersion` 也加一位。
手机端检测到后会在组件底部显示一行黄色提示，提醒你重新复制一次引导脚本——
脚本没法安全地覆盖自己，这一步只能手动。

---

## 工作原理

```
桌面组件刷新
   │
   ├─ bootstrap/Weather.js 启动
   │     ├─ GET version.json          ← 失败则跳过更新，直接用本地缓存
   │     ├─ 远端 version > 本地？
   │     │     └─ 是 → GET src/weather-widget.js → 写入本地 core.js
   │     └─ importModule(core.js)
   │
   └─ core.buildWidget()
         ├─ Location.current()        ← 失败则用上次成功的坐标
         ├─ Location.reverseGeocode() ← 失败则沿用缓存的城市名
         ├─ GET api.open-meteo.com    ← 失败则用 3 小时内的缓存数据
         └─ 渲染 ListWidget
```

本地缓存都放在 Scriptable 文档目录的 `weather-widget/` 子目录下：

| 文件 | 内容 |
|---|---|
| `core.js` | 下载下来的核心脚本 |
| `meta.json` | 已安装版本号和安装时间 |
| `location.json` | 上次成功定位的坐标和城市名 |
| `weather.json` | 上次成功获取的天气数据 |

### 容错设计

每一个外部依赖都有兜底，任何单点失败都不会让组件变空白：

- **拉不到 `version.json`** → 跳过更新，用本地已有的核心脚本
- **下载新版核心脚本失败** → `meta.json` 不动，下次继续尝试，本次用旧版
- **GPS 定位失败或超时（6 秒）** → 用 `location.json` 里上次的坐标
- **反地理编码失败** → 沿用缓存的城市名
- **天气接口失败** → 用 3 小时内的缓存数据，时间戳前面加个 `·` 标记数据不是最新的

---

## 数据源

[Open-Meteo](https://open-meteo.com/) —— 免费、无需 API Key、非商用无限额。

请求的字段：

```
current = temperature_2m, apparent_temperature, weather_code, is_day
daily   = temperature_2m_max, temperature_2m_min, precipitation_probability_max
timezone = auto
```

- 体感温度用 `apparent_temperature`，已综合湿度、风速和辐射
- 降雨概率用 `precipitation_probability_max`，是**今天全天的最大概率**
- 温度单位默认摄氏度。要改华氏度，在请求参数里加 `temperature_unit=fahrenheit`
- 天气状况用 WMO 代码，映射表在 `src/weather-widget.js` 的 `WEATHER_CODES`

---

## 常见改动

**调整刷新频率** —— `src/weather-widget.js`:

```js
const REFRESH_MINUTES = 30;   // 只是给 iOS 的建议值，系统会自己调度，不保证准时
```

**换配色** —— `src/weather-widget.js` 的 `PALETTE`，白天和夜间各一组渐变：

```js
const PALETTE = {
  day:   { from: "#2E7BC4", to: "#79B5E8", text: "#FFFFFF" },
  night: { from: "#12203A", to: "#2A3F63", text: "#FFFFFF" },
};
```

**固定城市，不用 GPS** —— 在 `resolveLocation()` 开头直接返回：

```js
async function resolveLocation(store) {
  return { latitude: 43.6532, longitude: -79.3832, city: "多伦多" };
  // ...原有逻辑
}
```

---

## 排错

| 现象 | 原因 |
|---|---|
| 显示「无法连接 GitHub」 | `GITHUB_USER` / `GITHUB_REPO` 写错，或仓库不是 public |
| 显示「定位失败」 | 没在 Scriptable 里手动运行过，定位权限没给。设置 → Scriptable → 位置 → 使用 App 期间 |
| 组件一直是旧的 | `version.json` 的 `version` 忘了加；或 CDN 缓存还没过（等几分钟） |
| 时间戳前面有个 `·` | 天气接口这次没拉到，显示的是缓存数据 |
| 改了代码手机没反应 | 核心脚本的改动必须配合 `version.json` 版本号一起 push |

调试时在 Scriptable 里直接运行 `Weather` 脚本，会以中号预览弹出，错误信息会显示在组件里。
