using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

namespace PosBridge
{
    internal class Config
    {
        public string ListenUrl = "http://127.0.0.1:9099/";

        /// <summary>«lan» = اتصال شبکه‌ای با IP، «com» = اتصال USB/سریال</summary>
        public string ConnectionMode = "lan";

        public string DeviceIp = "192.168.16.87";
        /// <summary>رابط فیزیکی شبکهٔ کارت‌خوان: lan (کابل) یا wifi</summary>
        public string NetworkInterface = "lan";
        public int DevicePort = 8888;

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

        /// <summary>توکن دسترسی مسیرهای حساس (/config, /logs, /events) — خالی یعنی بدون محدودیت</summary>
        public string AccessToken = "";

        public string SignCode = "";
        public string ComPort = "COM3";
        public int BaudRate = 115200;
        public int TimeoutSeconds = 120;
        public List<string> AllowedOrigins = new List<string>();
        public bool Simulate;

        /// <summary>پورتی که کتابخانهٔ رسمی (PosInterface) روی آن به دستگاه گوش می‌دهد</summary>
        public int PosListenPort = 17000;
        /// <summary>استفاده از کتابخانهٔ رسمی PosInterface به‌جای پروتکل متنی TCP</summary>
        public bool UseSdk = true;

        /// <summary>نام پرینتر حرارتی ۸۰ میلی‌متری در ویندوز — خالی یعنی پرینتر پیش‌فرض</summary>
        public string PrinterName = "";
        public string PrinterFont = "Tahoma";
        public bool PrintEnabled = true;



        public bool IsLan
        {
            get { return (ConnectionMode ?? "lan").ToLowerInvariant() == "lan"; }
        }

        public static Config Load(string path)
        {
            var cfg = new Config();
            if (!File.Exists(path)) return cfg;

            var raw = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
            if (raw == null) return cfg;

            if (raw.ContainsKey("listenUrl")) cfg.ListenUrl = raw["listenUrl"].ToString();
            if (raw.ContainsKey("connectionMode")) cfg.ConnectionMode = raw["connectionMode"].ToString();
            if (raw.ContainsKey("deviceIp")) cfg.DeviceIp = raw["deviceIp"].ToString();
            if (raw.ContainsKey("networkInterface")) cfg.NetworkInterface = raw["networkInterface"].ToString();
            if (raw.ContainsKey("devicePort")) cfg.DevicePort = int.Parse(raw["devicePort"].ToString());
            if (raw.ContainsKey("merchantId")) cfg.MerchantId = raw["merchantId"].ToString();
            if (raw.ContainsKey("terminalId")) cfg.TerminalId = raw["terminalId"].ToString();
            if (raw.ContainsKey("serialNumber")) cfg.SerialNumber = raw["serialNumber"].ToString();
            if (raw.ContainsKey("model")) cfg.Model = raw["model"].ToString();
            if (raw.ContainsKey("firmware")) cfg.Firmware = raw["firmware"].ToString();
            if (raw.ContainsKey("devicePassword")) cfg.DevicePassword = raw["devicePassword"].ToString();
            if (raw.ContainsKey("accessToken")) cfg.AccessToken = raw["accessToken"].ToString();
            if (raw.ContainsKey("signCode")) cfg.SignCode = raw["signCode"].ToString();
            if (raw.ContainsKey("comPort")) cfg.ComPort = raw["comPort"].ToString();
            if (raw.ContainsKey("baudRate")) cfg.BaudRate = int.Parse(raw["baudRate"].ToString());
            if (raw.ContainsKey("posListenPort")) cfg.PosListenPort = int.Parse(raw["posListenPort"].ToString());
            if (raw.ContainsKey("useSdk")) cfg.UseSdk = bool.Parse(raw["useSdk"].ToString());
            if (raw.ContainsKey("printerName")) cfg.PrinterName = raw["printerName"].ToString();
            if (raw.ContainsKey("printerFont")) cfg.PrinterFont = raw["printerFont"].ToString();
            if (raw.ContainsKey("printEnabled")) cfg.PrintEnabled = bool.Parse(raw["printEnabled"].ToString());

            if (raw.ContainsKey("timeoutSeconds")) cfg.TimeoutSeconds = int.Parse(raw["timeoutSeconds"].ToString());
            if (raw.ContainsKey("simulate")) cfg.Simulate = bool.Parse(raw["simulate"].ToString());
            if (raw.ContainsKey("allowedOrigins"))
            {
                var arr = raw["allowedOrigins"] as System.Collections.ArrayList;
                if (arr != null)
                    foreach (var o in arr) cfg.AllowedOrigins.Add(o.ToString());
            }
            if (!cfg.ListenUrl.EndsWith("/")) cfg.ListenUrl += "/";
            return cfg;
        }

        /// <summary>ذخیرهٔ تنظیمات (وقتی از پنل مدیریت تغییر می‌کند)</summary>
        public void Save(string path)
        {
            var data = new Dictionary<string, object>
            {
                { "listenUrl", ListenUrl },
                { "connectionMode", ConnectionMode },
                { "deviceIp", DeviceIp },
                { "networkInterface", NetworkInterface },
                { "devicePort", DevicePort },
                { "merchantId", MerchantId },
                { "terminalId", TerminalId },
                { "serialNumber", SerialNumber },
                { "model", Model },
                { "firmware", Firmware },
                { "devicePassword", DevicePassword },
                { "accessToken", AccessToken },
                { "signCode", SignCode },
                { "comPort", ComPort },
                { "baudRate", BaudRate },
                { "posListenPort", PosListenPort },
                { "useSdk", UseSdk },
                { "printerName", PrinterName },
                { "printerFont", PrinterFont },
                { "printEnabled", PrintEnabled },
                { "timeoutSeconds", TimeoutSeconds },
                { "allowedOrigins", AllowedOrigins },
                { "simulate", Simulate }
            };
            File.WriteAllText(path, new JavaScriptSerializer().Serialize(data));
        }
    }
}
