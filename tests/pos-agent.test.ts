import { describe, expect, it } from "vitest";
import { agentStatusLabel, mapAgentResult, type AgentPaymentResult } from "@/lib/pos-agent";

const base: AgentPaymentResult = {
  TransactionId: "t-1",
  Success: false,
  Status: "Failed",
  Amount: 10000,
  CompletedAt: new Date().toISOString(),
};

describe("mapAgentResult", () => {
  it("تراکنش موفق را با شمارهٔ پیگیری و کارت ماسک‌شده برمی‌گرداند", () => {
    const r = mapAgentResult({
      ...base,
      Success: true,
      Status: "Success",
      Rrn: "123456789012",
      CardNumberMasked: "6037-****-****-1234",
    });
    expect(r.success).toBe(true);
    expect(r.refNumber).toBe("123456789012");
    expect(r.maskedPan).toBe("6037-****-****-1234");
    expect(r.responseCode).toBe("00");
  });

  it("Status=Success بدون پرچم Success هم موفق محسوب می‌شود", () => {
    const r = mapAgentResult({ ...base, Status: "Success", Rrn: "999" });
    expect(r.success).toBe(true);
  });

  it("Timeout به پیام فارسی پایان زمان نگاشت می‌شود", () => {
    const r = mapAgentResult({ ...base, Status: "Timeout" });
    expect(r.success).toBe(false);
    expect(r.message).toContain("زمان انتظار");
  });

  it("Cancelled به پیام لغو نگاشت می‌شود", () => {
    const r = mapAgentResult({ ...base, Status: "Cancelled" });
    expect(r.success).toBe(false);
    expect(r.message).toContain("لغو");
  });

  it("Failed پیام ErrorMessage خود Agent را نشان می‌دهد", () => {
    const r = mapAgentResult({
      ...base,
      Status: "Failed",
      ErrorCode: "51",
      ErrorMessage: "موجودی کافی نیست",
    });
    expect(r.success).toBe(false);
    expect(r.message).toBe("موجودی کافی نیست");
    expect(r.responseCode).toBe("51");
  });

  it("Error بدون ErrorMessage پیام پیش‌فرض می‌گیرد", () => {
    const r = mapAgentResult({ ...base, Status: "Error" });
    expect(r.success).toBe(false);
    expect(r.message).toBe("تراکنش ناموفق بود");
  });
});

describe("agentStatusLabel", () => {
  it("برچسب فارسی برای همهٔ وضعیت‌ها دارد", () => {
    expect(agentStatusLabel("WaitingForCard")).toContain("کارت");
    expect(agentStatusLabel("Processing")).toContain("پردازش");
    expect(agentStatusLabel("Success")).toBeTruthy();
    expect(agentStatusLabel("Timeout")).toBeTruthy();
    expect(agentStatusLabel("Cancelled")).toBeTruthy();
    expect(agentStatusLabel("Failed")).toBeTruthy();
    expect(agentStatusLabel("Error")).toBeTruthy();
  });
});
