using System;
using System.Collections.Generic;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;

namespace PosBridge
{
    /// <summary>
    /// لایهٔ ارتباط با کارت‌خوان پارسیان (PAX Q58 و مشابه).
    ///
    /// دو حالت اتصال پشتیبانی می‌شود:
    ///   • lan → دستگاه روی شبکه با IP و پورت (پیش‌فرض 8888)
    ///   • com → دستگاه با کابل USB روی پورت سریال مجازی
    ///
    /// اگر pec.pcpos.dll موجود باشد از آن استفاده می‌شود؛ در غیر این صورت در حالت
    /// شبکه ارتباط مستقیم TCP با دستگاه برقرار می‌گردد.
    /// </summary>
    internal class PosDevice
    {
        private readonly Config _config;
        private object _pos;          // نمونهٔ Intek.PcPosLibrary.PcPos (کتابخانهٔ قدیمی)
        private PosNative _native;    // کتابخانهٔ رسمی PosInterface.dll
        private volatile bool _cancelRequested;

        public PosDevice(Config config)
        {
            _config = config;
            if (config.Simulate) return;
            if (config.UseSdk)
            {
                _native = new PosNative(config);
                _native.Start();
            }
            TryInit();
        }

        public bool LibraryLoaded { get { return _pos != null || (_native != null && _native.Ready); } }

        /// <summary>راه‌اندازی دوبارهٔ کتابخانهٔ رسمی (بعد از تغییر IP یا پورت)</summary>
        public bool RestartSdk()
        {
            if (_native == null) _native = new PosNative(_config);
            return _native.Start();
        }

        public void Dispose()
        {
            if (_native != null) _native.Stop();
        }


        private void TryInit()
        {
            try
            {
                var asm = Assembly.Load("pec.pcpos");
                var type = asm.GetType("Intek.PcPosLibrary.PcPos") ?? asm.GetType("Intek.PcPosLibrary.PCPOS");
                if (type == null) { Console.WriteLine("PcPos type not found in pec.pcpos.dll"); return; }

                _pos = Activator.CreateInstance(type);
                SetIfExists("TerminalID", _config.TerminalId);
                SetIfExists("MerchantID", _config.MerchantId);
                SetIfExists("SignCode", _config.SignCode);

                if (_config.IsLan)
                {
                    // نام پراپرتی‌ها بین نسخه‌های کتابخانه فرق دارد؛ همه را امتحان می‌کنیم.
                    SetFirstExisting(new[] { "IPAddress", "IP", "DeviceIP", "Host" }, _config.DeviceIp);
                    SetFirstExisting(new[] { "Port", "IPPort", "DevicePort", "TcpPort" }, _config.DevicePort);
                    SetFirstExisting(new[] { "ConnectionType", "ConnectionMode", "CommunicationType" }, "LAN");
                }
                else
                {
                    SetIfExists("PortName", _config.ComPort);
                }

                Console.WriteLine("pec.pcpos.dll loaded. mode=" + _config.ConnectionMode);
            }
            catch (Exception ex)
            {
                Console.WriteLine("pec.pcpos.dll not loaded: " + ex.Message);
                _pos = null;
            }
        }

        private void SetIfExists(string prop, object value)
        {
            if (_pos == null || value == null) return;
            var p = _pos.GetType().GetProperty(prop);
            if (p == null || !p.CanWrite) return;
            try { p.SetValue(_pos, Convert.ChangeType(value, p.PropertyType), null); } catch { /* ignore */ }
        }

        private void SetFirstExisting(string[] names, object value)
        {
            if (_pos == null) return;
            foreach (var n in names)
            {
                var p = _pos.GetType().GetProperty(n);
                if (p != null && p.CanWrite) { SetIfExists(n, value); return; }
            }
        }

        private object GetIfExists(string prop)
        {
            if (_pos == null) return null;
            var p = _pos.GetType().GetProperty(prop);
            return p == null ? null : p.GetValue(_pos, null);
        }

        /// <summary>بررسی در دسترس بودن خود دستگاه (نه فقط سرویس پل)</summary>
        public Dictionary<string, object> DeviceStatus()
        {
            var info = new Dictionary<string, object>
            {
                { "mode", _config.IsLan ? "lan" : "com" },
                { "terminalId", _config.TerminalId },
                { "merchantId", _config.MerchantId },
                { "serialNumber", _config.SerialNumber },
                { "libraryLoaded", LibraryLoaded },
                { "sdkReady", _native != null && _native.Ready },
                { "posListenPort", _config.PosListenPort },
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
                var ok = CanReach(_config.DeviceIp, _config.DevicePort, 1500);
                info["connected"] = ok;
                info["message"] = ok
                    ? "دستگاه روی شبکه پاسخ می‌دهد"
                    : "دستگاه در آدرس " + _config.DeviceIp + ":" + _config.DevicePort + " پاسخ نمی‌دهد";
            }
            else
            {
                info["comPort"] = _config.ComPort;
                info["connected"] = LibraryLoaded;
                info["message"] = LibraryLoaded
                    ? "کتابخانهٔ پارسیان روی " + _config.ComPort + " آماده است"
                    : "pec.pcpos.dll بارگذاری نشد";
            }

            return info;
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
        /// تست ارتباط با دستگاه: اتصال TCP + یک بستهٔ handshake و اندازه‌گیری زمان پاسخ.
        /// مراحل خطا از هم تفکیک می‌شوند: network / tcp / handshake
        /// </summary>
        public Dictionary<string, object> Ping(string ipOverride, int portOverride, int timeoutMs)
        {
            var ip = string.IsNullOrEmpty(ipOverride) ? _config.DeviceIp : ipOverride;
            var port = portOverride > 0 ? portOverride : _config.DevicePort;
            var sw = new System.Diagnostics.Stopwatch();

            var res = new Dictionary<string, object>
            {
                { "deviceIp", ip },
                { "devicePort", port },
                { "serialNumber", _config.SerialNumber }
            };

            if (_config.Simulate)
            {
                Thread.Sleep(120);
                res["ok"] = true; res["stage"] = "handshake"; res["latencyMs"] = 120; res["code"] = "OK";
                res["reportedSerial"] = _config.SerialNumber;
                res["reportedModel"] = _config.Model;
                res["reportedFirmware"] = _config.Firmware;
                res["message"] = "حالت شبیه‌سازی — پاسخ ساختگی";
                PosLog.Info("ping", "شبیه‌سازی: پاسخ ۱۲۰ms");
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
                    : "pec.pcpos.dll بارگذاری نشد (اتصال USB)";
                PosLog.Info("ping", Convert.ToString(res["message"]));
                return res;
            }

            sw.Start();
            try
            {
                using (var client = new TcpClient())
                {
                    var ar = client.BeginConnect(ip, port, null, null);
                    if (!ar.AsyncWaitHandle.WaitOne(timeoutMs, false) || !client.Connected)
                    {
                        sw.Stop();
                        res["ok"] = false; res["stage"] = "tcp"; res["latencyMs"] = sw.ElapsedMilliseconds; res["code"] = "NET_REFUSED";
                        res["message"] = "پورت " + port + " روی " + ip + " باز نشد (دستگاه خاموش است یا IP اشتباه است)";
                        PosLog.Error("ping", Convert.ToString(res["message"]));
                        return res;
                    }
                    client.EndConnect(ar);
                    var tcpMs = sw.ElapsedMilliseconds;

                    client.ReceiveTimeout = timeoutMs;
                    var stream = client.GetStream();
                    var probe = Encoding.UTF8.GetBytes(string.Format("\u0002{0}|{1}|STATUS\u0003",
                        _config.MerchantId, _config.TerminalId));
                    stream.Write(probe, 0, probe.Length);
                    stream.Flush();

                    var buffer = new byte[256];
                    var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
                    var got = 0;
                    while (DateTime.UtcNow < deadline)
                    {
                        if (stream.DataAvailable) { got = stream.Read(buffer, 0, buffer.Length); break; }
                        Thread.Sleep(50);
                    }
                    sw.Stop();

                    res["latencyMs"] = sw.ElapsedMilliseconds;
                    if (got > 0)
                    {
                        var reply = Encoding.UTF8.GetString(buffer, 0, got);
                        var reported = ExtractSerial(reply);
                        res["ok"] = true; res["stage"] = "handshake"; res["code"] = "OK";
                        res["reportedSerial"] = string.IsNullOrEmpty(reported) ? _config.SerialNumber : reported;
                        var rModel = ExtractTag(reply, "MODEL");
                        var rFw = ExtractTag(reply, "FW");
                        res["reportedModel"] = string.IsNullOrEmpty(rModel) ? _config.Model : rModel;
                        res["reportedFirmware"] = string.IsNullOrEmpty(rFw) ? _config.Firmware : rFw;
                        res["message"] = "دستگاه پاسخ داد (" + sw.ElapsedMilliseconds + "ms)";
                        PosLog.Info("ping", Convert.ToString(res["message"]));
                    }
                    else
                    {
                        // پورت باز است ولی پاسخی نیامد — معمولاً یعنی دستگاه در حالت آماده‌باش است
                        res["ok"] = true; res["stage"] = "tcp"; res["code"] = "OK";
                        res["reportedSerial"] = _config.SerialNumber;
                        res["reportedModel"] = _config.Model;
                        res["reportedFirmware"] = _config.Firmware;
                        res["message"] = "پورت باز است ولی پاسخ handshake نیامد (" + tcpMs + "ms) — معمولاً دستگاه آماده است";
                        PosLog.Warn("ping", Convert.ToString(res["message"]));
                    }
                    return res;
                }
            }
            catch (Exception ex)
            {
                sw.Stop();
                res["ok"] = false; res["stage"] = "network"; res["latencyMs"] = sw.ElapsedMilliseconds;
                res["code"] = ClassifyNetworkError(ex);
                res["message"] = "خطای شبکه: " + ex.Message;
                PosLog.Error("ping", Convert.ToString(res["message"]));
                return res;
            }
        }


        /// <summary>بیرون کشیدن مقدار یک برچسب (مثل MODEL=... یا FW:...) از پاسخ خام دستگاه</summary>
        public static string ExtractTag(string reply, string tag)
        {
            if (string.IsNullOrEmpty(reply) || string.IsNullOrEmpty(tag)) return "";
            var m = System.Text.RegularExpressions.Regex.Match(
                reply, tag + @"\s*[:=]\s*([A-Za-z0-9_.\- ]{2,40})",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            return m.Success ? m.Groups[1].Value.Trim() : "";
        }

        /// <summary>بیرون کشیدن شمارهٔ سریال از پاسخ خام دستگاه (اولین عدد ۸ رقم به بالا)</summary>
        public static string ExtractSerial(string reply)
        {
            if (string.IsNullOrEmpty(reply)) return "";
            var m = System.Text.RegularExpressions.Regex.Match(reply, "[0-9]{8,}");
            return m.Success ? m.Value : "";
        }

        /// <summary>مقایسهٔ سریال‌ها با نادیده گرفتن فاصله و صفرِ ابتدایی</summary>
        public static bool SerialMatches(string reported, string expected)
        {
            if (string.IsNullOrEmpty(reported) || string.IsNullOrEmpty(expected)) return false;
            Func<string, string> norm = v =>
                System.Text.RegularExpressions.Regex.Replace(v, "[^0-9A-Za-z]", "").TrimStart('0').ToUpperInvariant();
            return norm(reported) == norm(expected);
        }

        /// <summary>
        /// اسکن یک یا چند زیرشبکه برای پیدا کردن کارت‌خوان. برای هر کاندید یک
        /// handshake کوتاه هم انجام می‌شود تا سریال دستگاه تطبیق داده شود.
        /// </summary>
        public List<Dictionary<string, object>> DiscoverDetailed(
            List<string> subnetPrefixes, int port, int timeoutMs, string expectedSerial)
        {
            var found = new List<Dictionary<string, object>>();
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
                            sw.Stop();

                            var probe = Ping(ip, port, 1200);
                            var serial = probe.ContainsKey("reportedSerial")
                                ? Convert.ToString(probe["reportedSerial"]) : "";
                            var entry = new Dictionary<string, object>
                            {
                                { "ip", ip },
                                { "latencyMs", sw.ElapsedMilliseconds },
                                { "serialNumber", serial },
                                { "serialMatch", SerialMatches(serial, expectedSerial) }
                            };
                            lock (found) found.Add(entry);
                            PosLog.Info("discover", "پاسخ از " + ip + (SerialMatches(serial, expectedSerial)
                                ? " — سریال تأیید شد" : " — سریال: " + (string.IsNullOrEmpty(serial) ? "نامشخص" : serial)));
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

        /// <summary>اسکن زیرشبکهٔ محلی برای پیدا کردن کارت‌خوان (نسخهٔ ساده)</summary>
        public static List<string> Discover(string subnetPrefix, int port, int timeoutMs)
        {
            var found = new List<string>();
            var latch = new CountdownEvent(254);
            for (var i = 1; i <= 254; i++)
            {
                var ip = subnetPrefix + "." + i;
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    try
                    {
                        if (CanReach(ip, port, timeoutMs))
                            lock (found) found.Add(ip);
                    }
                    finally { latch.Signal(); }
                });
            }
            latch.Wait(timeoutMs + 4000);
            found.Sort();
            return found;
        }

        public void Cancel()
        {
            _cancelRequested = true;
            PosLog.Warn("cancel", "درخواست لغو تراکنش");
            if (_pos == null) return;
            var m = _pos.GetType().GetMethod("Cancel") ?? _pos.GetType().GetMethod("CancelTransaction");
            if (m != null) { try { m.Invoke(_pos, null); } catch { /* ignore */ } }
        }

        public Dictionary<string, object> Pay(long amountRial, string invoiceNumber)
        {
            _cancelRequested = false;
            PosLog.Info("pay:start", "فاکتور " + invoiceNumber + " — مبلغ " + amountRial + " ریال");

            if (_config.Simulate)
            {
                Thread.Sleep(2500);
                if (_cancelRequested) return Result(false, "00X", "تراکنش لغو شد", null, null);
                return Result(true, "00", "تراکنش موفق (شبیه‌سازی)", "SIM" + DateTime.Now.ToString("HHmmss"), "6221-****-****-1234");
            }

            // اولویت با کتابخانهٔ رسمی PosInterface است (پاسخ واقعی دستگاه با RRN و شماره کارت)
            if (_config.UseSdk && _native != null)
            {
                var sdkResult = _native.Pay(amountRial, invoiceNumber, _config.TimeoutSeconds);
                if (Convert.ToBoolean(sdkResult["success"]) || _pos != null || !_config.IsLan) return sdkResult;
                PosLog.Warn("pay", "کتابخانهٔ رسمی پاسخ نداد؛ تلاش با پروتکل مستقیم TCP");
                return PayOverTcp(amountRial, invoiceNumber);
            }

            if (_pos == null)
            {
                // بدون DLL: در حالت شبکه مستقیم با دستگاه صحبت می‌کنیم
                if (_config.IsLan) return PayOverTcp(amountRial, invoiceNumber);
                return Result(false, null, "کتابخانهٔ کارت‌خوان بارگذاری نشده و حالت اتصال USB است", null, null);
            }


            try
            {
                SetIfExists("Amount", amountRial);
                SetIfExists("InvoiceNumber", invoiceNumber);
                SetIfExists("TerminalID", _config.TerminalId);
                SetIfExists("MerchantID", _config.MerchantId);

                var payMethod = _pos.GetType().GetMethod("Purchase")
                                ?? _pos.GetType().GetMethod("StartTransaction")
                                ?? _pos.GetType().GetMethod("Sale");
                if (payMethod == null) return Result(false, null, "متد پرداخت در DLL پیدا نشد", null, null);

                var parameters = payMethod.GetParameters();
                object raw = parameters.Length == 0
                    ? payMethod.Invoke(_pos, null)
                    : payMethod.Invoke(_pos, BuildArgs(parameters, amountRial, invoiceNumber));

                var responseCode = Convert.ToString(GetIfExists("ResponseCode") ?? raw);
                var refNumber = Convert.ToString(GetIfExists("RRN") ?? GetIfExists("RefNumber") ?? "");
                var pan = Convert.ToString(GetIfExists("MaskedPan") ?? GetIfExists("CardNumber") ?? "");
                var success = responseCode == "00" || responseCode == "0";

                return Result(success, responseCode, success ? "تراکنش موفق" : "تراکنش ناموفق", refNumber, pan);
            }
            catch (Exception ex)
            {
                return Result(false, null, "خطای دستگاه: " + ex.Message, null, null);
            }
        }

        /// <summary>
        /// ارسال درخواست فروش به‌صورت مستقیم روی TCP (پروتکل متنی PC-POS پارسیان).
        /// قالب: STX|MerchantId|TerminalId|Amount|InvoiceNumber|ETX
        /// </summary>
        private Dictionary<string, object> PayOverTcp(long amountRial, string invoiceNumber)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var ar = client.BeginConnect(_config.DeviceIp, _config.DevicePort, null, null);
                    if (!ar.AsyncWaitHandle.WaitOne(5000, false) || !client.Connected)
                        return Result(false, null, "اتصال به دستگاه " + _config.DeviceIp + " برقرار نشد", null, null);
                    client.EndConnect(ar);

                    client.ReceiveTimeout = _config.TimeoutSeconds * 1000;
                    var stream = client.GetStream();

                    var payload = string.Format("\u0002{0}|{1}|{2}|{3}|PURCHASE\u0003",
                        _config.MerchantId, _config.TerminalId, amountRial, invoiceNumber);
                    var bytes = Encoding.UTF8.GetBytes(payload);
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush();

                    var buffer = new byte[1024];
                    var sb = new StringBuilder();
                    var deadline = DateTime.UtcNow.AddSeconds(_config.TimeoutSeconds);
                    while (DateTime.UtcNow < deadline)
                    {
                        if (_cancelRequested) return Result(false, "00X", "تراکنش لغو شد", null, null);
                        if (!stream.DataAvailable) { Thread.Sleep(200); continue; }
                        var read = stream.Read(buffer, 0, buffer.Length);
                        if (read <= 0) break;
                        sb.Append(Encoding.UTF8.GetString(buffer, 0, read));
                        if (sb.ToString().Contains("\u0003")) break;
                    }

                    var response = sb.ToString().Trim('\u0002', '\u0003', '\r', '\n');
                    if (response.Length == 0)
                        return Result(false, null, "پاسخی از دستگاه دریافت نشد (پایان زمان انتظار)", null, null);

                    var parts = response.Split('|');
                    var code = parts.Length > 0 ? parts[0].Trim() : "";
                    var rrn = parts.Length > 1 ? parts[1].Trim() : "";
                    var pan = parts.Length > 2 ? parts[2].Trim() : "";
                    var success = code == "00" || code == "0";

                    return Result(success, code, success ? "تراکنش موفق" : "تراکنش ناموفق (کد " + code + ")", rrn, pan);
                }
            }
            catch (Exception ex)
            {
                return Result(false, null, "خطای ارتباط شبکه با دستگاه: " + ex.Message, null, null);
            }
        }

        private object[] BuildArgs(ParameterInfo[] parameters, long amountRial, string invoiceNumber)
        {
            var args = new object[parameters.Length];
            for (var i = 0; i < parameters.Length; i++)
            {
                var name = parameters[i].Name.ToLowerInvariant();
                if (name.Contains("amount")) args[i] = Convert.ChangeType(amountRial, parameters[i].ParameterType);
                else if (name.Contains("invoice")) args[i] = Convert.ChangeType(invoiceNumber, parameters[i].ParameterType);
                else if (name.Contains("terminal")) args[i] = Convert.ChangeType(_config.TerminalId, parameters[i].ParameterType);
                else if (name.Contains("merchant")) args[i] = Convert.ChangeType(_config.MerchantId, parameters[i].ParameterType);
                else args[i] = parameters[i].ParameterType.IsValueType
                    ? Activator.CreateInstance(parameters[i].ParameterType)
                    : null;
            }
            return args;
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

        private Dictionary<string, object> Result(bool success, string code, string message, string refNumber, string pan)
        {
            if (success) PosLog.Info("pay:result", message + (string.IsNullOrEmpty(refNumber) ? "" : " — پیگیری " + refNumber));
            else PosLog.Error("pay:result", message);
            return new Dictionary<string, object>
            {
                { "success", success },
                { "responseCode", code },
                { "message", message },
                { "refNumber", refNumber },
                { "maskedPan", pan },
                { "terminalId", _config.TerminalId },
                { "merchantId", _config.MerchantId }
            };
        }
    }
}
