// Variables used by Scriptable.
// These must be at the very top of the file. Comments must be Icon-Color: orange; Icon-Glyph: flask;

// ============================================================================
//  Weather Widget · 真机试跑脚本（dev）
// ============================================================================
//  跟正式的 bootstrap/Weather.js 是两回事，互不干扰：
//    - 固定从下面这个 BRANCH 拉核心脚本，不看 version.json，每次运行都下最新的
//    - 缓存写在 weather-widget-dev/ 目录，不碰正式组件的定位/天气缓存
//
//  用法：手机上跑一次就能看到中号预览。改完代码 push 到该分支，再点一次运行即可。
//  验完删掉这个脚本就行，正式组件完全不受影响。
// ============================================================================

const GITHUB_USER = "LilMuh";
const GITHUB_REPO = "scriptable-weather-widget";
const BRANCH = "feat/rain-temp-line-timeline";   // ← 要试别的分支就改这里
const ENTRY = "src/weather-widget.js";

const CACHE_DIR_NAME = "weather-widget-dev";

let fm;
try {
  fm = FileManager.iCloud();
  fm.documentsDirectory();
} catch (e) {
  fm = FileManager.local();
}

const cacheDir = fm.joinPath(fm.documentsDirectory(), CACHE_DIR_NAME);
if (!fm.fileExists(cacheDir)) fm.createDirectory(cacheDir, true);
const corePath = fm.joinPath(cacheDir, "core.js");

function errorWidget(message) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#2b2b2b");
  w.setPadding(16, 16, 16, 16);
  const t = w.addText("⚠️ 试跑失败");
  t.font = Font.semiboldSystemFont(14);
  t.textColor = Color.white();
  w.addSpacer(6);
  const b = w.addText(message);
  b.font = Font.systemFont(11);
  b.textColor = new Color("#ffffff", 0.7);
  b.lineLimit = 5;
  return w;
}

async function main() {
  // 每次都重新下载，省得判断版本号
  const url = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${BRANCH}/${ENTRY}?t=${Date.now()}`;
  try {
    const req = new Request(url);
    req.timeoutInterval = 15;
    const code = await req.loadString();
    if (req.response && req.response.statusCode >= 400) {
      throw new Error(`HTTP ${req.response.statusCode}（分支名或路径不对？）`);
    }
    if (!code || code.length < 200) throw new Error("下载内容异常");
    fm.writeString(corePath, code);
  } catch (e) {
    if (!fm.fileExists(corePath)) return errorWidget(`下载核心脚本失败：${e.message}`);
    // 下载失败但本地有上次的，就用上次的接着跑
  }

  let core;
  try {
    if (typeof fm.isFileDownloaded === "function" && !fm.isFileDownloaded(corePath)) {
      fm.downloadFileFromiCloud(corePath);
    }
    core = importModule(corePath);
  } catch (e) {
    return errorWidget(`加载核心脚本失败：${e.message}`);
  }

  try {
    return await core.buildWidget({
      family: config.widgetFamily || "medium",
      fileManager: fm,
      cacheDir,
      version: `dev@${BRANCH}`,
      notice: null,
    });
  } catch (e) {
    return errorWidget(`运行出错：${e.message}`);
  }
}

const widget = await main();

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}

Script.complete();
