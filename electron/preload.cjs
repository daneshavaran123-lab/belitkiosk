/**
 * پل امن بین برنامهٔ دسکتاپ و صفحهٔ وب.
 * اعلام می‌کند که برنامه داخل نسخهٔ ویندوزی اجرا می‌شود و توکن سرویس کارت‌خوان همین کامپیوتر
 * را (که نصب‌کننده ساخته) به صفحه‌های خود برنامه می‌دهد تا وارد کردن آن در پنل مدیریت لازم نباشد.
 */
const { contextBridge, ipcRenderer } = require("electron");

const info = ipcRenderer.sendSync("kiosk:info") || {};

contextBridge.exposeInMainWorld("museumKiosk", {
  isDesktop: true,
  platform: process.platform,
  appVersion: info.appVersion ?? "1.0.0",
  posAccessToken: info.posAccessToken ?? "",
});
