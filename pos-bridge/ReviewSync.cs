using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Threading;

namespace PosBridge
{
    /// <summary>پاسخ HTTP سرور همگام‌سازی</summary>
    internal sealed class SyncResponse
    {
        public int Status;
        public string Body = "";
    }

    /// <summary>ارسال یک POST؛ هنگام خطای شبکه استثنا پرتاب می‌کند. در تست‌ها جعلی می‌شود.</summary>
    internal interface ISyncTransport
    {
        SyncResponse Post(string url, IDictionary<string, string> headers, string body);
    }

    internal sealed class SyncSettings
    {
        public string SupabaseUrl = "";
        /// <summary>کلید publishable (عمومی)</summary>
        public string SupabaseKey = "";
        public string KioskId = "";
        /// <summary>راز این کیوسک؛ هرگز لاگ یا ذخیره نمی‌شود (جز در appsettings.json)</summary>
        public string KioskSyncKey = "";
        public int IntervalSeconds = 60;
    }

    /// <summary>
    /// ارسال تراکنش‌های نیازمند بررسی به سرور (برای گزارش روزانهٔ مدیر) و دریافت «بررسی شد»هایی که
    /// مدیر از راه دور زده. قرارداد: specs/001-daily-sales-report/contracts/kiosk-sync.md
    ///
    /// ایمنی:
    ///   • هرگز شمارهٔ کارت (حتی ماسک‌شده) نمی‌فرستد؛ بدنه فقط از کلیدهای مجاز ساخته می‌شود.
    ///   • خطای شبکه یا سرور فقط ثبت می‌شود و در دور بعد دوباره تلاش می‌شود؛ هیچ ردیفی گم نمی‌شود،
    ///     چون علامت پیشرفت فقط بعد از پاسخ موفق جلو می‌رود.
    ///   • هیچ قفل پرداختی نمی‌گیرد؛ دفتر فقط برای لحظه‌ای کوتاه قفل می‌شود و شبکه بیرون از قفل است.
    ///   • کلیدها در لاگ، وضعیت و فایل وضعیت نمی‌آیند.
    /// </summary>
    internal sealed class ReviewSync
    {
        public const int MaxRowsPerCall = 500;
        private const string Epoch = "1970-01-01T00:00:00.0000000Z";

        /// <summary>حداکثر ردیف در هر فراخوانی؛ همان سقف سرور (در تست‌ها برای سبک ماندن کوچک می‌شود)</summary>
        internal int BatchSize = MaxRowsPerCall;

        private readonly SyncSettings _s;
        private readonly TransactionJournal _journal;
        private readonly string _stateFile;
        private readonly ISyncTransport _transport;
        private readonly Func<object, string> _serialize;
        private readonly Func<string, object> _deserialize;
        private readonly Func<DateTime> _utcNow;
        private readonly object _runLock = new object();
        private readonly object _stateLock = new object();
        private readonly ManualResetEvent _stop = new ManualResetEvent(false);
        private Thread _thread;

        // حالت پایدار (sync-state.json)
        private string _pushedUntil = "";
        private string _pulledUntil = "";
        private string _lastSyncedAt = "";
        private string _lastAttemptAt = "";
        private string _lastError = "";
        private double _clockOffsetSeconds;
        private int _lastRejected;
        private string _lastLoggedError = "";
        private bool _loggedOk;

        public ReviewSync(SyncSettings settings, TransactionJournal journal, string stateFile, ISyncTransport transport,
            Func<object, string> serialize, Func<string, object> deserialize, Func<DateTime> utcNow = null)
        {
            _s = settings;
            _journal = journal;
            _stateFile = stateFile;
            _transport = transport;
            _serialize = serialize;
            _deserialize = deserialize;
            _utcNow = utcNow ?? (() => DateTime.UtcNow);
            LoadState();
        }

        /* ------------------------------ بدنه ------------------------------ */

        /// <summary>علت نمایش‌داده‌شده به مدیر؛ از جدول ثابت وضعیت، نه از پیام‌های آزاد دستگاه</summary>
        internal static string ReasonFor(PosTransaction t)
        {
            switch (t.Status)
            {
                case "approved_late": return "تأیید پس از لغو یا پایان زمان رسید";
                case "timeout": return "کارت‌خوان در زمان مقرر پاسخ نداد";
                case "uncertain":
                case "sending":
                case "sent": return "نتیجهٔ پرداخت نامطمئن است؛ رسید دستگاه را بررسی کنید";
                case "failed": return "ارسال به کارت‌خوان نیمه‌کاره ماند";
                case "declined": return "کارت‌خوان بعداً تراکنش را رد کرد";
                case "cancelled": return "تراکنش لغو شد";
                default: return "نیازمند بررسی";
            }
        }

        /// <summary>فقط کلیدهای مجاز قرارداد؛ هیچ‌وقت MaskedPan یا Message</summary>
        internal static Dictionary<string, object> BuildRow(PosTransaction t)
        {
            return new Dictionary<string, object>
            {
                { "transaction_id", t.Id },
                { "occurred_at", !string.IsNullOrEmpty(t.CreatedAt) ? t.CreatedAt : t.UpdatedAt },
                { "amount_rial", t.AmountRial },
                { "status", t.Status },
                { "reason", ReasonFor(t) },
                { "invoice_number", NullIfEmpty(t.InvoiceNumber) },
                { "rrn", NullIfEmpty(t.Rrn) },
                { "needs_review", t.NeedsReview },
                { "reviewed", t.Reviewed },
                { "review_note", NullIfEmpty(t.ReviewNote) },
                { "reviewed_at", NullIfEmpty(t.ReviewedAt) }
            };
        }

        private static object NullIfEmpty(string s)
        {
            return string.IsNullOrEmpty(s) ? null : s;
        }

        /* ------------------------------ یک دور ------------------------------ */

        /// <summary>یک دور همگام‌سازی. true یعنی موفق. هیچ‌وقت استثنا پرتاب نمی‌کند.</summary>
        public bool RunOnce()
        {
            lock (_runLock)
            {
                var attemptAt = Iso(_utcNow());
                try
                {
                    string pushedUntil, pulledUntil;
                    lock (_stateLock) { pushedUntil = _pushedUntil; pulledUntil = _pulledUntil; }

                    var changed = _journal.ChangedSince(pushedUntil);
                    var rows = new List<Dictionary<string, object>>();
                    var maxUpdated = pushedUntil;
                    foreach (var t in changed)
                    {
                        if (IsAfter(t.UpdatedAt, maxUpdated)) maxUpdated = t.UpdatedAt;
                        if (t.AmountRial <= 0 || string.IsNullOrEmpty(t.Id))
                        {
                            PosLog.Warn("sync", "تراکنش " + t.Id + " مبلغ یا شناسهٔ معتبر ندارد و فرستاده نشد");
                            continue;
                        }
                        rows.Add(BuildRow(t));
                    }

                    var url = _s.SupabaseUrl.TrimEnd('/') + "/rest/v1/rpc/kiosk_sync_review_transactions";
                    var headers = Headers();
                    var since = string.IsNullOrEmpty(pulledUntil) ? Epoch : pulledUntil;
                    string serverTime = null;
                    double offset = 0;
                    var rejected = 0;
                    var remote = new List<IDictionary<string, object>>();

                    // دست‌کم یک فراخوانی، حتی بدون ردیف، تا سرور کیوسک را زنده بداند و بررسی‌های راه دور را بدهد
                    var size = Math.Max(1, Math.Min(BatchSize, MaxRowsPerCall));
                    var batches = Math.Max(1, (rows.Count + size - 1) / size);
                    for (var b = 0; b < batches; b++)
                    {
                        var take = Math.Min(size, rows.Count - b * size);
                        var batch = take > 0 ? rows.GetRange(b * size, take) : new List<Dictionary<string, object>>();
                        var body = _serialize(new Dictionary<string, object>
                        {
                            { "p_kiosk_id", _s.KioskId },
                            { "p_key", _s.KioskSyncKey },
                            { "p_rows", batch },
                            { "p_since", since },
                            { "p_kiosk_now", Iso(_utcNow()) }
                        });

                        var resp = _transport.Post(url, headers, body);
                        if (resp == null || resp.Status != 200)
                            return Fail(attemptAt, DescribeHttpError(resp));

                        var parsed = AsDict(SafeDeserialize(resp.Body));
                        var st = parsed != null && parsed.ContainsKey("server_time") ? parsed["server_time"] as string : null;
                        if (string.IsNullOrEmpty(st)) return Fail(attemptAt, "پاسخ سرور ناقص بود");
                        serverTime = st;
                        offset = ToDouble(parsed.ContainsKey("clock_offset_seconds") ? parsed["clock_offset_seconds"] : null);
                        rejected += (int)ToDouble(parsed.ContainsKey("rejected") ? parsed["rejected"] : null);
                        foreach (var item in AsList(parsed.ContainsKey("remote_reviews") ? parsed["remote_reviews"] : null))
                        {
                            var d = AsDict(item);
                            if (d != null) remote.Add(d);
                        }
                    }

                    // فقط حالا که همهٔ دسته‌ها موفق بودند، علامت‌ها جلو می‌روند
                    foreach (var d in remote)
                        _journal.ApplyRemoteReview(Str(d, "transaction_id"), Str(d, "review_note"), Str(d, "reviewed_at"), Str(d, "reviewed_by"));

                    lock (_stateLock)
                    {
                        _pushedUntil = maxUpdated;
                        _pulledUntil = serverTime;
                        _lastSyncedAt = Iso(_utcNow());
                        _lastAttemptAt = attemptAt;
                        _lastError = "";
                        _clockOffsetSeconds = offset;
                        _lastRejected = rejected;
                    }
                    SaveState();
                    // سرور ردیف‌های خراب را می‌شمرد و رد می‌کند تا یک ردیف همه را نبندد؛ باید دیده شود
                    if (rejected > 0)
                        PosLog.Warn("sync", "سرور " + rejected.ToString(CultureInfo.InvariantCulture) + " ردیف را نپذیرفت (داده نامعتبر)");
                    if (!_loggedOk || _lastLoggedError.Length > 0)
                    {
                        PosLog.Info("sync", "همگام‌سازی با سرور گزارش برقرار شد");
                        _loggedOk = true;
                        _lastLoggedError = "";
                    }
                    return true;
                }
                catch (Exception ex)
                {
                    return Fail(attemptAt, Redact(ex.Message));
                }
            }
        }

        private bool Fail(string attemptAt, string message)
        {
            message = Redact(message);
            lock (_stateLock)
            {
                _lastAttemptAt = attemptAt;
                _lastError = message;
            }
            SaveState();
            if (message != _lastLoggedError)
            {
                PosLog.Warn("sync", "همگام‌سازی با سرور گزارش ناموفق بود: " + message + " (دوباره تلاش می‌شود)");
                _lastLoggedError = message;
            }
            return false;
        }

        private Dictionary<string, string> Headers()
        {
            var h = new Dictionary<string, string>
            {
                { "apikey", _s.SupabaseKey },
                { "Content-Type", "application/json" }
            };
            // کلیدهای تازهٔ Supabase مبهم‌اند و JWT نیستند؛ نباید Bearer فرستاده شوند
            if (!_s.SupabaseKey.StartsWith("sb_publishable_", StringComparison.Ordinal) &&
                !_s.SupabaseKey.StartsWith("sb_secret_", StringComparison.Ordinal))
                h["Authorization"] = "Bearer " + _s.SupabaseKey;
            return h;
        }

        private string DescribeHttpError(SyncResponse resp)
        {
            if (resp == null) return "پاسخی از سرور نرسید";
            string detail = "";
            var d = AsDict(SafeDeserialize(resp.Body));
            if (d != null && d.ContainsKey("message") && d["message"] is string) detail = (string)d["message"];
            detail = Redact(detail);
            if (detail.Length > 200) detail = detail.Substring(0, 200);
            return "HTTP " + resp.Status.ToString(CultureInfo.InvariantCulture) + (detail.Length > 0 ? ": " + detail : "");
        }

        /// <summary>کلیدها را از هر متنی که ممکن است به لاگ یا وضعیت برود پاک می‌کند</summary>
        private string Redact(string text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            foreach (var secret in new[] { _s.KioskSyncKey, _s.SupabaseKey })
                if (!string.IsNullOrEmpty(secret)) text = text.Replace(secret, "***");
            if (text.Length > 300) text = text.Substring(0, 300);
            return text;
        }

        /* ------------------------------ وضعیت ------------------------------ */

        /// <summary>برای GET /sync/status؛ هیچ کلیدی در آن نیست</summary>
        public Dictionary<string, object> Status()
        {
            string pushedUntil;
            Dictionary<string, object> status;
            lock (_stateLock)
            {
                pushedUntil = _pushedUntil;
                status = new Dictionary<string, object>
                {
                    { "enabled", true },
                    { "kioskId", _s.KioskId },
                    { "lastSyncedAt", _lastSyncedAt },
                    { "lastAttemptAt", _lastAttemptAt },
                    { "lastError", _lastError },
                    { "clockOffsetSeconds", _clockOffsetSeconds },
                    { "lastRejected", _lastRejected }
                };
            }
            var pending = 0;
            foreach (var t in _journal.ChangedSince(pushedUntil))
                if (string.IsNullOrEmpty(pushedUntil) || IsAfter(t.UpdatedAt, pushedUntil)) pending++;
            status["pendingCount"] = pending;
            return status;
        }

        /* ------------------------------ حلقهٔ پس‌زمینه ------------------------------ */

        public void Start()
        {
            if (_thread != null) return;
            _thread = new Thread(Loop) { IsBackground = true, Name = "ReviewSync" };
            _thread.Start();
        }

        public void Stop()
        {
            _stop.Set();
        }

        private void Loop()
        {
            var rnd = new Random();
            // اجازه بده سرویس کامل بالا بیاید و پرداخت‌ها اولویت داشته باشند
            if (_stop.WaitOne(TimeSpan.FromSeconds(5))) return;
            while (true)
            {
                try { RunOnce(); }
                catch (Exception ex) { PosLog.Error("sync", "خطای پیش‌بینی‌نشده در همگام‌سازی: " + Redact(ex.Message)); }
                var wait = Math.Max(30, _s.IntervalSeconds) + rnd.Next(0, 11);
                if (_stop.WaitOne(TimeSpan.FromSeconds(wait))) return;
            }
        }

        /* ------------------------------ فایل وضعیت ------------------------------ */

        private void LoadState()
        {
            try
            {
                if (!File.Exists(_stateFile)) return;
                var d = AsDict(_deserialize(File.ReadAllText(_stateFile)));
                if (d == null) return;
                _pushedUntil = Str(d, "pushedUntil");
                _pulledUntil = Str(d, "pulledUntil");
                _lastSyncedAt = Str(d, "lastSyncedAt");
                _lastAttemptAt = Str(d, "lastAttemptAt");
                _lastError = Redact(Str(d, "lastError"));
                _clockOffsetSeconds = ToDouble(d.ContainsKey("clockOffsetSeconds") ? d["clockOffsetSeconds"] : null);
            }
            catch (Exception ex)
            {
                // فایل خراب: از اول فرستاده می‌شود (ثبت در سرور تکرارپذیر است)
                PosLog.Warn("sync", "فایل وضعیت همگام‌سازی خوانده نشد؛ از اول ارسال می‌شود: " + Redact(ex.Message));
            }
        }

        private void SaveState()
        {
            try
            {
                string json;
                lock (_stateLock)
                {
                    json = _serialize(new Dictionary<string, object>
                    {
                        { "pushedUntil", _pushedUntil }, { "pulledUntil", _pulledUntil },
                        { "lastSyncedAt", _lastSyncedAt }, { "lastAttemptAt", _lastAttemptAt },
                        { "lastError", _lastError }, { "clockOffsetSeconds", _clockOffsetSeconds }
                    });
                }
                var dir = Path.GetDirectoryName(_stateFile);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                var tmp = _stateFile + ".tmp";
                File.WriteAllText(tmp, json, new System.Text.UTF8Encoding(false));
                if (File.Exists(_stateFile)) File.Replace(tmp, _stateFile, null);
                else File.Move(tmp, _stateFile);
            }
            catch (Exception ex)
            {
                PosLog.Warn("sync", "ذخیرهٔ وضعیت همگام‌سازی ناموفق بود: " + Redact(ex.Message));
            }
        }

        /* ------------------------------ کمکی‌ها ------------------------------ */

        private static string Iso(DateTime utc)
        {
            return utc.ToString("o", CultureInfo.InvariantCulture);
        }

        private static bool IsAfter(string a, string b)
        {
            DateTime da, db;
            if (!TryUtc(a, out da)) return false;
            if (!TryUtc(b, out db)) return true;
            return da > db;
        }

        private static bool TryUtc(string iso, out DateTime utc)
        {
            utc = DateTime.MinValue;
            return !string.IsNullOrEmpty(iso) && DateTime.TryParse(iso, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out utc);
        }

        private object SafeDeserialize(string json)
        {
            try { return _deserialize(json); }
            catch { return null; }
        }

        private static IDictionary<string, object> AsDict(object o)
        {
            return o as IDictionary<string, object>;
        }

        private static IEnumerable<object> AsList(object o)
        {
            var list = new List<object>();
            var e = o as IEnumerable;
            if (e == null || o is string) return list;
            foreach (var item in e) list.Add(item);
            return list;
        }

        private static string Str(IDictionary<string, object> d, string key)
        {
            object v;
            return d.TryGetValue(key, out v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : "";
        }

        private static double ToDouble(object v)
        {
            try { return v == null ? 0 : Convert.ToDouble(v, CultureInfo.InvariantCulture); }
            catch { return 0; }
        }
    }
}
