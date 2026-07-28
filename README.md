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
├── install.js              # 一行安装器（只在第一次装的时候用）
├── bootstrap/
│   └── Weather.js          # 装进 Scriptable 的脚本，之后会自己更新自己
└── src/
    └── weather-widget.js   # 核心逻辑，由 bootstrap 自动下载
```

分工很简单：

| 文件 | 谁来读 | 什么时候改 |
|---|---|---|
| `bootstrap/Weather.js` | 手机装一次，之后自更新 | 很少改；改了把 `bootstrapVersion` 加一位 |
| `src/weather-widget.js` | 手机自动下载 | 日常改功能都改这里 |
| `version.json` | 手机每次运行都读 | 每次改完脚本，把对应版本号加一位 |

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

> 如果 fork 或换了仓库地址，记得同步改 `bootstrap/Weather.js` 顶部的
> `GITHUB_USER` / `GITHUB_REPO` / `GITHUB_BRANCH`，以及 `install.js` 里的 URL。

### 2. 装到手机（三选一）

`scriptable:///add` 这个 URL scheme **不接受代码参数**（[官方文档](https://docs.scriptable.app/urlscheme/)），
所以没法做成"点一下链接就装好"。但下面三种方式都不用整段复制代码。

#### 方式 A：一行安装器（推荐）

Scriptable 里新建空脚本 → 粘贴这一行 → 运行 → 脚本列表里出现 `Weather` → 删掉安装器。

```js
let fm;try{fm=FileManager.iCloud();fm.documentsDirectory()}catch(e){fm=FileManager.local()}fm.writeString(fm.joinPath(fm.documentsDirectory(),"Weather.js"),await new Request("https://raw.githubusercontent.com/LilMuh/scriptable-weather-widget/main/bootstrap/Weather.js").loadString());
```

原理：`documentsDirectory()` 就是 Scriptable 存脚本的目录，往里写一个 `.js` 文件，
它就会作为脚本出现在列表里。展开版见 `install.js`。

#### 方式 B：从"文件"App 拖进去（完全不碰代码）

需要 Scriptable 开了 iCloud 同步。

- **在电脑上**（装了 iCloud for Windows）：把 `bootstrap/Weather.js` 直接复制到
  `iCloud Drive\Scriptable\`，文件名保持 `Weather.js`，同步完手机上就有了。
- **在手机上**：Safari 打开
  [raw 链接](https://raw.githubusercontent.com/LilMuh/scriptable-weather-widget/main/bootstrap/Weather.js)
  → 分享 → 存储到"文件" → 移动到 iCloud Drive/Scriptable/。

#### 方式 C：手动复制粘贴

新建脚本命名 `Weather`，把 `bootstrap/Weather.js` 内容整个贴进去。

### 3. 授权并添加组件

1. 在 Scriptable 里**手动运行一次** `Weather`（重要：这一步会弹定位权限，必须允许）
2. 回到桌面 → 长按 → 添加小组件 → Scriptable → **中号（Medium）**
3. 长按新加的组件 → 编辑小组件 → Script 选 `Weather`

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
手机端检测到后会**自动下载并覆盖脚本自己**，下次刷新生效，同样不用手动操作。

引导脚本靠 [`module.filename`](https://docs.scriptable.app/module/)（当前脚本的绝对路径）
定位自己的文件，所以你把脚本改名、或放在 iCloud / 本地都不影响。
写入前有三重校验，任何一项不过就放弃更新、保持原样：

- 内容含哨兵注释 `@scriptable-weather-bootstrap`（确认下载到的是引导脚本，不是 404 页面）
- 长度大于 2000 字节
- 含关键调用 `Script.setWidget`

校验没过或下载失败时，组件底部会显示一行黄色提示说明原因。

---

## 工作原理

```
桌面组件刷新
   │
   ├─ bootstrap/Weather.js 启动
   │     ├─ GET version.json          ← 失败则跳过更新，直接用本地缓存
   │     ├─ 远端 version > 本地？
   │     │     └─ 是 → GET src/weather-widget.js → 写入本地 core.js
   │     ├─ 远端 bootstrapVersion > 本地？
   │     │     └─ 是 → GET bootstrap/Weather.js → 校验 → 覆盖 module.filename
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
- **引导脚本自更新校验不过** → 不写入，保持当前可用版本，组件上提示原因
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
| 显示「无法连接 GitHub」 | 仓库不是 public，或网络访问不了 `raw.githubusercontent.com` |
| 一行安装器跑完没看到脚本 | 退出再进 Scriptable 刷新列表；iCloud 同步可能要等几秒 |
| 显示「定位失败」 | 没在 Scriptable 里手动运行过，定位权限没给。设置 → Scriptable → 位置 → 使用 App 期间 |
| 组件一直是旧的 | `version.json` 的 `version` 忘了加；或 CDN 缓存还没过（等几分钟） |
| 时间戳前面有个 `·` | 天气接口这次没拉到，显示的是缓存数据 |
| 改了代码手机没反应 | 核心脚本的改动必须配合 `version.json` 版本号一起 push |

调试时在 Scriptable 里直接运行 `Weather` 脚本，会以中号预览弹出，错误信息会显示在组件里。
