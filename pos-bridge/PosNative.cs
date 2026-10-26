using System;
using System.Collections.Generic;
using System.Reflection;
using System.Threading;
using PosInterface;

namespace PosBridge
{
    /// <summary>
    /// ارتباط واقعی با کارت‌خوان از طریق کتابخانهٔ رسمی PosInterface.dll.
    /// دستگاه به‌صورت LAN به سرویس ما وصل می‌شود؛ ما روی پورت listenPort گوش می‌دهیم
    /// و درخواست پرداخت را با DoASyncPayment می‌فرستیم و نتیجه را در OnTransactionDone می‌گیریم.
    /// </summary>
    internal sealed class PosNative : ITransactionDoneHandler
    {
        private readonly Config _config;
        private readonly object _gate = new object();
        private PCPos _pos;
        private AutoResetEvent _done;
        private TransactionResult _result;
        private string _finishMessage;

        public bool Ready { get; private set; }
        public string LastError { get; private set; }

        public PosNative(Config config)
        {
            _config = config;
        }

        /// <summary>راه‌اندازی گوش‌دادن روی پورت و اتصال LAN/سریال به دستگاه</summary>
        public bool Start()
        {
            try
            {
                Stop();
                _pos = new PCPos(_config.PosListenPort);
                _pos.ListenPos(this);
                if (_config.IsLan) _pos.InitLAN(_config.DeviceIp);
                else _pos.InitSerial(_config.ComPort, _config.BaudRate);

                Ready = true;
                LastError = null;
                PosLog.Info("sdk:start", "کتابخانهٔ رسمی روی پورت " + _config.PosListenPort +
                    (_config.IsLan ? " و آی‌پی " + _config.DeviceIp : " و پورت سریال " + _config.ComPort) + " آماده شد");
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
            lock (_gate)
            {
                _result = result;
                if (_done != null) _done.Set();
            }
        }

        public void OnFinish(string message)
        {
            _finishMessage = message;
            PosLog.Info("sdk:finish", message ?? "");
        }

        /// <summary>ارسال درخواست فروش و انتظار برای نتیجهٔ دستگاه</summary>
        public Dictionary<string, object> Pay(long amountRial, string invoiceNumber, int timeoutSeconds)
        {
            if (!Ready && !Start())
                return Fail("کتابخانهٔ رسمی کارت‌خوان راه‌اندازی نشد: " + (LastError ?? "نامشخص"));

            lock (_gate) { _result = null; _finishMessage = null; _done = new AutoResetEvent(false); }

            try
            {
                _pos.DoASyncPayment(amountRial.ToString(), "", invoiceNumber, DateTime.Now, this);
            }
            catch (Exception ex)
            {
                PosLog.Error("sdk:pay", "ارسال درخواست پرداخت ناموفق بود: " + ex.Message);
                return Fail("ارسال درخواست به دستگاه ناموفق بود: " + ex.Message);
            }

            if (!_done.WaitOne(TimeSpan.FromSeconds(timeoutSeconds)))
                return Fail("پاسخی از دستگاه دریافت نشد (پایان زمان انتظار)");

            TransactionResult res;
            lock (_gate) res = _result;
            if (res == null) return Fail(_finishMessage ?? "پاسخ دستگاه خالی بود");

            var code = Str(res, "ErrorCode");
            var rrn = Str(res, "RRN");
            var pan = Str(res, "CardNumber");
            var stan = Str(res, "Stan");
            var errMsg = Str(res, "ErrorMsg");
            var success = code == "00" || code == "0" || (string.IsNullOrEmpty(code) && !string.IsNullOrEmpty(rrn));

            var payload = new Dictionary<string, object>
            {
                { "success", success },
                { "responseCode", code },
                { "message", success ? "تراکنش موفق" : (string.IsNullOrEmpty(errMsg) ? "تراکنش ناموفق (کد " + code + ")" : errMsg) },
                { "refNumber", rrn },
                { "maskedPan", pan },
                { "stan", stan },
                { "terminalId", string.IsNullOrEmpty(Str(res, "TerminalId")) ? _config.TerminalId : Str(res, "TerminalId") },
                { "merchantId", string.IsNullOrEmpty(Str(res, "MerchantId")) ? _config.MerchantId : Str(res, "MerchantId") },
                { "invoiceNumber", Str(res, "InvoiceNumber") },
                { "dateTime", Str(res, "DateTime") },
                { "via", "sdk" }
            };

            if (success) PosLog.Info("pay:result", "تراکنش موفق — پیگیری " + rrn);
            else PosLog.Error("pay:result", Convert.ToString(payload["message"]));
            return payload;
        }

        /// <summary>خواندن یک ویژگی از نتیجهٔ تراکنش (نام‌ها بین نسخه‌های SDK فرق می‌کند)</summary>
        private static string Str(object obj, string prop)
        {
            if (obj == null) return "";
            try
            {
                var p = obj.GetType().GetProperty(prop,
                    BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
                if (p == null)
                {
                    var f = obj.GetType().GetField(prop,
                        BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
                    if (f == null) return "";
                    return Convert.ToString(f.GetValue(obj)) ?? "";
                }
                return Convert.ToString(p.GetValue(obj, null)) ?? "";
            }
            catch { return ""; }
        }

        private static Dictionary<string, object> Fail(string message)
        {
            PosLog.Error("sdk:pay", message);
            return new Dictionary<string, object>
            {
                { "success", false },
                { "responseCode", "" },
                { "message", message },
                { "refNumber", "" },
                { "maskedPan", "" },
                { "via", "sdk" }
            };
        }
    }
}
