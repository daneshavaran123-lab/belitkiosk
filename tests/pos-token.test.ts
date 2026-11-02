import { afterEach, describe, expect, it, vi } from "vitest";
import { getDesktopPosToken, getPosAccessToken, setPosAccessToken } from "@/lib/pos";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const stubWindow = (museumKiosk?: unknown) => vi.stubGlobal("window", { museumKiosk });

describe("توکن سرویس کارت‌خوان", () => {
  afterEach(() => store.clear());

  it("در مرورگر همان توکن ذخیره‌شده در پنل است", () => {
    stubWindow(undefined);
    expect(getPosAccessToken()).toBe("");
    setPosAccessToken(" panel-token ");
    expect(getDesktopPosToken()).toBe("");
    expect(getPosAccessToken()).toBe("panel-token");
  });

  it("در برنامهٔ ویندوزی توکن نصب‌کننده بر توکن پنل مقدم است", () => {
    stubWindow({ isDesktop: true, posAccessToken: "installer-token" });
    setPosAccessToken("old-panel-token");
    expect(getDesktopPosToken()).toBe("installer-token");
    expect(getPosAccessToken()).toBe("installer-token");
  });

  it("اگر برنامهٔ ویندوزی توکن نداشت، توکن پنل استفاده می‌شود", () => {
    stubWindow({ isDesktop: true, posAccessToken: "" });
    setPosAccessToken("panel-token");
    expect(getPosAccessToken()).toBe("panel-token");
    stubWindow({ isDesktop: true, posAccessToken: 42 });
    expect(getPosAccessToken()).toBe("panel-token");
  });
});
