using System;
using System.Collections.Generic;

namespace PosBridge
{
    /// <summary>
    /// لاگ درون‌حافظه‌ای سرویس پل: ۲۰۰ رویداد آخر نگه داشته می‌شود و
    /// مسیر /events آن را به‌صورت SSE برای صفحهٔ «تنظیمات کارت‌خوان» می‌فرستد.
    /// </summary>
    internal static class PosLog
    {
        private const int Capacity = 200;
        private static readonly object Lock = new object();
        private static readonly List<Dictionary<string, object>> Items = new List<Dictionary<string, object>>();
        private static long _seq;

        public static void Info(string ev, string message) { Add("info", ev, message); }
        public static void Warn(string ev, string message) { Add("warn", ev, message); }
        public static void Error(string ev, string message) { Add("error", ev, message); }

        private static void Add(string level, string ev, string message)
        {
            var item = new Dictionary<string, object>
            {
                { "level", level },
                { "event", ev },
                { "message", message ?? "" },
                { "time", DateTime.Now.ToString("HH:mm:ss") }
            };
            lock (Lock)
            {
                item["id"] = ++_seq;
                Items.Add(item);
                if (Items.Count > Capacity) Items.RemoveRange(0, Items.Count - Capacity);
            }
            Console.WriteLine("[" + level + "] " + ev + " — " + message);
        }

        /// <summary>رویدادهای بعد از شناسهٔ داده‌شده</summary>
        public static List<Dictionary<string, object>> Since(long afterId)
        {
            lock (Lock)
            {
                var res = new List<Dictionary<string, object>>();
                foreach (var i in Items)
                    if (Convert.ToInt64(i["id"]) > afterId) res.Add(i);
                return res;
            }
        }

        public static long LastId
        {
            get { lock (Lock) { return _seq; } }
        }

        public static void Clear()
        {
            lock (Lock) Items.Clear();
        }
    }
}
