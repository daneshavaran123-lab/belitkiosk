using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;

namespace PosBridge
{
    /// <summary>ارسال واقعی POST به سرور همگام‌سازی (HTTPS، مهلت ۱۵ ثانیه، بدون دنبال کردن ریدایرکت)</summary>
    internal sealed class HttpSyncTransport : ISyncTransport
    {
        private const int TimeoutMs = 15000;

        static HttpSyncTransport()
        {
            // ویندوز ۱۰ با .NET Framework 4.8 به‌صورت پیش‌فرض TLS 1.2 را برای همهٔ برنامه‌ها روشن نمی‌کند
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        }

        public SyncResponse Post(string url, IDictionary<string, string> headers, string body)
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = "POST";
            req.Timeout = TimeoutMs;
            req.ReadWriteTimeout = TimeoutMs;
            req.UserAgent = "MuseumKiosk-PosBridge";
            // ریدایرکت نباید کلیدها را به آدرس دیگری ببرد
            req.AllowAutoRedirect = false;
            req.ContentType = "application/json";
            foreach (var kv in headers)
            {
                if (kv.Key == "Content-Type") continue;
                req.Headers[kv.Key] = kv.Value;
            }

            var bytes = Encoding.UTF8.GetBytes(body);
            req.ContentLength = bytes.Length;
            using (var stream = req.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);

            try
            {
                using (var resp = (HttpWebResponse)req.GetResponse()) return Read(resp);
            }
            catch (WebException ex) when (ex.Response != null)
            {
                // کد ۴xx و ۵xx هم پاسخ است؛ ReviewSync آن را به خطای قابل فهم تبدیل می‌کند
                using (var resp = (HttpWebResponse)ex.Response) return Read(resp);
            }
        }

        private static SyncResponse Read(HttpWebResponse resp)
        {
            using (var reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                return new SyncResponse { Status = (int)resp.StatusCode, Body = reader.ReadToEnd() };
        }
    }
}
