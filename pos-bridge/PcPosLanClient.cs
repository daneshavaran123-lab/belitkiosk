using System;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Threading;

namespace PosBridge
{
    /// <summary>تنظیمات اتصال شبکه‌ای PC-POS</summary>
    internal sealed class LanOptions
    {
        public string DeviceIp = "";
        public int DevicePort = 17000;
        /// <summary>پورتی که دستگاه برای برگرداندن پاسخ به آن وصل می‌شود؛ ۰ یعنی همان DevicePort (مثل کتابخانهٔ رسمی)</summary>
        public int CallbackPort;
        /// <summary>
        /// auto     = هم روی همان اتصال گوش می‌دهیم و هم منتظر اتصال برگشتی دستگاه هستیم (پیش‌فرض)
        /// same     = پاسخ روی همان اتصال TCP می‌آید (ResponseConnectionMode=true در کتابخانهٔ رسمی)
        /// callback = دستگاه بعد از تراکنش خودش به کیوسک وصل می‌شود (پیش‌فرض کتابخانهٔ رسمی)
        /// </summary>
        public string ResponseMode = "auto";
        public int ConnectTimeoutMs = 10000;
        public int ConnectAttempts = 3;
        public int ResponseTimeoutSeconds = 120;
        public int CancelGraceSeconds = 20;
        public int LateResponseSeconds = 180;
        public string AppId = "";
        public string ExpectedTerminalId = "";
        public bool RequireRrn = true;
    }

    /// <summary>
    /// پیاده‌سازی مستقیم پروتکل PC-POS روی شبکه، بدون وابستگی به DLL مبهم‌سازی‌شده.
    ///
    /// اصول ایمنی پرداخت:
    ///   • هر بار فقط یک تراکنش فعال است.
    ///   • تلاش دوباره فقط برای «اتصال» و پیش از ارسال است؛ بعد از ارسال حتی یک بایت، درخواست
    ///     هرگز دوباره فرستاده نمی‌شود (جلوگیری از کسر دوبارهٔ وجه).
    ///   • پاسخ فقط وقتی پذیرفته می‌شود که چک‌سام، MessageId، مبلغ، پایانه و RRN بخوانند.
    ///   • اتصال برگشتی فقط از IP خود کارت‌خوان پذیرفته می‌شود.
    ///   • پاسخ دیرهنگام (بعد از پایان انتظار یا لغو) گم نمی‌شود و در دفتر برای بررسی ثبت می‌شود.
    /// </summary>
    internal sealed class PcPosLanClient : IDisposable
    {
        private readonly LanOptions _o;
        private readonly TransactionJournal _journal;
        private readonly object _gate = new object();
        private Waiter _active;
        private int _generation;
        private TcpListener _listener;
        private volatile bool _disposed;

        private sealed class Waiter
        {
            public PosTransaction Tx;
            public readonly ManualResetEvent Signal = new ManualResetEvent(false);
            public volatile PosBuyResponse Response;
            public string InvalidFrame;
            public volatile bool Cancel;
            public int Generation;
        }

        public PcPosLanClient(LanOptions options, TransactionJournal journal)
        {
            _o = options;
            _journal = journal;
            if (UsesCallback) StartListener();
        }

        public bool UsesCallback
        {
            get { return (_o.ResponseMode ?? "auto") != "same"; }
        }

        public int CallbackPort
        {
            get { return _o.CallbackPort > 0 ? _o.CallbackPort : _o.DevicePort; }
        }

        public bool ListenerReady
        {
            get { lock (_gate) return _listener != null; }
        }

        public string ListenerError { get; private set; }

        public bool Busy
        {
            get { lock (_gate) return _active != null; }
        }

        /// <summary>شنود دائمی برای پاسخ‌هایی که دستگاه با اتصال برگشتی می‌فرستد</summary>
        public bool StartListener()
        {
            lock (_gate)
            {
                if (_listener != null) return true;
                if (_disposed) return false;
                try
                {
                    var l = new TcpListener(IPAddress.Any, CallbackPort);
                    l.Start();
                    _listener = l;
                    ListenerError = null;
                    new Thread(AcceptLoop) { IsBackground = true, Name = "pcpos-callback" }.Start(l);
                    PosLog.Info("pcpos:listen", "آمادهٔ دریافت پاسخ کارت‌خوان روی پورت " + CallbackPort +
                        " (فقط از " + _o.DeviceIp + ")");
                    return true;
                }
                catch (Exception ex)
                {
                    ListenerError = ex.Message;
                    PosLog.Error("pcpos:listen", "پورت " + CallbackPort + " برای دریافت پاسخ باز نشد: " + ex.Message +
                        " — احتمالاً برنامهٔ دیگری (مثل PosAgent یا نسخهٔ دیگری از همین سرویس) آن را گرفته است");
                    return false;
                }
            }
        }

        public bool Cancel(string transactionId)
        {
            lock (_gate)
            {
                if (_active == null) return false;
                if (!string.IsNullOrEmpty(transactionId) && transactionId != _active.Tx.Id) return false;
                _active.Cancel = true;
                return true;
            }
        }

        public void Dispose()
        {
            _disposed = true;
            lock (_gate)
            {
                try { if (_listener != null) _listener.Stop(); }
                catch { /* ignore */ }
                _listener = null;
            }
        }

        /// <summary>
        /// اجرای کامل یک خرید و انتظار برای نتیجهٔ نهایی. تراکنش در همهٔ مراحل در دفتر ثبت می‌شود.
        /// </summary>
        public PosTransaction Pay(PosTransaction tx)
        {
            var w = new Waiter { Tx = tx };
            lock (_gate)
            {
                if (_active != null) return Fail(tx, "تراکنش دیگری روی کارت‌خوان در جریان است");
                _active = w;
                w.Generation = ++_generation;
            }
            try
            {
                return Run(w);
            }
            finally
            {
                lock (_gate)
                    if (_active == w) _active = null;
            }
        }

        private PosTransaction Run(Waiter w)
        {
            var tx = w.Tx;
            tx.Via = "pcpos-lan";

            if (UsesCallback && !StartListener())
                return Fail(tx, "پورت " + CallbackPort + " برای دریافت پاسخ کارت‌خوان آزاد نیست (" + ListenerError +
                    "). برنامه‌های دیگر کارت‌خوان را ببندید یا responseMode را same بگذارید.");

            byte[] frame;
            try
            {
                frame = PcPosProtocol.Frame(PcPosProtocol.BuildPurchaseBody(
                    tx.AmountRial, tx.PosInvoice, DateTime.Now, tx.MessageId, _o.AppId));
            }
            catch (ArgumentException ex)
            {
                return Fail(tx, "درخواست پرداخت نامعتبر است: " + ex.Message);
            }

            string connectError;
            var client = Connect(w, out connectError);
            if (client == null)
                return Fail(tx, w.Cancel
                    ? "تراکنش پیش از ارسال به کارت‌خوان لغو شد"
                    : "اتصال به کارت‌خوان " + _o.DeviceIp + ":" + _o.DevicePort + " برقرار نشد (" + connectError + ")");

            // از اینجا به بعد ممکن است وجه کسر شود؛ هیچ ارسال دوباره‌ای انجام نمی‌شود
            var sendError = (string)null;
            try
            {
                tx.Status = "sending";
                _journal.Save(tx);
                var stream = client.GetStream();
                stream.WriteTimeout = 20000;
                stream.Write(frame, 0, frame.Length);
                stream.Flush();
                tx.Status = "sent";
                tx.SentAt = PosTransaction.Now();
                _journal.Save(tx);
                PosLog.Info("pcpos:tx", "درخواست خرید ارسال شد — MessageId " + tx.MessageId + "، مبلغ " + tx.AmountRial +
                    " ریال، فاکتور " + tx.PosInvoice);
            }
            catch (Exception ex)
            {
                sendError = ex.Message;
                PosLog.Error("pcpos:tx", "ارسال درخواست نیمه‌کاره ماند: " + ex.Message);
            }

            var deadline = DateTime.UtcNow.AddSeconds(_o.ResponseTimeoutSeconds);
            if (sendError == null && _o.ResponseMode != "callback")
            {
                // پاسخ روی همین اتصال؛ تا پایان پنجرهٔ پاسخ دیرهنگام هم گوش می‌دهیم
                // ولی اگر پاسخ از اتصال برگشتی رسید یا تراکنش تازه‌ای شروع شد، اتصال را آزاد می‌کنیم
                var until = deadline.AddSeconds(_o.CancelGraceSeconds + _o.LateResponseSeconds);
                Func<bool> release = () => w.Response != null || w.Generation != Volatile.Read(ref _generation);
                new Thread(() => ReadConnection(client, "same", until, release)) { IsBackground = true, Name = "pcpos-same" }.Start();
            }
            else
            {
                // مثل کتابخانهٔ رسمی: اتصال درخواست بسته و منتظر اتصال برگشتی دستگاه می‌مانیم
                try { client.Close(); }
                catch { /* ignore */ }
            }

            if (sendError != null && !UsesCallback)
            {
                tx.Status = "uncertain";
                tx.NeedsReview = true;
                tx.Message = "ارسال درخواست به کارت‌خوان نیمه‌کاره ماند (" + sendError + ")؛ رسید دستگاه را بررسی کنید";
                tx.CompletedAt = PosTransaction.Now();
                _journal.Save(tx);
                return tx;
            }

            DateTime? cancelDeadline = null;
            while (!_disposed)
            {
                if (w.Signal.WaitOne(250)) break;
                if (w.Cancel && cancelDeadline == null)
                {
                    // کارت‌خوان فرمان لغو ندارد؛ فرصت می‌دهیم اگر مشتری کارت کشیده، نتیجه برسد
                    cancelDeadline = DateTime.UtcNow.AddSeconds(_o.CancelGraceSeconds);
                    tx.CancelRequested = true;
                    _journal.Save(tx);
                    PosLog.Warn("pcpos:cancel", "لغو در کیوسک؛ تا " + _o.CancelGraceSeconds + " ثانیه منتظر پاسخ نهایی دستگاه می‌مانیم");
                }
                if (DateTime.UtcNow > deadline) break;
                if (cancelDeadline.HasValue && DateTime.UtcNow > cancelDeadline.Value) break;
            }

            // نهایی‌سازی زیر همان قفلی که Deliver استفاده می‌کند تا پاسخی که همین لحظه می‌رسد
            // یا به این تراکنش برسد یا (بعد از ثبت نهایی) به‌عنوان پاسخ دیرهنگام ثبت شود — هرگز گم نشود
            lock (_gate)
            {
                Complete(w, sendError);
                if (_active == w) _active = null;
            }
            PosLog.Info("pcpos:result", tx.Status + " — " + tx.Message + (string.IsNullOrEmpty(tx.Rrn) ? "" : " — RRN " + tx.Rrn));
            return tx;
        }

        private void Complete(Waiter w, string sendError)
        {
            var tx = w.Tx;
            var resp = w.Response;
            var invalid = w.InvalidFrame;

            if (resp != null)
            {
                PaymentRules.Apply(tx, resp, _o.ExpectedTerminalId, _o.RequireRrn, _journal);
                if (tx.CancelRequested && tx.IsSuccess)
                    tx.Note = "مشتری پیش از رسیدن لغو، پرداخت را روی دستگاه انجام داده بود؛ فروش ثبت شد";
            }
            else if (invalid != null)
            {
                tx.Status = "uncertain";
                tx.NeedsReview = true;
                tx.Message = "پاسخ نامعتبر از کارت‌خوان رسید (" + invalid + ")؛ رسید دستگاه را بررسی کنید";
            }
            else if (tx.CancelRequested)
            {
                tx.Status = "cancelled";
                tx.Message = "تراکنش لغو شد";
                tx.Note = "کارت‌خوان پاسخی نداد؛ اگر پاسخ دیرهنگام برسد خودکار ثبت می‌شود";
            }
            else
            {
                tx.Status = "timeout";
                tx.NeedsReview = true;
                tx.Message = "پاسخی از کارت‌خوان در " + _o.ResponseTimeoutSeconds + " ثانیه نرسید" +
                    (UsesCallback
                        ? "؛ اگر دستگاه رسید چاپ کرده، احتمالاً فایروال ویندوز پورت " + CallbackPort + " را بسته است"
                        : "");
            }

            if (sendError != null && resp == null) tx.Note = "خطای ارسال: " + sendError;
            tx.CompletedAt = PosTransaction.Now();
            _journal.Save(tx);
        }

        private TcpClient Connect(Waiter w, out string error)
        {
            error = "";
            var attempts = Math.Max(1, _o.ConnectAttempts);
            for (var attempt = 1; attempt <= attempts; attempt++)
            {
                var c = new TcpClient();
                try
                {
                    var ar = c.BeginConnect(_o.DeviceIp, _o.DevicePort, null, null);
                    if (ar.AsyncWaitHandle.WaitOne(_o.ConnectTimeoutMs))
                    {
                        c.EndConnect(ar);
                        if (c.Connected)
                        {
                            c.NoDelay = true;
                            return c;
                        }
                    }
                    error = "پایان زمان اتصال";
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                }
                try { c.Close(); }
                catch { /* ignore */ }

                PosLog.Warn("pcpos:connect", "تلاش " + attempt + " از " + attempts + " برای اتصال ناموفق بود: " + error);
                if (w.Cancel || attempt == attempts) break;
                Thread.Sleep(1000 * attempt);
            }
            return null;
        }

        private void AcceptLoop(object state)
        {
            var listener = (TcpListener)state;
            while (!_disposed)
            {
                TcpClient c;
                try
                {
                    c = listener.AcceptTcpClient();
                }
                catch
                {
                    if (_disposed) return;
                    lock (_gate) if (_listener != listener) return;
                    Thread.Sleep(200);
                    continue;
                }

                var remote = ((IPEndPoint)c.Client.RemoteEndPoint).Address;
                if (!IsDeviceAddress(remote))
                {
                    PosLog.Warn("pcpos:listen", "اتصال از " + remote + " رد شد؛ فقط کارت‌خوان " + _o.DeviceIp + " مجاز است");
                    try { c.Close(); }
                    catch { /* ignore */ }
                    continue;
                }

                var client = c;
                new Thread(() => ReadConnection(client, "callback", DateTime.UtcNow.AddSeconds(30), null))
                {
                    IsBackground = true,
                    Name = "pcpos-callback-read"
                }.Start();
            }
        }

        private bool IsDeviceAddress(IPAddress remote)
        {
            IPAddress expected;
            if (!IPAddress.TryParse(_o.DeviceIp, out expected)) return false;
            if (remote.IsIPv4MappedToIPv6) remote = remote.MapToIPv4();
            return remote.Equals(expected);
        }

        /// <summary>خواندن یک فریم کامل از اتصال؛ بعد از اولین پاسخ معتبر اتصال بسته می‌شود</summary>
        private void ReadConnection(TcpClient c, string source, DateTime untilUtc, Func<bool> release)
        {
            var reader = new FrameReader();
            var buf = new byte[512];
            try
            {
                using (c)
                {
                    var s = c.GetStream();
                    while (!_disposed && DateTime.UtcNow < untilUtc && (release == null || !release()))
                    {
                        if (!c.Client.Poll(500000, SelectMode.SelectRead)) continue;
                        var n = s.Read(buf, 0, buf.Length);
                        string frame;
                        if (n <= 0)
                        {
                            if (reader.TryTakeUnterminated(out frame)) Deliver(frame, source);
                            return;
                        }
                        reader.Append(buf, n);
                        while (reader.TryTake(out frame))
                            if (Deliver(frame, source)) return;
                        if (reader.Overflow)
                        {
                            MarkInvalid("دادهٔ بیش از حد بدون پایان فریم");
                            return;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                if (!_disposed) PosLog.Warn("pcpos:read", source + ": " + ex.Message);
            }
        }

        private void MarkInvalid(string reason)
        {
            lock (_gate)
                if (_active != null && _active.Response == null) _active.InvalidFrame = reason;
            PosLog.Error("pcpos:rx", reason);
        }

        /// <summary>مسیریابی پاسخ دستگاه به تراکنش مربوط؛ true یعنی پاسخ معتبر POSBUY بود</summary>
        private bool Deliver(string frame, string source)
        {
            var resp = PcPosProtocol.Parse(frame);
            if (!resp.IsValid)
            {
                MarkInvalid("فریم نامعتبر از " + source + ": " + resp.FormatError);
                return false;
            }
            if (resp.Type != "POSBUY")
            {
                PosLog.Warn("pcpos:rx", "پاسخ از نوع " + resp.Type + " نادیده گرفته شد");
                return false;
            }

            // در لاگ هرگز شمارهٔ کامل کارت نوشته نمی‌شود
            PosLog.Info("pcpos:rx", source + ": کد " + resp.Code + "، MessageId " + resp.MessageId + "، RRN " + resp.Rrn +
                "، کارت " + PcPosProtocol.MaskPan(resp.CardNumber));

            long mid;
            var hasMid = long.TryParse(resp.MessageId, NumberStyles.Integer, CultureInfo.InvariantCulture, out mid);
            lock (_gate)
            {
                if (_active != null && _active.Response == null && !_active.Tx.IsFinal &&
                    (!hasMid || mid == _active.Tx.MessageId))
                {
                    _active.Response = resp;
                    _active.Signal.Set();
                    return true;
                }
            }

            var old = hasMid ? _journal.FindByMessageId(mid) : null;
            if (old == null) RecordOrphan(resp);
            else HandleLate(old, resp);
            return true;
        }

        /// <summary>پاسخی که بعد از پایان انتظار کیوسک رسید</summary>
        private void HandleLate(PosTransaction tx, PosBuyResponse resp)
        {
            if (!PaymentRules.ApplyLate(tx, resp, _o.ExpectedTerminalId, _o.RequireRrn, _journal))
                PosLog.Warn("pcpos:late", "پاسخ تکراری برای MessageId " + tx.MessageId + " نادیده گرفته شد");
        }

        /// <summary>پاسخ برای درخواستی که در دفتر نیست (مثلاً از برنامهٔ دیگری روی همین کیوسک)</summary>
        private void RecordOrphan(PosBuyResponse resp)
        {
            long amount;
            long.TryParse(resp.Amount, NumberStyles.Integer, CultureInfo.InvariantCulture, out amount);
            var tx = new PosTransaction
            {
                Id = "orphan-" + Guid.NewGuid().ToString("N"),
                AmountRial = amount,
                Via = "pcpos-lan",
                CreatedAt = PosTransaction.Now(),
                LateResponse = true
            };
            PaymentRules.Apply(tx, resp, _o.ExpectedTerminalId, _o.RequireRrn, _journal);
            if (resp.Code == 0)
            {
                tx.Status = "uncertain";
                tx.NeedsReview = true;
                tx.Message = "پاسخ موفق برای درخواستی ناشناخته (MessageId " + resp.MessageId + ") رسید";
            }
            _journal.Save(tx);
            PosLog.Warn("pcpos:orphan", tx.Message);
        }

        private PosTransaction Fail(PosTransaction tx, string message)
        {
            tx.Status = "failed";
            tx.Message = message;
            tx.CompletedAt = PosTransaction.Now();
            _journal.Save(tx);
            PosLog.Error("pcpos:fail", message);
            return tx;
        }
    }
}
