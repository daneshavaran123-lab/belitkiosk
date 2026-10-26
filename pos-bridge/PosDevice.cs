using System;
using System.Collections.Generic;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using System.Threading;

namespace PosBridge
{
    /// <summary>
    /// لایهٔ پرداخت با کارت‌خوان (PAX Q58 و مشابه با پروتکل PC-POS).
    ///
    /// همهٔ پرداخت‌ها از اینجا می‌گذرند تا قواعد ایمنی یک‌جا اعمال شوند:
    ///   • هر تراکنش یک شناسهٔ یکتا از کیوسک دارد؛ درخواست تکراری با همان شناسه دوباره پرداخت
    ///     نمی‌کند و همان نتیجهٔ قبلی را برمی‌گرداند.
    ///   • هم‌زمان فقط یک پرداخت روی دستگاه انجام می‌شود.
    ///   • مبلغ در بازهٔ مجاز بررسی می‌شود.
    ///   • هیچ مسیر «تلاش دوباره با روش دیگر» بعد از ارسال درخواست وجود ندارد (کسر دوبارهٔ وجه).
    /// </summary>
    internal class PosDevice : IDisposable
    {
        private static readonly Regex IdPattern = new Regex("^[A-Za-z0-9-]{8,64}$");

        private readonly Config _config;
        private readonly TransactionJournal _journal;
        private readonly PcPosLanClient _lan;
        private readonly PosNative _native;
        private readonly object _payLock = new object();
        private volatile PosTransaction _current;
        private volatile bool _cancelRequested;
        private volatile bool _retired;

        private readonly object _probeLock = new object();
        private DateTime _probeAt = DateTime.MinValue;
        private bool _probeOk;

        public PosDevice(Config config, TransactionJournal journal)
        {
            _config = config;
            _journal = journal;
            if (config.Simulate) return;
            if (config.EffectiveProtocol == "native") _lan = new PcPosLanClient(config.ToLanOptions(), journal);
            else
            {
                _native = new PosNative(config, journal);
                _native.Start();
            }
        }

        public bool Busy
        {
            get { return _current != null; }
        }

        public bool LibraryLoaded
        {
            get { return _native != null && _native.Ready; }
        }

        public void Dispose()
        {
            if (_lan != null) _lan.Dispose();
            if (_native != null) _native.Stop();
        }

        /// <summary>
        /// کنار گذاشتن این نمونه برای اعمال تنظیمات تازه؛ اگر پرداختی در جریان باشد false می‌دهد
        /// تا تراکنش نیمه‌کاره با بسته شدن اتصال‌ها خراب نشود.
        /// </summary>
        public bool Retire()
        {
            if (!Monitor.TryEnter(_payLock)) return false;
            try
            {
                _retired = true;
                Dispose();
                return true;
            }
            finally
            {
                Monitor.Exit(_payLock);
            }
        }

        /* ---------------------------- پرداخت ---------------------------- */

        public sealed class PayOutcome
        {
            public int Status;
            public Dictionary<string, object> Body;
        }

        public PayOutcome Pay(string transactionId, long amountRial, string invoiceNumber)
        {
            if (string.IsNullOrEmpty(transactionId)) transactionId = Guid.NewGuid().ToString();
            if (!IdPattern.IsMatch(transactionId)) return Error(400, "BAD_REQUEST", "شناسهٔ تراکنش نامعتبر است");
            if (amountRial <= 0) return Error(400, "BAD_REQUEST", "مبلغ نامعتبر است");
            if (amountRial > _config.MaxAmountRial)
                return Error(400, "AMOUNT_LIMIT", "مبلغ بیش از سقف مجاز یک تراکنش (" + _config.MaxAmountRial + " ریال) است");

            var replay = Replay(transactionId, amountRial);
            if (replay != null) return replay;

            if (!Monitor.TryEnter(_payLock))
                return Error(409, "DEV_BUSY", "کارت‌خوان مشغول تراکنش دیگری است؛ چند لحظه بعد دوباره تلاش کنید");
            try
            {
                if (_retired) return Error(503, "RECONFIGURING", "تنظیمات کارت‌خوان در حال اعمال است؛ دوباره تلاش کنید");

                // بررسی دوباره پس از گرفتن قفل (درخواست هم‌زمان با همان شناسه)
                replay = Replay(transactionId, amountRial);
                if (replay != null) return replay;

                var tx = new PosTransaction
                {
                    Id = transactionId,
                    MessageId = _journal.NextMessageId(),
                    InvoiceNumber = (invoiceNumber ?? "").Trim(),
                    PosInvoice = PcPosProtocol.ToPosInvoice(invoiceNumber, _config.InvoiceMaxDigits),
                    AmountRial = amountRial,
                    Status = "pending",
                    CreatedAt = PosTransaction.Now()
                };
                _journal.Save(tx);
                _cancelRequested = false;
                _current = tx;
                PosLog.Info("pay:start", "فاکتور " + tx.InvoiceNumber + " — مبلغ " + amountRial + " ریال — شناسه " + tx.Id);

                PosTransaction result;
                if (_config.Simulate) result = Simulate(tx);
                else if (_lan != null) result = _lan.Pay(tx);
                else result = _native.Pay(tx, () => _cancelRequested);

                return new PayOutcome { Status = 200, Body = result.ToResult() };
            }
            finally
            {
                _current = null;
                _cancelRequested = false;
                Monitor.Exit(_payLock);
            }
        }

        private PayOutcome Replay(string transactionId, long amountRial)
        {
            var existing = _journal.Get(transactionId);
            if (existing == null) return null;
            if (existing.AmountRial != amountRial)
                return Error(409, "ID_REUSED", "این شناسهٔ تراکنش قبلاً با مبلغ دیگری استفاده شده است");

            var body = existing.ToResult();
            body["replayed"] = true;
            if (!existing.IsFinal)
            {
                body["code"] = "IN_PROGRESS";
                return new PayOutcome { Status = 409, Body = body };
            }
            PosLog.Warn("pay:replay", "درخواست تکراری برای تراکنش " + transactionId + " — نتیجهٔ قبلی برگردانده شد");
            return new PayOutcome { Status = 200, Body = body };
        }

        private PosTransaction Simulate(PosTransaction tx)
        {
            tx.Via = "simulate";
            tx.Status = "sent";
            tx.SentAt = PosTransaction.Now();
            _journal.Save(tx);
            for (var i = 0; i < 10; i++)
            {
                Thread.Sleep(250);
                if (_cancelRequested)
                {
                    tx.Status = "cancelled";
                    tx.CancelRequested = true;
                    tx.Message = "تراکنش لغو شد (شبیه‌سازی)";
                    tx.CompletedAt = PosTransaction.Now();
                    _journal.Save(tx);
                    return tx;
                }
            }
            PaymentRules.Apply(tx, new PosBuyResponse
            {
                ChecksumValid = true,
                Type = "POSBUY",
                Code = 0,
                Amount = tx.AmountRial.ToString(),
                Rrn = "SIM" + tx.MessageId.ToString("D9"),
                Stan = (tx.MessageId % 1000000).ToString("D6"),
                TerminalId = _config.TerminalId,
                MerchantId = _config.MerchantId,
                CardNumber = "6037990000001234",
                MessageId = tx.MessageId.ToString()
            }, _config.TerminalId, _config.RequireRrn, _journal);
            if (tx.IsSuccess) tx.Message = "تراکنش موفق (شبیه‌سازی)";
            _journal.Save(tx);
            return tx;
        }

        public bool Cancel(string transactionId)
        {
            var cur = _current;
            if (cur == null) return false;
            if (!string.IsNullOrEmpty(transactionId) && transactionId != cur.Id) return false;
            _cancelRequested = true;
            if (_lan != null) _lan.Cancel(cur.Id);
            PosLog.Warn("cancel", "درخواست لغو تراکنش " + cur.Id);
            return true;
        }

        public Dictionary<string, object> Status(string transactionId)
        {
            var tx = _journal.Get(transactionId);
            return tx == null ? null : tx.ToResult();
        }

        public List<Dictionary<string, object>> Transactions(int limit)
        {
            var list = new List<Dictionary<string, object>>();
            foreach (var t in _journal.Recent(limit)) list.Add(t.ToResult());
            return list;
        }

        public bool MarkReviewed(string transactionId, string note)
        {
            var tx = _journal.Get(transactionId);
            if (tx == null) return false;
            tx.Reviewed = true;
            tx.NeedsReview = false;
            if (!string.IsNullOrEmpty(note)) tx.Note = (string.IsNullOrEmpty(tx.Note) ? "" : tx.Note + " | ") + "بررسی: " + note;
            _journal.Save(tx);
            PosLog.Info("review", "تراکنش " + transactionId + " بررسی شد");
            return true;
        }

        public int NeedsReviewCount()
        {
            var n = 0;
            foreach (var t in _journal.Recent(500)) if (t.NeedsReview && !t.Reviewed) n++;
            return n;
        }

        /* ---------------------------- وضعیت ---------------------------- */

        /// <summary>بررسی در دسترس بودن خود دستگاه (نه فقط سرویس پل)</summary>
        public Dictionary<string, object> DeviceStatus()
        {
            var info = new Dictionary<string, object>
            {
                { "mode", _config.IsLan ? "lan" : "com" },
                { "protocol", _config.Simulate ? "simulate" : _config.EffectiveProtocol },
                { "responseMode", _config.ResponseMode },
                { "callbackPort", _lan != null ? _lan.CallbackPort : _config.DevicePort },
                { "callbackListening", _lan != null && _lan.ListenerReady },
                { "callbackError", _lan != null ? _lan.ListenerError : null },
                { "terminalId", _config.TerminalId },
                { "merchantId", _config.MerchantId },
                { "serialNumber", _config.SerialNumber },
                { "libraryLoaded", _lan != null || LibraryLoaded },
                { "busy", Busy },
                { "needsReview", NeedsReviewCount() },
                { "tokenRequired", !string.IsNullOrEmpty(_config.AccessToken) },
                { "printerName", string.IsNullOrEmpty(_config.PrinterName) ? Printer.DefaultPrinter() : _config.PrinterName },
                { "printEnabled", _config.PrintEnabled },
                { "simulate", _config.Simulate }
            };

            if (_config.Simulate)
            {
                info["connected"] = true;
                info["message"] = "حالت شبیه‌سازی فعال است";
                return info;
            }

            if (_config.IsLan)
            {
                info["deviceIp"] = _config.DeviceIp;
                info["devicePort"] = _config.DevicePort;
                if (Busy)
                {
                    // وسط تراکنش هیچ اتصال اضافه‌ای به دستگاه زده نمی‌شود
                    info["connected"] = true;
                    info["message"] = "تراکنش در جریان است";
                    return info;
                }
                var ok = ProbeCached();
                var listenerOk = _lan == null || !_lan.UsesCallback || _lan.ListenerReady;
                info["connected"] = ok && listenerOk;
                info["message"] = !ok
                    ? "دستگاه در آدرس " + _config.DeviceIp + ":" + _config.DevicePort + " پاسخ نمی‌دهد"
                    : listenerOk
                        ? "دستگاه روی شبکه پاسخ می‌دهد"
                        : "پورت " + _lan.CallbackPort + " برای دریافت پاسخ دستگاه باز نشد: " + _lan.ListenerError;
            }
            else
            {
                info["comPort"] = _config.ComPort;
                info["connected"] = LibraryLoaded;
                info["message"] = LibraryLoaded
                    ? "کتابخانهٔ رسمی روی " + _config.ComPort + " آماده است"
                    : "کتابخانهٔ رسمی کارت‌خوان راه‌اندازی نشد";
            }

            return info;
        }

        /// <summary>نتیجهٔ بررسی دسترسی را چند ثانیه نگه می‌داریم تا دستگاه مدام اتصال تازه نگیرد</summary>
        private bool ProbeCached()
        {
            lock (_probeLock)
            {
                if ((DateTime.UtcNow - _probeAt).TotalSeconds < 5) return _probeOk;
                _probeOk = CanReach(_config.DeviceIp, _config.DevicePort, 1500);
                _probeAt = DateTime.UtcNow;
                return _probeOk;
            }
        }

        public static bool CanReach(string ip, int port, int timeoutMs)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var ar = client.BeginConnect(ip, port, null, null);
                    var ok = ar.AsyncWaitHandle.WaitOne(timeoutMs, false);
                    if (!ok) return false;
                    client.EndConnect(ar);
                    return client.Connected;
                }
            }
            catch { return false; }
        }

        /// <summary>
        /// تست ارتباط با دستگاه: فقط اتصال TCP و اندازه‌گیری زمان؛ هیچ داده‌ای به دستگاه فرستاده نمی‌شود
        /// (پروتکل PC-POS فرمان «وضعیت» ندارد و فرستادن دادهٔ نامعتبر دستگاه را گیج می‌کند).
        /// </summary>
        public Dictionary<string, object> Ping(string ipOverride, int portOverride, int timeoutMs)
        {
            var ip = string.IsNullOrEmpty(ipOverride) ? _config.DeviceIp : ipOverride;
            var port = portOverride > 0 ? portOverride : _config.DevicePort;

            var res = new Dictionary<string, object>
            {
                { "deviceIp", ip },
                { "devicePort", port },
                { "serialNumber", _config.SerialNumber },
                { "reportedSerial", _config.SerialNumber },
                { "reportedModel", _config.Model },
                { "reportedFirmware", _config.Firmware },
                { "identityVerified", false }
            };

            if (_config.Simulate)
            {
                Thread.Sleep(120);
                res["ok"] = true; res["stage"] = "handshake"; res["latencyMs"] = 120; res["code"] = "OK";
                res["message"] = "حالت شبیه‌سازی — پاسخ ساختگی";
                return res;
            }

            if (Busy)
            {
                res["ok"] = true; res["stage"] = "tcp"; res["latencyMs"] = 0; res["code"] = "OK";
                res["message"] = "کارت‌خوان مشغول تراکنش است";
                return res;
            }

            if (!_config.IsLan)
            {
                res["ok"] = LibraryLoaded;
                res["stage"] = "tcp";
                res["latencyMs"] = 0;
                res["code"] = LibraryLoaded ? "OK" : "CFG_INVALID";
                res["message"] = LibraryLoaded
                    ? "اتصال USB روی " + _config.ComPort + " آماده است"
                    : "کتابخانهٔ رسمی کارت‌خوان راه‌اندازی نشد (اتصال USB)";
                return res;
            }

            if (!Config.IsValidIp(ip))
            {
                res["ok"] = false; res["stage"] = "network"; res["latencyMs"] = 0; res["code"] = "CFG_INVALID";
                res["message"] = "IP نامعتبر است: " + ip;
                return res;
            }

            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                using (var client = new TcpClient())
                {
                    var ar = client.BeginConnect(ip, port, null, null);
                    if (!ar.AsyncWaitHandle.WaitOne(timeoutMs, false) || !client.Connected)
                    {
                        res["ok"] = false; res["stage"] = "tcp"; res["latencyMs"] = sw.ElapsedMilliseconds; res["code"] = "NET_REFUSED";
                        res["message"] = "پورت " + port + " روی " + ip + " باز نشد (دستگاه خاموش است، IP اشتباه است یا PC-POS روی دستگاه فعال نیست)";
                        PosLog.Error("ping", Convert.ToString(res["message"]));
                        return res;
                    }
                    client.EndConnect(ar);
                }
                res["ok"] = true; res["stage"] = "tcp"; res["latencyMs"] = sw.ElapsedMilliseconds; res["code"] = "OK";
                res["message"] = "پورت PC-POS دستگاه باز است (" + sw.ElapsedMilliseconds + "ms)";
                PosLog.Info("ping", Convert.ToString(res["message"]));
                return res;
            }
            catch (Exception ex)
            {
                res["ok"] = false; res["stage"] = "network"; res["latencyMs"] = sw.ElapsedMilliseconds;
                res["code"] = ClassifyNetworkError(ex);
                res["message"] = "خطای شبکه: " + ex.Message;
                PosLog.Error("ping", Convert.ToString(res["message"]));
                return res;
            }
        }

        /// <summary>مقایسهٔ سریال‌ها با نادیده گرفتن فاصله و صفرِ ابتدایی</summary>
        public static bool SerialMatches(string reported, string expected)
        {
            if (string.IsNullOrEmpty(reported) || string.IsNullOrEmpty(expected)) return false;
            Func<string, string> norm = v => Regex.Replace(v, "[^0-9A-Za-z]", "").TrimStart('0').ToUpperInvariant();
            return norm(reported) == norm(expected);
        }

        /// <summary>
        /// اسکن یک یا چند زیرشبکه برای پیدا کردن دستگاه‌هایی که پورت PC-POS آن‌ها باز است.
        /// دستگاه سریال خود را اعلام نمی‌کند، پس serialMatch فقط وقتی true است که IP همان IP ثبت‌شده باشد.
        /// </summary>
        public List<Dictionary<string, object>> DiscoverDetailed(
            List<string> subnetPrefixes, int port, int timeoutMs, string expectedSerial)
        {
            var found = new List<Dictionary<string, object>>();
            if (Busy) return found;
            var total = subnetPrefixes.Count * 254;
            if (total == 0) return found;
            var latch = new CountdownEvent(total);

            foreach (var prefixItem in subnetPrefixes)
            {
                var prefix = prefixItem;
                for (var i = 1; i <= 254; i++)
                {
                    var ip = prefix + "." + i;
                    ThreadPool.QueueUserWorkItem(_ =>
                    {
                        try
                        {
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            if (!CanReach(ip, port, timeoutMs)) return;
                            var known = ip == _config.DeviceIp;
                            var entry = new Dictionary<string, object>
                            {
                                { "ip", ip },
                                { "latencyMs", sw.ElapsedMilliseconds },
                                { "serialNumber", known ? _config.SerialNumber : "" },
                                { "serialMatch", known }
                            };
                            lock (found) found.Add(entry);
                            PosLog.Info("discover", "پورت " + port + " روی " + ip + " باز است" + (known ? " (دستگاه ثبت‌شده)" : ""));
                        }
                        catch { /* ignore */ }
                        finally { latch.Signal(); }
                    });
                }
            }

            latch.Wait(timeoutMs + 15000);
            found.Sort((a, b) =>
            {
                var am = Convert.ToBoolean(a["serialMatch"]) ? 0 : 1;
                var bm = Convert.ToBoolean(b["serialMatch"]) ? 0 : 1;
                if (am != bm) return am - bm;
                return string.CompareOrdinal(Convert.ToString(a["ip"]), Convert.ToString(b["ip"]));
            });
            return found;
        }

        /// <summary>تبدیل خطای شبکه به کد کوتاه برای نمایش در پنل</summary>
        private static string ClassifyNetworkError(Exception ex)
        {
            var m = (ex.Message ?? "").ToLowerInvariant();
            if (m.Contains("refused") || m.Contains("رد شد")) return "NET_REFUSED";
            if (m.Contains("timed out") || m.Contains("timeout")) return "NET_TIMEOUT";
            if (m.Contains("unreachable") || m.Contains("no such host") || m.Contains("not known")) return "NET_UNREACHABLE";
            if (m.Contains("busy")) return "DEV_BUSY";
            return "UNKNOWN";
        }

        private static PayOutcome Error(int status, string code, string message)
        {
            PosLog.Error("pay", message);
            return new PayOutcome
            {
                Status = status,
                Body = new Dictionary<string, object>
                {
                    { "success", false }, { "final", true }, { "code", code }, { "message", message }
                }
            };
        }
    }
}
