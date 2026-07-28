// ============================================================================
//  一行安装器
// ============================================================================
//  在 Scriptable 里新建一个空脚本，粘贴下面这一行，运行一次，
//  脚本列表里就会出现 "Weather"。之后这个安装器可以删掉。
//
//  （引导脚本装好后会自己更新自己，所以这一行一辈子只需要跑一次。）
// ============================================================================

//  手机上直接打开 1.js 的 raw 地址「全选 → 拷贝」更方便，那个文件里只有这一行：
//  raw.githubusercontent.com/LilMuh/scriptable-weather-widget/main/1.js

// ↓↓↓ 复制这一行 ↓↓↓
let fm;try{fm=FileManager.iCloud();fm.documentsDirectory()}catch(e){fm=FileManager.local()}fm.writeString(fm.joinPath(fm.documentsDirectory(),"Weather.js"),await new Request("https://raw.githubusercontent.com/LilMuh/scriptable-weather-widget/main/bootstrap/Weather.js").loadString());let a=new Alert();a.title="Weather 已安装";a.message="回到脚本列表就能看到";a.addAction("好");await a.present();
// ↑↑↑ 复制这一行 ↑↑↑


// ---------------------------------------------------------------------------
// 上面那行展开后就是下面这段，逻辑一样，方便看懂：
// ---------------------------------------------------------------------------
//
//   const URL = "https://raw.githubusercontent.com/LilMuh/scriptable-weather-widget/main/bootstrap/Weather.js";
//
//   // iCloud 开着就用 iCloud 目录（能在"文件"App 里看到），否则用本地目录
//   let fm;
//   try {
//     fm = FileManager.iCloud();
//     fm.documentsDirectory();
//   } catch (e) {
//     fm = FileManager.local();
//   }
//
//   // documentsDirectory() 就是 Scriptable 存放脚本的地方，
//   // 往里写一个 .js 文件，它就会作为脚本出现在列表里
//   const code = await new Request(URL).loadString();
//   fm.writeString(fm.joinPath(fm.documentsDirectory(), "Weather.js"), code);
//
