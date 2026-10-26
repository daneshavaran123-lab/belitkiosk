using System;
using System.Text;
using System.Threading;
using PosInterface;

namespace PosBridge
{
    /// <summary>
    /// مسیر جایگزین: پرداخت با کتابخانهٔ رسمی PosInterface.dll (protocol = "sdk").
    /// مسیر پیش‌فرض پیاده‌سازی مستقیم همین پروتکل در PcPosLanClient است؛ این مسیر برای وقتی
    /// نگه داشته شده که بخواهید دقیقاً با کد سازنده کار کنید (یا اتصال USB/سریال دارید).
    ///
    /// نکات رفع‌شده نسبت به نسخهٔ قبل:
    ///   • ListenPos صدا زده نمی‌شود؛ آن هم روی همان پورت گوش می‌دهد و باعث خطای
    ///     «Address already in use» هنگام دریافت پاسخ هر تراکنش می‌شد.
    ///   • همهٔ اعضای ITransactionDoneHandler پیاده‌سازی شده‌اند (قبلاً کامپایل نمی‌شد).
    ///   • خطاهای OnFinish فوراً به پرداخت برمی‌گردند و تا پایان زمان منتظر نمی‌مانیم.
    /// </summary>
    internal sealed class PosNative : ITransactionDoneHandler
    {
        private readonly Config _config;
        private readonly TransactionJournal _journal;
        private readonly object _gate = new object();
        private PCPos _pos;
        private ManualResetEvent _done;
        private TransactionResult _result;
        private string _finishMessage;
        private PosTransaction _current;

        public bool Ready { get; private set; }
        public string LastError { get; private set; }

        public PosNative(Config config, TransactionJournal journal)
        {
            _config = config;
            _journal = journal;
        }

        public bool Start()
        {
            try
            {
                Stop();
                _pos = new PCPos(_config.DevicePort);
                if (_config.IsLan) _pos.InitLAN(_config.DeviceIp);
                else _pos.InitSerial(_config.ComPort, _config.BaudRate);
                _pos.ResponseConnectionMode = _config.ResponseMode == "same";
                _pos.TimeOutPerTransaction = _config.TimeoutSeconds * 1000;

                Ready = true;
                LastError = null;
                PosLog.Info("sdk:start", "کتابخانهٔ رسمی آماده شد — " +
                    (_config.IsLan ? _config.DeviceIp + ":" + _config.DevicePort : _config.ComPort));
                return true;
            }
            catch (Exception ex)
            {
                Ready = false;
                LastError = ex.Message;
                PosLog.Error("sdk:start", "راه‌اندازی کتابخانهٔ رسمی ناموفق بود: " + ex.Message);
                return false;
            }
        }

        public void Stop()
        {
            try { if (_pos != null) _pos.Stop(); }
            catch { /* ignore */ }
            _pos = null;
            Ready = false;
        }

        public void OnTransactionDone(TransactionResult result)
        {
            PosTransaction late = null;
            lock (_gate)
            {
                if (_done != null)
                {
                    _result = result;
                    _done.Set();
                }
                else late = _current;
            }

            // پاسخ بعد از اینکه کیوسک انتظار را تمام کرده بود
            if (late != null)
            {
                var tx = _journal.Get(late.Id) ?? late;
                PaymentRules.ApplyLate(tx, ToResponse(result), _config.TerminalId, _config.RequireRrn, _journal);
            }
        }

        public void OnFinish(string message)
        {
            PosLog.Info("sdk:finish", message ?? "");
            lock (_gate)
            {
                _finishMessage = message;
                // «پایان عملیات» بعد از OnTransactionDone می‌آید؛ بقیه یعنی خطا و پاسخی در کار نیست
                if (_done != null && message != "پایان عملیات") _done.Set();
            }
        }

        public PosInquiryTitleResponseModel OnTitleRequest()
        {
            return null;
        }

        public void OnPosInquiryRequest(string data, string ip)
        {
            PosLog.Info("sdk:inquiry", "درخواست استعلام از " + ip);
        }

        public PosTransaction Pay(PosTransaction tx, Func<bool> cancelRequested)
        {
            tx.Via = "sdk";
            if (!Ready && !Start())
                return Fail(tx, "کتابخانهٔ رسمی کارت‌خوان راه‌اندازی نشد: " + (LastError ?? "نامشخص"));
            if (PCPos.IsExecutionInProgress)
                return Fail(tx, "کتابخانهٔ کارت‌خوان هنوز مشغول تراکنش قبلی است");

            var done = new ManualResetEvent(false);
            lock (_gate)
            {
                _result = null;
                _finishMessage = null;
                _done = done;
                _current = tx;
            }

            try
            {
                tx.Status = "sending";
                _journal.Save(tx);
                _pos.DoASyncPayment(tx.AmountRial.ToString(), "", tx.PosInvoice, _config.PcposAppId ?? "", DateTime.Now, this);
                tx.Status = "sent";
                tx.SentAt = PosTransaction.Now();
                _journal.Save(tx);
            }
            catch (Exception ex)
            {
                lock (_gate) _done = null;
                return Fail(tx, "ارسال درخواست به دستگاه ناموفق بود: " + ex.Message);
            }

            var deadline = DateTime.UtcNow.AddSeconds(_config.TimeoutSeconds + 5);
            DateTime? cancelDeadline = null;
            while (!done.WaitOne(250))
            {
                if (cancelDeadline == null && cancelRequested())
                {
                    cancelDeadline = DateTime.UtcNow.AddSeconds(_config.CancelGraceSeconds);
                    tx.CancelRequested = true;
                    _journal.Save(tx);
                }
                if (DateTime.UtcNow > deadline) break;
                if (cancelDeadline.HasValue && DateTime.UtcNow > cancelDeadline.Value) break;
            }

            TransactionResult res;
            string finish;
            lock (_gate)
            {
                res = _result;
                finish = _finishMessage;
                _done = null;

                if (res != null)
                {
                    PaymentRules.Apply(tx, ToResponse(res), _config.TerminalId, _config.RequireRrn, _journal);
                }
                else if (finish != null && finish != "پایان عملیات")
                {
                    // خطاهای پیش از ارسال یعنی قطعاً کسر وجهی رخ نداده؛ بقیه نامعلوم‌اند
                    var beforeSend = Array.Exists(PreSendErrors, e => finish.StartsWith(e, StringComparison.Ordinal));
                    tx.Status = beforeSend ? "failed" : "uncertain";
                    tx.NeedsReview = !beforeSend;
                    tx.Message = "کتابخانهٔ کارت‌خوان: " + finish;
                }
                else if (tx.CancelRequested)
                {
                    tx.Status = "cancelled";
                    tx.Message = "تراکنش لغو شد";
                }
                else
                {
                    tx.Status = "timeout";
                    tx.NeedsReview = true;
                    tx.Message = "پاسخی از کارت‌خوان نرسید (پایان زمان انتظار)";
                }
                tx.CompletedAt = PosTransaction.Now();
                _journal.Save(tx);
                _current = tx;
            }

            PosLog.Info("pay:result", tx.Status + " — " + tx.Message);
            return tx;
        }

        /// <summary>پیام‌های کتابخانهٔ رسمی که پیش از ارسال درخواست به دستگاه رخ می‌دهند</summary>
        private static readonly string[] PreSendErrors =
        {
            "در زمان موردنظر اتصال برقرار نشد",
            "تنظیمات وارد شده برای آدرس شبکه صحیح نیست",
            "هم‌اکنون درخواست قبلی در حال اجرا است",
            "ابتدا می‌بایست سوکت یا سریال را",
            "حداکثر ۱۰ شبا مجاز است",
            "خطا در باز کردن پورت سریال",
        };

        private static PosBuyResponse ToResponse(TransactionResult r)
        {
            // MessageId در کتابخانهٔ رسمی گاهی چک‌سام را هم همراه دارد؛ فقط رقم‌ها
            var mid = new StringBuilder();
            foreach (var c in r.MessageId ?? "") { if (c < '0' || c > '9') break; mid.Append(c); }
            return new PosBuyResponse
            {
                ChecksumValid = true,
                Type = "POSBUY",
                Code = r.ErrorCode,
                Amount = r.PaymentAmount ?? "",
                Rrn = r.RRN ?? "",
                Stan = r.Stan ?? "",
                DateTime = r.DateTime ?? "",
                MerchantId = r.MerchantId ?? "",
                TerminalId = r.TerminalId ?? "",
                CardNumber = r.CardNumber ?? "",
                MessageId = mid.ToString()
            };
        }

        private PosTransaction Fail(PosTransaction tx, string message)
        {
            tx.Status = "failed";
            tx.Message = message;
            tx.CompletedAt = PosTransaction.Now();
            _journal.Save(tx);
            PosLog.Error("sdk:pay", message);
            return tx;
        }
    }
}
