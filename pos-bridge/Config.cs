using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;

namespace PosBridge
{
    internal class Config
    {
        public string ListenUrl = "http://127.0.0.1:9099/";

        /// <summary>«lan» = اتصال شبکه‌ای با IP، «com» = اتصال USB/سریال</summary>
        public string ConnectionMode = "lan";

        public string DeviceIp = "192.168.16.160";
        /// <summary>رابط فیزیکی شبکهٔ کارت‌خوان: lan (کابل) یا wifi</summary>
        public string NetworkInterface = "lan";
        /// <summary>پورت PC-POS روی خود دستگاه</summary>
        public int DevicePort = 17000;

        public string MerchantId = "6618774";
        public string TerminalId = "5634056";

        /// <summary>شماره سریال روی برچسب دستگاه (فقط برای شناسایی و لاگ)</summary>
        public string SerialNumber = "2500206135";
        /// <summary>مدل ثبت‌شدهٔ دستگاه (برای تطبیق شناسنامه)</summary>
        public string Model = "PAX Q58 LAN + LINE + WIFI";
        /// <summary>نسخهٔ فریم‌ور ثبت‌شدهٔ دستگاه</summary>
        public string Firmware = "16.00.31";

        /// <summary>رمز منوی خود دستگاه — هرگز به مرورگر فرستاده نمی‌شود</summary>
        public string DevicePassword = "";

        /// <summary>
        /// هش رمز متصدی برای تأیید پرداخت نقدی (PBKDF2، از پنل مدیریت تنظیم می‌شود). خالی یعنی
        /// پرداخت نقدی در کیوسک غیرفعال است. اگر رمز فراموش شد، این مقدار را در فایل خالی کنید.
        /// </summary>
        public string CashierPinHash = "";

        /// <summary>
        /// توکن دسترسی؛ اگر تنظیم شود همهٔ مسیرها به‌جز /health فقط با هدر X-Pos-Token پاسخ می‌دهند.
        /// همین مقدار را در «پنل مدیریت ← تنظیمات کارت‌خوان» وارد کنید.
        /// </summary>
        public string AccessToken = "";

        public string SignCode = "";
        public string ComPort = "COM3";
        public int BaudRate = 115200;

        /// <summary>حداکثر زمان انتظار برای کشیدن کارت و پاسخ دستگاه (ثانیه)</summary>
        public int TimeoutSeconds = 120;

        /// <summary>آدرس‌هایی (Origin) که اجازهٔ صدا زدن سرویس را دارند؛ بقیه رد می‌شوند</summary>
        public List<string> AllowedOrigins = new List<string>();
        /// <summary>اجازه به صفحه‌های http://127.0.0.1:* و http://localhost:* (برنامهٔ دسکتاپ Electron)</summary>
        public bool AllowLoopbackOrigins = true;

        public bool Simulate;

        /// <summary>native = پیاده‌سازی مستقیم پروتکل (پیش‌فرض)، sdk = کتابخانهٔ رسمی PosInterface.dll</summary>
        public string Protocol = "native";
        /// <summary>auto | same | callback — نحوهٔ برگشت پاسخ دستگاه (توضیح در PcPosLanClient)</summary>
        public string ResponseMode = "auto";
        /// <summary>پورت شنود کیوسک برای پاسخ برگشتی؛ ۰ یعنی همان DevicePort</summary>
        public int CallbackPort;
        /// <summary>فیلد pcposAppId درخواست؛ کتابخانهٔ رسمی به‌طور پیش‌فرض خالی می‌فرستد</summary>
        public string PcposAppId = "";
        /// <summary>حداکثر تعداد رقم شمارهٔ فاکتوری که به دستگاه فرستاده می‌شود</summary>
        public int InvoiceMaxDigits = 12;
        public int ConnectTimeoutSeconds = 10;
        /// <summary>بعد از لغو در کیوسک چند ثانیه منتظر نتیجهٔ نهایی دستگاه بمانیم</summary>
        public int CancelGraceSeconds = 20;
        /// <summary>تا چند ثانیه بعد از پایان انتظار، پاسخ دیرهنگام دستگاه ثبت شود</summary>
        public int LateResponseSeconds = 180;
        /// <summary>سقف مبلغ یک تراکنش (ریال) برای جلوگیری از مبلغ اشتباه</summary>
        public long MaxAmountRial = 1000000000;
        /// <summary>تراکنش بدون شمارهٔ مرجع (RRN) موفق حساب نشود</summary>
        public bool RequireRrn = true;
        /// <summary>مسیر دفتر تراکنش‌ها (نسبت به پوشهٔ برنامه)</summary>
        public string JournalPath = "data/transactions.jsonl";

        /// <summary>نام پرینتر حرارتی ۸۰ میلی‌متری در ویندوز — خالی یعنی پرینتر پیش‌فرض</summary>
        public string PrinterName = "";
        public string PrinterFont = "Tahoma";
        public bool PrintEnabled = true;

        public bool IsLan
        {
            get { return (ConnectionMode ?? "lan").ToLowerInvariant() == "lan"; }
        }

        /// <summary>پیاده‌سازی مستقیم فقط شبکه‌ای است؛ اتصال سریال از کتابخانهٔ رسمی استفاده می‌کند</summary>
        public string EffectiveProtocol
        {
            get { return Protocol == "native" && !IsLan ? "sdk" : Protocol; }
        }

        public static Config Load(string path)
        {
            var cfg = new Config();
            if (!File.Exists(path)) return cfg.Normalize();

            Dictionary<string, object> raw;
            try
            {
                raw = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
            }
            catch (Exception ex)
            {
                PosLog.Error("config", "فایل تنظیمات خوانده نشد؛ مقادیر پیش‌فرض استفاده می‌شود: " + ex.Message);
                return cfg.Normalize();
            }
            if (raw == null) return cfg.Normalize();

            Func<string, string> s = k => raw.ContainsKey(k) && raw[k] != null ? Convert.ToString(raw[k], CultureInfo.InvariantCulture) : null;
            Action<string, Action<string>> str = (k, set) => { var v = s(k); if (v != null) set(v); };
            Action<string, Action<int>> num = (k, set) => { int v; if (int.TryParse(s(k), NumberStyles.Integer, CultureInfo.InvariantCulture, out v)) set(v); };
            Action<string, Action<bool>> flag = (k, set) => { bool v; if (bool.TryParse(s(k), out v)) set(v); };

            str("listenUrl", v => cfg.ListenUrl = v);
            str("connectionMode", v => cfg.ConnectionMode = v);
            str("deviceIp", v => cfg.DeviceIp = v);
            str("networkInterface", v => cfg.NetworkInterface = v);
            num("devicePort", v => cfg.DevicePort = v);
            str("merchantId", v => cfg.MerchantId = v);
            str("terminalId", v => cfg.TerminalId = v);
            str("serialNumber", v => cfg.SerialNumber = v);
            str("model", v => cfg.Model = v);
            str("firmware", v => cfg.Firmware = v);
            str("devicePassword", v => cfg.DevicePassword = v);
            str("cashierPinHash", v => cfg.CashierPinHash = v);
            str("accessToken", v => cfg.AccessToken = v);
            str("signCode", v => cfg.SignCode = v);
            str("comPort", v => cfg.ComPort = v);
            num("baudRate", v => cfg.BaudRate = v);
            str("protocol", v => cfg.Protocol = v);
            str("responseMode", v => cfg.ResponseMode = v);
            num("callbackPort", v => cfg.CallbackPort = v);
            str("pcposAppId", v => cfg.PcposAppId = v);
            num("invoiceMaxDigits", v => cfg.InvoiceMaxDigits = v);
            num("connectTimeoutSeconds", v => cfg.ConnectTimeoutSeconds = v);
            num("cancelGraceSeconds", v => cfg.CancelGraceSeconds = v);
            num("lateResponseSeconds", v => cfg.LateResponseSeconds = v);
            str("maxAmountRial", v => { long l; if (long.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out l)) cfg.MaxAmountRial = l; });
            flag("requireRrn", v => cfg.RequireRrn = v);
            str("journalPath", v => cfg.JournalPath = v);
            flag("allowLoopbackOrigins", v => cfg.AllowLoopbackOrigins = v);
            str("printerName", v => cfg.PrinterName = v);
            str("printerFont", v => cfg.PrinterFont = v);
            flag("printEnabled", v => cfg.PrintEnabled = v);
            num("timeoutSeconds", v => cfg.TimeoutSeconds = v);
            flag("simulate", v => cfg.Simulate = v);
            if (raw.ContainsKey("allowedOrigins"))
            {
                var arr = raw["allowedOrigins"] as System.Collections.ArrayList;
                if (arr != null)
                    foreach (var o in arr)
                        if (o != null) cfg.AllowedOrigins.Add(o.ToString().Trim().TrimEnd('/'));
            }
            return cfg.Normalize();
        }

        /// <summary>محدود کردن مقادیر به بازهٔ امن؛ مقدار نامعتبر با پیش‌فرض جایگزین می‌شود</summary>
        public Config Normalize()
        {
            var d = new Config();
            ConnectionMode = (ConnectionMode ?? "").Trim().ToLowerInvariant() == "com" ? "com" : "lan";
            Protocol = OneOf(Protocol, d.Protocol, "native", "sdk");
            ResponseMode = OneOf(ResponseMode, d.ResponseMode, "auto", "same", "callback");
            NetworkInterface = OneOf(NetworkInterface, d.NetworkInterface, "lan", "wifi");
            DeviceIp = (DeviceIp ?? "").Trim();
            if (!IsValidIp(DeviceIp))
            {
                if (DeviceIp.Length > 0) PosLog.Error("config", "IP کارت‌خوان نامعتبر است: " + DeviceIp);
                DeviceIp = d.DeviceIp;
            }
            DevicePort = InRange(DevicePort, 1, 65535) ? DevicePort : d.DevicePort;
            CallbackPort = CallbackPort == 0 || InRange(CallbackPort, 1, 65535) ? CallbackPort : 0;
            TimeoutSeconds = Clamp(TimeoutSeconds, 30, 600);
            ConnectTimeoutSeconds = Clamp(ConnectTimeoutSeconds, 2, 60);
            CancelGraceSeconds = Clamp(CancelGraceSeconds, 0, 120);
            LateResponseSeconds = Clamp(LateResponseSeconds, 0, 900);
            InvoiceMaxDigits = Clamp(InvoiceMaxDigits, 4, 20);
            if (MaxAmountRial < 10000) MaxAmountRial = d.MaxAmountRial;
            if (string.IsNullOrWhiteSpace(JournalPath)) JournalPath = d.JournalPath;
            PcposAppId = (PcposAppId ?? "").Trim();
            if (!PcPosProtocol.IsSafeField(PcposAppId)) PcposAppId = "";
            MerchantId = (MerchantId ?? "").Trim();
            TerminalId = (TerminalId ?? "").Trim();
            AccessToken = (AccessToken ?? "").Trim();

            // سرویس فقط باید روی همین رایانه در دسترس باشد
            ListenUrl = (ListenUrl ?? "").Trim();
            if (!ListenUrl.EndsWith("/")) ListenUrl += "/";
            Uri uri;
            if (!Uri.TryCreate(ListenUrl, UriKind.Absolute, out uri) || uri.Scheme != "http" ||
                (uri.Host != "127.0.0.1" && uri.Host != "localhost"))
            {
                PosLog.Error("config", "listenUrl باید روی 127.0.0.1 باشد؛ " + ListenUrl + " نادیده گرفته شد");
                ListenUrl = d.ListenUrl;
            }
            return this;
        }

        public static bool IsValidIp(string ip)
        {
            IPAddress a;
            return !string.IsNullOrEmpty(ip) && ip.Split('.').Length == 4 && IPAddress.TryParse(ip, out a);
        }

        private static bool InRange(int v, int min, int max)
        {
            return v >= min && v <= max;
        }

        private static int Clamp(int v, int min, int max)
        {
            return v < min ? min : (v > max ? max : v);
        }

        private static string OneOf(string value, string fallback, params string[] allowed)
        {
            var v = (value ?? "").Trim().ToLowerInvariant();
            return Array.IndexOf(allowed, v) >= 0 ? v : fallback;
        }

        public LanOptions ToLanOptions()
        {
            return new LanOptions
            {
                DeviceIp = DeviceIp,
                DevicePort = DevicePort,
                CallbackPort = CallbackPort,
                ResponseMode = ResponseMode,
                ConnectTimeoutMs = ConnectTimeoutSeconds * 1000,
                ResponseTimeoutSeconds = TimeoutSeconds,
                CancelGraceSeconds = CancelGraceSeconds,
                LateResponseSeconds = LateResponseSeconds,
                AppId = PcposAppId,
                ExpectedTerminalId = TerminalId,
                RequireRrn = RequireRrn
            };
        }

        /// <summary>ذخیرهٔ تنظیمات (وقتی از پنل مدیریت تغییر می‌کند) — با فایل موقت تا با قطع برق خراب نشود</summary>
        public void Save(string path)
        {
            var data = new List<KeyValuePair<string, object>>
            {
                Kv("listenUrl", ListenUrl),
                Kv("connectionMode", ConnectionMode),
                Kv("protocol", Protocol),
                Kv("responseMode", ResponseMode),
                Kv("deviceIp", DeviceIp),
                Kv("networkInterface", NetworkInterface),
                Kv("devicePort", DevicePort),
                Kv("callbackPort", CallbackPort),
                Kv("merchantId", MerchantId),
                Kv("terminalId", TerminalId),
                Kv("serialNumber", SerialNumber),
                Kv("model", Model),
                Kv("firmware", Firmware),
                Kv("devicePassword", DevicePassword),
                Kv("cashierPinHash", CashierPinHash),
                Kv("accessToken", AccessToken),
                Kv("signCode", SignCode),
                Kv("pcposAppId", PcposAppId),
                Kv("invoiceMaxDigits", InvoiceMaxDigits),
                Kv("comPort", ComPort),
                Kv("baudRate", BaudRate),
                Kv("timeoutSeconds", TimeoutSeconds),
                Kv("connectTimeoutSeconds", ConnectTimeoutSeconds),
                Kv("cancelGraceSeconds", CancelGraceSeconds),
                Kv("lateResponseSeconds", LateResponseSeconds),
                Kv("maxAmountRial", MaxAmountRial),
                Kv("requireRrn", RequireRrn),
                Kv("journalPath", JournalPath),
                Kv("printerName", PrinterName),
                Kv("printerFont", PrinterFont),
                Kv("printEnabled", PrintEnabled),
                Kv("allowedOrigins", AllowedOrigins),
                Kv("allowLoopbackOrigins", AllowLoopbackOrigins),
                Kv("simulate", Simulate)
            };

            var json = new JavaScriptSerializer();
            var sb = new StringBuilder("{\n");
            for (var i = 0; i < data.Count; i++)
                sb.Append("  \"").Append(data[i].Key).Append("\": ").Append(json.Serialize(data[i].Value))
                  .Append(i < data.Count - 1 ? ",\n" : "\n");
            sb.Append("}\n");

            var tmp = path + ".tmp";
            File.WriteAllText(tmp, sb.ToString(), new UTF8Encoding(false));
            if (File.Exists(path)) File.Replace(tmp, path, null);
            else File.Move(tmp, path);
        }

        private static KeyValuePair<string, object> Kv(string k, object v)
        {
            return new KeyValuePair<string, object>(k, v);
        }
    }
}
