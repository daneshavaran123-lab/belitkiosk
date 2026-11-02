import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WINDOWS_DOWNLOAD_URL, resolveWindowsDownloadUrl } from "@/lib/windows-download";

describe("resolveWindowsDownloadUrl", () => {
  it("بدون تنظیم، آخرین Release گیت‌هاب را می‌دهد", () => {
    expect(resolveWindowsDownloadUrl(undefined)).toBe(DEFAULT_WINDOWS_DOWNLOAD_URL);
    expect(resolveWindowsDownloadUrl("  ")).toBe(DEFAULT_WINDOWS_DOWNLOAD_URL);
    expect(DEFAULT_WINDOWS_DOWNLOAD_URL).toMatch(
      /^https:\/\/github\.com\/.+\/releases\/latest\/download\/MuseumKiosk-Windows\.zip$/,
    );
  });

  it("آدرس https تنظیم‌شده (مثلاً فضای ذخیره‌سازی لیارا) را می‌دهد", () => {
    const url = "https://kiosk.storage.example.ir/MuseumKiosk-Windows.zip";
    expect(resolveWindowsDownloadUrl(` ${url} `)).toBe(url);
  });

  it("آدرس نامعتبر یا غیر https پذیرفته نمی‌شود", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of ["not a url", "http://example.com/a.zip", "javascript:alert(1)"]) {
      expect(resolveWindowsDownloadUrl(bad)).toBe(DEFAULT_WINDOWS_DOWNLOAD_URL);
    }
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});
