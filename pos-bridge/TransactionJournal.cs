using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace PosBridge
{
    /// <summary>
    /// یک تراکنش کارت‌خوان. وضعیت‌ها:
    ///   pending       ساخته شده، هنوز چیزی به دستگاه نرفته (قطعاً کسر وجه نشده)
    ///   sending/sent  درخواست در حال ارسال/ارسال شده و منتظر پاسخ دستگاه
    ///   approved      دستگاه تأیید کرد و همهٔ کنترل‌ها گذشت
    ///   approved_late تأیید بعد از اینکه کیوسک انتظار را تمام کرده بود رسید (نیاز به بررسی)
    ///   declined      دستگاه رد کرد (کسر وجه نشده)
    ///   cancelled     در کیوسک لغو شد و دستگاه پاسخی نداد
    ///   timeout       پاسخی نرسید (ممکن است کسر وجه شده باشد — نیاز به بررسی)
    ///   failed        پیش از ارسال شکست خورد (قطعاً کسر وجه نشده)
    ///   uncertain     پاسخ رسید ولی قابل اعتماد نبود (نیاز به بررسی)
    /// </summary>
    internal sealed class PosTransaction
    {
        public string Id = "";
        public long MessageId;
        public string InvoiceNumber = "";
        public string PosInvoice = "";
        public long AmountRial;
        public string Status = "pending";
        public bool NeedsReview;
        public bool Reviewed;
        public bool CancelRequested;
        public bool LateResponse;
        public string ResponseCode = "";
        public string Message = "";
        public string Rrn = "";
        public string Stan = "";
        public string MaskedPan = "";
        public string TerminalId = "";
        public string MerchantId = "";
        public string DeviceDateTime = "";
        public string Via = "";
        public string Note = "";
        public string CreatedAt = "";
        public string SentAt = "";
        public string CompletedAt = "";

        public bool IsFinal
        {
            get { return Status != "pending" && Status != "sending" && Status != "sent"; }
        }

        public bool IsSuccess
        {
            get { return Status == "approved" || Status == "approved_late"; }
        }

        /// <summary>آیا ممکن است پول کسر شده باشد بدون اینکه کیوسک بلیط داده باشد</summary>
        public bool IsUncertain
        {
            get { return !IsSuccess && (Status == "uncertain" || Status == "timeout" || Status == "sending" || Status == "sent" || NeedsReview); }
        }

        public PosTransaction Clone()
        {
            return (PosTransaction)MemberwiseClone();
        }

        public Dictionary<string, object> ToRecord()
        {
            return new Dictionary<string, object>
            {
                { "id", Id }, { "messageId", MessageId }, { "invoiceNumber", InvoiceNumber },
                { "posInvoice", PosInvoice }, { "amountRial", AmountRial }, { "status", Status },
                { "needsReview", NeedsReview }, { "reviewed", Reviewed }, { "cancelRequested", CancelRequested },
                { "lateResponse", LateResponse }, { "responseCode", ResponseCode }, { "message", Message },
                { "rrn", Rrn }, { "stan", Stan }, { "maskedPan", MaskedPan }, { "terminalId", TerminalId },
                { "merchantId", MerchantId }, { "deviceDateTime", DeviceDateTime }, { "via", Via },
                { "note", Note }, { "createdAt", CreatedAt }, { "sentAt", SentAt }, { "completedAt", CompletedAt }
            };
        }

        public static PosTransaction FromRecord(Dictionary<string, object> r)
        {
            Func<string, string> s = k => r.ContainsKey(k) && r[k] != null ? Convert.ToString(r[k], CultureInfo.InvariantCulture) : "";
            Func<string, bool> b = k => r.ContainsKey(k) && r[k] is bool && (bool)r[k];
            Func<string, long> l = k => r.ContainsKey(k) && r[k] != null ? Convert.ToInt64(r[k], CultureInfo.InvariantCulture) : 0;
            return new PosTransaction
            {
                Id = s("id"), MessageId = l("messageId"), InvoiceNumber = s("invoiceNumber"), PosInvoice = s("posInvoice"),
                AmountRial = l("amountRial"), Status = s("status"), NeedsReview = b("needsReview"), Reviewed = b("reviewed"),
                CancelRequested = b("cancelRequested"), LateResponse = b("lateResponse"), ResponseCode = s("responseCode"),
                Message = s("message"), Rrn = s("rrn"), Stan = s("stan"), MaskedPan = s("maskedPan"),
                TerminalId = s("terminalId"), MerchantId = s("merchantId"), DeviceDateTime = s("deviceDateTime"),
                Via = s("via"), Note = s("note"), CreatedAt = s("createdAt"), SentAt = s("sentAt"), CompletedAt = s("completedAt")
            };
        }

        /// <summary>خروجی HTTP برای کیوسک (بدون هیچ دادهٔ حساس؛ کارت ماسک‌شده است)</summary>
        public Dictionary<string, object> ToResult()
        {
            var r = ToRecord();
            r["transactionId"] = Id;
            r["success"] = IsSuccess;
            r["final"] = IsFinal;
            r["uncertain"] = IsUncertain;
            r["refNumber"] = Rrn;
            r.Remove("id");
            r.Remove("rrn");
            return r;
        }

        public static string Now()
        {
            return DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
        }
    }

    /// <summary>
    /// دفتر ماندگار تراکنش‌ها روی دیسک (هر تغییر یک خط JSON). کاربردها:
    ///   • جلوگیری از پرداخت دوباره با یک شناسه (idempotency)
    ///   • بازیابی نتیجه وقتی مرورگر وسط پرداخت قطع یا رفرش شد
    ///   • تشخیص پاسخ تکراری/جعلی با RRN تکراری
    ///   • نگه‌داشتن تراکنش‌های «نیازمند بررسی» حتی اگر سرویس وسط کار بسته شود
    /// </summary>
    internal sealed class TransactionJournal
    {
        private const int CompactAfterLines = 5000;
        private const int KeepRecords = 2000;

        private readonly string _path;
        private readonly object _lock = new object();
        private readonly Dictionary<string, PosTransaction> _byId = new Dictionary<string, PosTransaction>();
        private readonly List<string> _order = new List<string>();
        private long _lastMessageId;
        private int _lines;

        public TransactionJournal(string path)
        {
            _path = path;
            var dir = Path.GetDirectoryName(_path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            Load();
        }

        public string FilePath { get { return _path; } }

        public PosTransaction Get(string id)
        {
            lock (_lock)
            {
                PosTransaction t;
                return id != null && _byId.TryGetValue(id, out t) ? t.Clone() : null;
            }
        }

        /// <summary>آخرین تراکنش با این MessageId (برای مسیریابی پاسخ دستگاه)</summary>
        public PosTransaction FindByMessageId(long messageId)
        {
            lock (_lock)
            {
                for (var i = _order.Count - 1; i >= 0; i--)
                {
                    var t = _byId[_order[i]];
                    if (t.MessageId == messageId) return t.Clone();
                }
                return null;
            }
        }

        /// <summary>تراکنش موفق دیگری که همین RRN را دارد (نشانهٔ پاسخ تکراری یا جعلی)</summary>
        public PosTransaction FindApprovedByRrn(string rrn, string exceptId)
        {
            if (string.IsNullOrEmpty(rrn)) return null;
            lock (_lock)
            {
                foreach (var t in _byId.Values)
                    if (t.Id != exceptId && t.Rrn == rrn && t.ResponseCode == "0") return t.Clone();
                return null;
            }
        }

        /// <summary>شمارهٔ پیام بعدی؛ یکتا در دفتر و در بازهٔ int تا دستگاه بپذیرد</summary>
        public long NextMessageId()
        {
            lock (_lock)
            {
                _lastMessageId = _lastMessageId >= PcPosProtocol.MaxMessageId ? 1 : _lastMessageId + 1;
                return _lastMessageId;
            }
        }

        public void Save(PosTransaction t)
        {
            lock (_lock)
            {
                var copy = t.Clone();
                if (!_byId.ContainsKey(copy.Id)) _order.Add(copy.Id);
                _byId[copy.Id] = copy;
                if (copy.MessageId > _lastMessageId) _lastMessageId = copy.MessageId;

                try
                {
                    using (var fs = new FileStream(_path, FileMode.Append, FileAccess.Write, FileShare.Read))
                    {
                        var bytes = Encoding.UTF8.GetBytes(FlatJson.Serialize(copy.ToRecord()) + "\n");
                        fs.Write(bytes, 0, bytes.Length);
                        fs.Flush(true);
                    }
                    _lines++;
                }
                catch (Exception ex)
                {
                    PosLog.Error("journal", "نوشتن دفتر تراکنش‌ها ناموفق بود: " + ex.Message);
                }

                if (_lines > CompactAfterLines) Compact();
            }
        }

        public List<PosTransaction> Recent(int limit)
        {
            lock (_lock)
            {
                var list = new List<PosTransaction>();
                for (var i = _order.Count - 1; i >= 0 && list.Count < limit; i--) list.Add(_byId[_order[i]].Clone());
                return list;
            }
        }

        private void Load()
        {
            lock (_lock)
            {
                if (File.Exists(_path))
                {
                    foreach (var line in File.ReadAllLines(_path, Encoding.UTF8))
                    {
                        if (string.IsNullOrWhiteSpace(line)) continue;
                        _lines++;
                        var rec = FlatJson.Parse(line);
                        if (rec == null) continue; // خط ناقص (مثلاً قطع برق وسط نوشتن)
                        var t = PosTransaction.FromRecord(rec);
                        if (string.IsNullOrEmpty(t.Id)) continue;
                        if (!_byId.ContainsKey(t.Id)) _order.Add(t.Id);
                        _byId[t.Id] = t;
                        if (t.MessageId > _lastMessageId) _lastMessageId = t.MessageId;
                    }
                }

                if (_lastMessageId == 0)
                {
                    // دفتر خالی: شروع از عددی وابسته به زمان تا با تراکنش‌های قبلی دستگاه تداخل نکند
                    _lastMessageId = (DateTime.UtcNow.Ticks / TimeSpan.TicksPerSecond) % 900000000;
                }

                // تراکنش‌هایی که هنگام توقف سرویس نیمه‌کاره ماندند
                foreach (var id in _order.ToArray())
                {
                    var t = _byId[id];
                    if (t.Status == "pending")
                    {
                        t.Status = "failed";
                        t.Note = "سرویس پیش از ارسال درخواست به دستگاه متوقف شد";
                        t.CompletedAt = PosTransaction.Now();
                        Save(t);
                    }
                    else if (t.Status == "sending" || t.Status == "sent")
                    {
                        t.Status = "uncertain";
                        t.NeedsReview = true;
                        t.Message = "سرویس هنگام انتظار برای پاسخ کارت‌خوان متوقف شد؛ رسید دستگاه را بررسی کنید";
                        t.CompletedAt = PosTransaction.Now();
                        Save(t);
                        PosLog.Warn("journal", "تراکنش " + t.Id + " نیمه‌کاره بود و برای بررسی علامت خورد");
                    }
                }
            }
        }

        private void Compact()
        {
            try
            {
                var start = Math.Max(0, _order.Count - KeepRecords);
                var keep = _order.GetRange(start, _order.Count - start);
                var sb = new StringBuilder();
                foreach (var id in keep) sb.Append(FlatJson.Serialize(_byId[id].ToRecord())).Append('\n');

                var tmp = _path + ".tmp";
                File.WriteAllText(tmp, sb.ToString(), new UTF8Encoding(false));
                if (File.Exists(_path)) File.Replace(tmp, _path, null);
                else File.Move(tmp, _path);

                foreach (var id in _order.GetRange(0, start)) _byId.Remove(id);
                _order.RemoveRange(0, start);
                _lines = keep.Count;
            }
            catch (Exception ex)
            {
                PosLog.Error("journal", "فشرده‌سازی دفتر ناموفق بود: " + ex.Message);
            }
        }
    }

    /// <summary>قواعد پذیرش پاسخ دستگاه</summary>
    internal static class PaymentRules
    {
        /// <summary>
        /// نتیجهٔ دستگاه را روی تراکنش اعمال می‌کند. کد ۰ فقط وقتی «موفق» حساب می‌شود که
        /// مبلغ، پایانه و RRN با درخواست بخواند و RRN قبلاً استفاده نشده باشد؛ در غیر این صورت
        /// تراکنش «نامطمئن» و نیازمند بررسی می‌شود (بلیط صادر نمی‌شود).
        /// </summary>
        public static void Apply(PosTransaction tx, PosBuyResponse resp, string expectedTerminalId,
            bool requireRrn, TransactionJournal journal)
        {
            tx.ResponseCode = resp.Code.ToString(CultureInfo.InvariantCulture);
            tx.Rrn = resp.Rrn;
            tx.Stan = resp.Stan;
            tx.MaskedPan = PcPosProtocol.MaskPan(resp.CardNumber);
            tx.TerminalId = resp.TerminalId;
            tx.MerchantId = resp.MerchantId;
            tx.DeviceDateTime = resp.DateTime;
            tx.CompletedAt = PosTransaction.Now();

            if (resp.Code != 0)
            {
                tx.Status = "declined";
                tx.Message = PcPosProtocol.ErrorMessage(resp.Code);
                return;
            }

            var problems = new List<string>();
            long amount;
            if (!string.IsNullOrEmpty(resp.Amount) &&
                (!long.TryParse(resp.Amount, NumberStyles.Integer, CultureInfo.InvariantCulture, out amount) || amount != tx.AmountRial))
                problems.Add("مبلغ پاسخ (" + resp.Amount + ") با مبلغ درخواست (" + tx.AmountRial + ") یکی نیست");

            if (requireRrn && string.IsNullOrEmpty(resp.Rrn))
                problems.Add("شمارهٔ مرجع (RRN) در پاسخ نیست");

            if (!string.IsNullOrEmpty(expectedTerminalId) && !string.IsNullOrEmpty(resp.TerminalId) &&
                resp.TerminalId.TrimStart('0') != expectedTerminalId.Trim().TrimStart('0'))
                problems.Add("پاسخ از پایانهٔ دیگری آمده (" + resp.TerminalId + ")");

            if (journal != null && journal.FindApprovedByRrn(resp.Rrn, tx.Id) != null)
                problems.Add("این RRN قبلاً برای تراکنش دیگری ثبت شده (پاسخ تکراری)");

            if (problems.Count > 0)
            {
                tx.Status = "uncertain";
                tx.NeedsReview = true;
                tx.Message = "پاسخ موفق کارت‌خوان قابل تأیید نبود: " + string.Join("؛ ", problems.ToArray());
                return;
            }

            tx.Status = "approved";
            tx.Message = "تراکنش موفق";
        }

        /// <summary>
        /// پاسخی که بعد از نهایی شدن تراکنش در کیوسک رسید (پس از لغو یا پایان زمان).
        /// تأیید دیرهنگام هرگز گم نمی‌شود: «approved_late» و نیازمند بررسی ثبت می‌شود.
        /// false یعنی پاسخ تکراری بود و چیزی تغییر نکرد.
        /// </summary>
        public static bool ApplyLate(PosTransaction tx, PosBuyResponse resp, string expectedTerminalId,
            bool requireRrn, TransactionJournal journal)
        {
            if (tx.IsSuccess || tx.Status == "declined" || !tx.IsFinal) return false;

            tx.LateResponse = true;
            Apply(tx, resp, expectedTerminalId, requireRrn, journal);
            if (tx.Status == "approved")
            {
                tx.Status = "approved_late";
                tx.NeedsReview = true;
                tx.Message = "پرداخت پس از پایان انتظار کیوسک تأیید شد؛ مبلغ از کارت کسر شده — بلیط را دستی صادر یا وجه را برگشت دهید";
                PosLog.Error("pos:late", "تأیید دیرهنگام برای تراکنش " + tx.Id + " — RRN " + tx.Rrn);
            }
            else if (tx.Status == "declined")
            {
                // رد قطعی: نگرانی کسر وجه برطرف می‌شود
                tx.NeedsReview = false;
                PosLog.Info("pos:late", "رد دیرهنگام برای تراکنش " + tx.Id + " ثبت شد");
            }
            if (journal != null) journal.Save(tx);
            return true;
        }
    }
}
