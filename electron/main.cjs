/**
 * موزهٔ افتخارات کشتی ایران — نسخهٔ دسکتاپ ویندوز (Electron)
 *
 * برنامه سرور داخلی برنامه (خروجی build) را روی 127.0.0.1 بالا می‌آورد و
 * همان را در یک پنجرهٔ کیوسک ۱۰۸۰×۱۹۲۰ نمایش می‌دهد. هیچ مرورگر بیرونی لازم نیست.
 */
const { app, BrowserWindow, globalShortcut, shell, dialog, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const { pathToFileURL } = require("node:url");

const KIOSK_WIDTH = 1080;
const KIOSK_HEIGHT = 1920;
const DEFAULT_PORT = 41890;

/** ریشهٔ فایل‌های برنامه (هم در حالت توسعه و هم در بستهٔ نصب‌شده) */
function appRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "app") : path.join(__dirname, "..");
}

function serverEntry() {
  return path.join(appRoot(), ".output", "server", "index.mjs");
}

/** آدرس سرور داخلی (مثلاً http://127.0.0.1:41890)؛ بعد از بالا آمدن سرور مقدار می‌گیرد */
let appOrigin = "";

/** فقط صفحه‌های خود برنامه */
function isAppUrl(url) {
  try {
    return appOrigin !== "" && new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

/** لینک‌های بیرونی فقط http/https و در مرورگر پیش‌فرض */
function openExternalSafe(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

/**
 * appsettings.json سرویس کارت‌خوان: کنار برنامهٔ نصب‌شده (install-windows.bat) یا، اگر برنامه
 * مستقیم از پوشهٔ zip اجرا شود، در پوشهٔ pos-bridge کنار آن
 */
function bridgeSettingsPaths() {
  if (process.env.POS_BRIDGE_SETTINGS) return [process.env.POS_BRIDGE_SETTINGS];
  const exeDir = path.dirname(process.execPath);
  const rel = ["pos-bridge", "bin", "Release", "net48", "appsettings.json"];
  return [path.join(exeDir, ...rel), path.join(exeDir, "..", ...rel)];
}

/** توکن سرویس کارت‌خوان که نصب‌کننده ساخته؛ هر بار از فایل خوانده می‌شود تا تغییرش اعمال شود */
function readBridgeToken() {
  for (const file of bridgeSettingsPaths()) {
    try {
      const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
      const token = JSON.parse(text).accessToken;
      return typeof token === "string" ? token : "";
    } catch {
      // فایل نیست یا خراب است؛ مسیر بعدی
    }
  }
  return "";
}

// preload این را هنگام بارگذاری هر صفحه می‌خواند؛ توکن فقط به صفحه‌های خود برنامه داده می‌شود
ipcMain.on("kiosk:info", (event) => {
  event.returnValue = {
    appVersion: app.getVersion(),
    posAccessToken: isAppUrl(event.senderFrame?.url ?? "") ? readBridgeToken() : "",
  };
});

/** پیدا کردن یک پورت آزاد محلی */
function findFreePort(preferred) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(0));
    srv.listen(preferred, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startInternalServer() {
  const entry = serverEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(
      "فایل‌های اجرایی برنامه پیدا نشد.\n" +
        "قبل از ساخت بسته، دستور «npm run build» را اجرا کنید.\n" +
        entry,
    );
  }

  let port = await findFreePort(DEFAULT_PORT);
  if (!port) port = await findFreePort(0);

  process.env.HOST = "127.0.0.1";
  process.env.PORT = String(port);
  process.env.NODE_ENV = "production";

  // خروجی nitro یک ماژول ESM است؛ داخل Electron با import پویا اجرا می‌شود.
  await import(pathToFileURL(entry).href);

  await waitForServer(port);
  return port;
}

function waitForServer(port, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const socket = net.connect({ port, host: "127.0.0.1" });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error("سرور داخلی بالا نیامد."));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

let mainWindow = null;

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: KIOSK_WIDTH,
    height: KIOSK_HEIGHT,
    backgroundColor: "#0b1626",
    autoHideMenuBar: true,
    fullscreen: true,
    kiosk: true,
    show: false,
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // اجازهٔ فراخوانی سرویس محلی کارت‌خوان روی http://127.0.0.1:9099
      webSecurity: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadURL(url);

  // منوی راست‌کلیک غیرفعال
  mainWindow.webContents.on("context-menu", (e) => e.preventDefault());

  // لینک‌های خارجی در مرورگر پیش‌فرض باز شوند، نه داخل کیوسک
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    openExternalSafe(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (isAppUrl(target)) return;
    event.preventDefault();
    openExternalSafe(target);
  });
}

function registerShortcuts() {
  // خروج اضطراری
  globalShortcut.register("Control+Shift+Q", () => app.quit());
  // بارگذاری مجدد
  globalShortcut.register("F5", () => mainWindow?.webContents.reload());
  // ابزار توسعه‌دهنده برای پشتیبانی
  globalShortcut.register("Control+Shift+I", () => mainWindow?.webContents.toggleDevTools());
}

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("high-dpi-support", "1");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-pinch");

// فقط یک نسخه از برنامه اجرا شود
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const port = await startInternalServer();
      appOrigin = `http://127.0.0.1:${port}`;
      createWindow(`${appOrigin}/`);
      registerShortcuts();
    } catch (err) {
      dialog.showErrorBox("اجرای برنامهٔ موزه ناموفق بود", String(err?.message ?? err));
      app.quit();
    }
  });
}

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
