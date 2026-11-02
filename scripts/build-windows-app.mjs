/**
 * ساخت نسخهٔ ویندوزی کامل — اجرا: npm run desktop:package
 *
 * خروجی: release/MuseumKiosk-Windows/ (و release/MuseumKiosk-Windows.zip)
 *   MuseumKiosk-win32-x64/   برنامهٔ دسکتاپ (Electron) با سرور داخلی
 *   pos-bridge/              سرویس کارت‌خوان (PosBridge.exe، run.bat، ابزارها)
 *   install-windows.bat      نصب (با Run as administrator)
 *   uninstall-windows.bat    حذف
 *   README.md                راهنمای نصب
 *
 * پیش‌نیاز: Node 22.12+ و .NET SDK 8 (برای سرویس کارت‌خوان).
 * نسخهٔ Electron با متغیر ELECTRON_VERSION قابل تغییر است. روی ویندوز، لینوکس و مک کار می‌کند
 * (آیکون و مشخصات exe با resedit نوشته می‌شود و wine لازم نیست).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ELECTRON_VERSION = process.env.ELECTRON_VERSION || "44.7.0";
const APP_VERSION = process.env.APP_VERSION || "1.0.0";
const isWindows = process.platform === "win32";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.join(root, "release");
// ابزار بسته‌بندی و همهٔ وابستگی‌هایش در scripts/packager/package-lock.json قفل است
const packagerDir = path.join(root, "scripts", "packager");
const out = path.join(releaseRoot, "MuseumKiosk-Windows");
const zipFile = path.join(releaseRoot, "MuseumKiosk-Windows.zip");

const run = (cmd, env = {}) =>
  execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
const has = (cmd) => {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

/** کپی فایل؛ اسکریپت‌های ویندوز با پایان خط CRLF نوشته می‌شوند */
function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (/\.(bat|cmd|ps1)$/i.test(src)) {
    const text = fs.readFileSync(src, "utf8").replace(/\r?\n/g, "\r\n");
    fs.writeFileSync(dest, text);
  } else {
    fs.copyFileSync(src, dest);
  }
}

function copyDir(src, dest) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(zipFile, { force: true });
fs.mkdirSync(out, { recursive: true });

console.log("\n▶ ۱/۵ ساخت خروجی برنامه...");
run("npx vite build", { NITRO_PRESET: "node_server" });
if (!fs.existsSync(path.join(root, ".output", "server", "index.mjs"))) {
  fail("خروجی .output/server/index.mjs ساخته نشد.");
}

console.log(`\n▶ ۲/۵ بسته‌بندی برنامهٔ ویندوزی (Electron ${ELECTRON_VERSION})...`);
const icon = path.join(root, "electron", "icon.ico");
// برنامهٔ اصلی فقط package.json و electron/ را لازم دارد؛ سرور (.output) جدا اضافه می‌شود و بقیه کنار می‌رود
const ignore = "^/(?!(package\\.json|electron)($|/)).+";
run(`npm ci --prefix "${packagerDir}" --no-audit --no-fund`);
const packager = path.join(
  packagerDir,
  "node_modules",
  "@electron",
  "packager",
  "bin",
  "electron-packager.mjs",
);
run(
  [
    `node "${packager}" .`,
    '"MuseumKiosk"',
    "--platform=win32 --arch=x64",
    `--electron-version=${ELECTRON_VERSION}`,
    // بدون asar تا electron/main.cjs و سرور داخلی هر دو در resources/app باشند
    `--out="${out}" --overwrite --no-prune --no-asar`,
    `--app-version=${APP_VERSION}`,
    '--app-copyright="Iran Wrestling Museum"',
    '--win32metadata.CompanyName="Iran Wrestling Museum"',
    '--win32metadata.ProductName="MuseumKiosk"',
    '--win32metadata.FileDescription="Iran Wrestling Museum Kiosk"',
    `--ignore="${ignore}"`,
    "--extra-resource=.output",
    fs.existsSync(icon) ? `--icon="${icon}"` : "",
  ].join(" "),
);

// packager خروجی را در resources/.output می‌گذارد؛ برنامه آن را در resources/app/.output می‌خواهد
const pkgDir = path.join(out, "MuseumKiosk-win32-x64");
const resources = path.join(pkgDir, "resources");
const shipped = path.join(resources, ".output");
const target = path.join(resources, "app", ".output");
if (!fs.existsSync(shipped)) fail("خروجی سرور در بستهٔ Electron پیدا نشد.");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.rmSync(target, { recursive: true, force: true });
fs.renameSync(shipped, target);

console.log("\n▶ ۳/۵ ساخت سرویس کارت‌خوان (pos-bridge)...");
if (!has("dotnet --version")) {
  fail(
    "‏.NET SDK 8 نصب نیست؛ سرویس کارت‌خوان بدون آن ساخته نمی‌شود (https://dotnet.microsoft.com/download).",
  );
}
const bridgeSrc = path.join(root, "pos-bridge");
const bridgeOut = path.join(out, "pos-bridge");
run(
  `dotnet build "${path.join(bridgeSrc, "PosBridge.csproj")}" -c Release -o "${path.join(bridgeOut, "bin", "Release", "net48")}"`,
);
if (!fs.existsSync(path.join(bridgeOut, "bin", "Release", "net48", "PosBridge.exe"))) {
  fail("PosBridge.exe ساخته نشد.");
}
copyFile(path.join(bridgeSrc, "run.bat"), path.join(bridgeOut, "run.bat"));
copyFile(path.join(bridgeSrc, "README.md"), path.join(bridgeOut, "README.md"));
copyDir(path.join(bridgeSrc, "tools"), path.join(bridgeOut, "tools"));

console.log("\n▶ ۴/۵ نصب‌کننده و راهنما...");
for (const f of ["install-windows.bat", "uninstall-windows.bat"]) {
  copyFile(path.join(root, "installers", f), path.join(out, f));
}
copyFile(path.join(root, "docs", "WINDOWS-APP.md"), path.join(out, "README.md"));

console.log("\n▶ ۵/۵ فشرده‌سازی...");
if (isWindows) {
  run(
    `powershell -NoProfile -Command "Compress-Archive -Path '${out}' -DestinationPath '${zipFile}' -Force"`,
  );
} else if (has("zip -v")) {
  execSync(`zip -qr "${zipFile}" "${path.basename(out)}"`, { cwd: releaseRoot, stdio: "inherit" });
} else {
  console.warn("⚠ ابزار zip پیدا نشد؛ فقط پوشهٔ خروجی ساخته شد.");
}

console.log(`\n✅ آماده شد: ${out}`);
if (fs.existsSync(zipFile)) console.log(`   فایل فشرده: ${zipFile}`);
console.log(
  "   روی کیوسک: پوشه را کپی کنید و install-windows.bat را با Run as administrator اجرا کنید.",
);
