/**
 * پل امن بین برنامهٔ دسکتاپ و صفحهٔ وب.
 * فقط اعلام می‌کند که برنامه داخل نسخهٔ ویندوزی اجرا می‌شود — هیچ API حساسی باز نمی‌شود.
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("museumKiosk", {
  isDesktop: true,
  platform: process.platform,
  appVersion: process.env["npm_package_version"] ?? "1.0.0",
});
