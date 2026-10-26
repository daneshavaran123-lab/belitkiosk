/**
 * ساخت نسخهٔ ویندوزی (Electron) — اجرا: npm run desktop:package
 *
 * مراحل:
 *   1) build برنامه با preset «node_server» (خروجی .output)
 *   2) بسته‌بندی با @electron/packager برای ویندوز x64
 *   3) کپی نصب‌کننده‌ها کنار خروجی
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "electron-release");
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env } });

console.log("\n▶ ۱/۳ ساخت خروجی برنامه...");
process.env.NITRO_PRESET = "node_server";
run("npx vite build");

if (!fs.existsSync(path.join(root, ".output", "server", "index.mjs"))) {
  console.error("✗ خروجی .output/server/index.mjs ساخته نشد.");
  process.exit(1);
}

console.log("\n▶ ۲/۳ بسته‌بندی برنامهٔ ویندوزی...");
const iconArg = fs.existsSync(path.join(root, "electron", "icon.ico"))
  ? ` --icon="${path.join(root, "electron", "icon.ico")}"`
  : "";

run(
  [
    "npx @electron/packager .",
    '"MuseumKiosk"',
    "--platform=win32 --arch=x64",
    `--out="${out}" --overwrite`,
    '--app-copyright="Iran Wrestling Museum"',
    "--ignore=\"^/src$\" --ignore=\"^/public$\" --ignore=\"^/tests$\" --ignore=\"^/docs$\"",
    '--ignore="^/pos-bridge" --ignore="^/scripts" --ignore="^/electron-release"',
    '--ignore="^/supabase" --ignore="^/.lovable" --ignore="^/.github"',
    "--extra-resource=.output",
    iconArg,
  ].join(" "),
);

// nitro خروجی را در resources/.output می‌گذارد؛ برنامه انتظار resources/app/.output دارد
const pkgDir = path.join(out, "MuseumKiosk-win32-x64");
const resources = path.join(pkgDir, "resources");
const shipped = path.join(resources, ".output");
const target = path.join(resources, "app", ".output");
if (fs.existsSync(shipped)) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(shipped, target);
}

console.log("\n▶ ۳/۳ کپی نصب‌کننده‌ها...");
for (const f of ["install-windows.bat", "uninstall-windows.bat"]) {
  const src = path.join(root, "installers", f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, f));
}

console.log(`\n✅ آماده شد: ${pkgDir}`);
console.log("   برای نصب روی کیوسک، کل پوشهٔ electron-release را کپی و install-windows.bat را اجرا کنید.");
