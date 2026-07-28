// Variables used by Scriptable.
// These must be at the very top of the file. Comments must be Icon-Color: blue; Icon-Glyph: cloud-sun;

// ============================================================================
//  Weather Widget · 引导脚本 (bootstrap)
// ============================================================================
//  装进 Scriptable 之后就不用再碰这个文件了。它做四件事：
//    1. 从 GitHub 读 version.json，比对本地已安装版本
//    2. 版本更新了就下载最新的核心脚本，缓存到本地
//    3. 如果连引导脚本自己也有新版，覆盖 module.filename 实现自更新
//    4. 加载本地缓存的核心脚本并运行
//
//  以后改功能只要 push 到 GitHub 并把 version.json 的 version 加一位，
//  手机上的组件下次刷新就会自己更新。
// ============================================================================

// @scriptable-weather-bootstrap  ← 自更新时用来校验下载内容的哨兵，别删

const GITHUB_USER   = "LilMuh";
const GITHUB_REPO   = "scriptable-weather-widget";
const GITHUB_BRANCH = "main";

const BOOTSTRAP_VERSION = "1.1.0";
const BOOTSTRAP_PATH_IN_REPO = "bootstrap/Weather.js";
const BOOTSTRAP_SENTINEL = "@scriptable-weather-bootstrap";

// 本地缓存目录名（放在 Scriptable 文档目录下）
const CACHE_DIR_NAME = "weather-widget";

const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;

// ---------------------------------------------------------------------------
// 文件系统：iCloud 开启时用 iCloud，否则退回本地
// ---------------------------------------------------------------------------
function getFileManager() {
  try {
    const fm = FileManager.iCloud();
    fm.documentsDirectory();
    return fm;
  } catch (e) {
    return FileManager.local();
  }
}

const fm = getFileManager();
const cacheDir = fm.joinPath(fm.documentsDirectory(), CACHE_DIR_NAME);
if (!fm.fileExists(cacheDir)) fm.createDirectory(cacheDir, true);

const corePath = fm.joinPath(cacheDir, "core.js");
const metaPath = fm.joinPath(cacheDir, "meta.json");

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 读本地 JSON，失败返回 fallback */
function readJSON(path, fallback) {
  try {
    if (!fm.fileExists(path)) return fallback;
    ensureDownloaded(path);
    return JSON.parse(fm.readString(path));
  } catch (e) {
    return fallback;
  }
}

/** iCloud 上的文件可能只是占位符，读之前先确保已下载 */
function ensureDownloaded(path) {
  if (typeof fm.isFileDownloaded === "function" && !fm.isFileDownloaded(path)) {
    fm.downloadFileFromiCloud(path);
  }
}

/** 带超时的文本请求；raw.githubusercontent 有 ~5 分钟 CDN 缓存，加时间戳绕过 */
async function fetchText(pathInRepo, timeout = 10) {
  const req = new Request(`${RAW_BASE}/${pathInRepo}?t=${Date.now()}`);
  req.timeoutInterval = timeout;
  const text = await req.loadString();
  if (req.response && req.response.statusCode >= 400) {
    throw new Error(`HTTP ${req.response.statusCode} for ${pathInRepo}`);
  }
  return text;
}

/** 简易语义化版本比较：a > b 返回 true */
function isNewer(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 更新流程
// ---------------------------------------------------------------------------

/**
 * 检查并按需更新核心脚本。
 * 任何一步失败都不抛错——只要本地还有旧版核心脚本，组件就照常显示。
 * @returns {{updated: boolean, version: string, bootstrapOutdated: boolean, error: string|null}}
 */
async function syncCore() {
  const meta = readJSON(metaPath, { version: "0.0.0" });
  const hasCore = fm.fileExists(corePath);
  const result = {
    updated: false,
    version: meta.version,
    bootstrapOutdated: false,
    error: null,
  };

  let remote;
  try {
    remote = JSON.parse(await fetchText("version.json", 8));
  } catch (e) {
    // 拉不到版本信息（没网 / 仓库地址写错）：有本地缓存就继续用
    result.error = hasCore ? null : `无法连接 GitHub：${e.message}`;
    return result;
  }

  if (remote.bootstrapVersion && isNewer(remote.bootstrapVersion, BOOTSTRAP_VERSION)) {
    result.bootstrapOutdated = true;
  }

  const needUpdate = !hasCore || isNewer(remote.version, meta.version);
  if (!needUpdate) {
    result.version = meta.version;
    return result;
  }

  try {
    const entry = remote.entry || "src/weather-widget.js";
    const code = await fetchText(entry, 15);
    if (!code || code.length < 200) throw new Error("下载内容异常");

    fm.writeString(corePath, code);
    fm.writeString(metaPath, JSON.stringify({
      version: remote.version,
      installedAt: new Date().toISOString(),
      entry,
    }, null, 2));

    result.updated = true;
    result.version = remote.version;
  } catch (e) {
    // 下载新版失败，自动回退：旧的 core.js 还在，meta.json 也没动
    result.error = hasCore ? null : `下载脚本失败：${e.message}`;
  }

  return result;
}

/**
 * 引导脚本自更新：把最新版写回本脚本自己的文件，下次运行生效。
 *
 * module.filename 是当前脚本的绝对路径，所以不管用户把脚本命名成什么、
 * 放在 iCloud 还是本地，都能定位到正确的文件。
 *
 * 写入前必须通过三重校验，宁可不更新也不能把自己写坏：
 *   - 内容里含哨兵注释（确认下载到的确实是引导脚本，不是 404 页面）
 *   - 长度合理
 *   - 含关键调用 Script.setWidget
 *
 * @returns {string|null} 给组件显示的提示文案；无事发生返回 null
 */
async function selfUpdateBootstrap() {
  let code;
  try {
    code = await fetchText(BOOTSTRAP_PATH_IN_REPO, 15);
  } catch (e) {
    return "引导脚本有新版，下载失败";
  }

  if (!code.includes(BOOTSTRAP_SENTINEL) || code.length < 2000 || !code.includes("Script.setWidget")) {
    return "引导脚本有新版，内容校验未通过";
  }

  try {
    fm.writeString(module.filename, code);
    return "引导脚本已更新，下次刷新生效";
  } catch (e) {
    return "引导脚本有新版，写入失败";
  }
}

// ---------------------------------------------------------------------------
// 出错时的兜底组件
// ---------------------------------------------------------------------------
function buildErrorWidget(message) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#2b2b2b");
  w.setPadding(16, 16, 16, 16);

  const title = w.addText("⚠️ 天气组件");
  title.font = Font.semiboldSystemFont(14);
  title.textColor = Color.white();

  w.addSpacer(6);

  const body = w.addText(message);
  body.font = Font.systemFont(11);
  body.textColor = new Color("#ffffff", 0.7);
  body.lineLimit = 4;

  w.addSpacer(4);

  const hint = w.addText("确认仓库是 public，且网络可访问 raw.githubusercontent.com");
  hint.font = Font.systemFont(10);
  hint.textColor = new Color("#ffffff", 0.45);

  return w;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  const sync = await syncCore();

  if (sync.error) return buildErrorWidget(sync.error);

  const notice = sync.bootstrapOutdated ? await selfUpdateBootstrap() : null;

  let core;
  try {
    ensureDownloaded(corePath);
    core = importModule(corePath);
  } catch (e) {
    return buildErrorWidget(`加载核心脚本失败：${e.message}`);
  }

  try {
    return await core.buildWidget({
      family: config.widgetFamily || "medium",
      fileManager: fm,
      cacheDir,
      version: sync.version,
      notice,
    });
  } catch (e) {
    return buildErrorWidget(`运行出错：${e.message}`);
  }
}

const widget = await main();

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}

Script.complete();
