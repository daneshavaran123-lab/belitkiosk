using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization; // System.Web.Extensions

namespace PosBridge
{
    /// <summary>
    /// سرویس پل کارت‌خوان: یک وب‌سرور کوچک روی 127.0.0.1 که درخواست پرداخت را
    /// از کیوسک (مرورگر) می‌گیرد و آن را به دستگاه پوز (شبکه یا USB) می‌فرستد.
    /// </summary>
    internal static class Program
    {
        private static Config _config;
        private static PosDevice _device;
        private static string _configPath;
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        private static void Main()
        {
            _configPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "appsettings.json");
            _config = Config.Load(_configPath);
            _device = new PosDevice(_config);

            var listener = new HttpListener();
            listener.Prefixes.Add(_config.ListenUrl);
            listener.Start();
            Console.WriteLine("POS bridge listening on " + _config.ListenUrl);
            Console.WriteLine("Mode: " + _config.ConnectionMode +
                              (_config.IsLan ? "  " + _config.DeviceIp + ":" + _config.DevicePort : "  " + _config.ComPort));
            PosLog.Info("startup", "سرویس پل روی " + _config.ListenUrl + " بالا آمد — سریال " + _config.SerialNumber);
            Console.WriteLine("Merchant: " + _config.MerchantId + "   Terminal: " + _config.TerminalId +
                              (_config.Simulate ? "  [SIMULATE]" : ""));

            while (true)
            {
                var ctx = listener.GetContext();
                ThreadPool.QueueUserWorkItem(_ => Handle(ctx));
            }
        }

        /// <summary>بررسی توکن دسترسی؛ هدر X-Pos-Token یا پارامتر token (برای SSE)</summary>
        private static bool IsAuthorized(HttpListenerContext ctx)
        {
            if (string.IsNullOrEmpty(_config.AccessToken)) return true;
            var header = ctx.Request.Headers["X-Pos-Token"];
            if (string.IsNullOrEmpty(header)) header = ctx.Request.QueryString["token"];
            return header == _config.AccessToken;
        }

        private static void Handle(HttpListenerContext ctx)
        {
            try
            {
                AddCors(ctx);
                if (ctx.Request.HttpMethod == "OPTIONS") { Write(ctx, 204, ""); return; }

                var path = ctx.Request.Url.AbsolutePath.TrimEnd('/').ToLowerInvariant();

                // مسیرهای حساس فقط با توکن دسترسی (اگر در appsettings.json تنظیم شده باشد)
                if ((path == "/config" || path == "/logs" || path == "/events") && !IsAuthorized(ctx))
                {
                    PosLog.Warn("auth", "درخواست بدون توکن به " + path + " رد شد");
                    WriteJson(ctx, 401, new Dictionary<string, object> { { "error", "unauthorized" } });
                    return;
                }

                switch (path)
                {
                    case "/health":
                        {
                            var payload = new Dictionary<string, object>
                            {
                                { "status", "ok" },
                                { "terminalId", _config.TerminalId },
                                { "merchantId", _config.MerchantId },
                                { "simulate", _config.Simulate },
                                { "device", _device.DeviceStatus() }
                            };
                            WriteJson(ctx, 200, payload);
                            break;
                        }

                    case "/config":
                        {
                            if (ctx.Request.HttpMethod == "POST")
                            {
                                var req = Json.Deserialize<Dictionary<string, object>>(ReadBody(ctx)) ?? new Dictionary<string, object>();
                                if (req.ContainsKey("connectionMode")) _config.ConnectionMode = Convert.ToString(req["connectionMode"]);
                                if (req.ContainsKey("deviceIp")) _config.DeviceIp = Convert.ToString(req["deviceIp"]);
                                if (req.ContainsKey("devicePort")) _config.DevicePort = Convert.ToInt32(req["devicePort"]);
                                if (req.ContainsKey("posListenPort")) _config.PosListenPort = Convert.ToInt32(req["posListenPort"]);
                                if (req.ContainsKey("merchantId")) _config.MerchantId = Convert.ToString(req["merchantId"]);
                                if (req.ContainsKey("terminalId")) _config.TerminalId = Convert.ToString(req["terminalId"]);
                                if (req.ContainsKey("serialNumber")) _config.SerialNumber = Convert.ToString(req["serialNumber"]);
                                if (req.ContainsKey("comPort")) _config.ComPort = Convert.ToString(req["comPort"]);
                                if (req.ContainsKey("networkInterface")) _config.NetworkInterface = Convert.ToString(req["networkInterface"]);
                                if (req.ContainsKey("printerName")) _config.PrinterName = Convert.ToString(req["printerName"]);
                                if (req.ContainsKey("printerFont")) _config.PrinterFont = Convert.ToString(req["printerFont"]);
                                if (req.ContainsKey("printEnabled")) _config.PrintEnabled = Convert.ToBoolean(req["printEnabled"]);
                                if (req.ContainsKey("useSdk")) _config.UseSdk = Convert.ToBoolean(req["useSdk"]);
                                _config.Save(_configPath);
                                _device.Dispose();
                                _device = new PosDevice(_config);
                            }

                            WriteJson(ctx, 200, new Dictionary<string, object>
                            {
                                { "connectionMode", _config.ConnectionMode },
                                { "deviceIp", _config.DeviceIp },
                                { "devicePort", _config.DevicePort },
                                { "posListenPort", _config.PosListenPort },
                                { "merchantId", _config.MerchantId },
                                { "terminalId", _config.TerminalId },
                                { "serialNumber", _config.SerialNumber },
                                { "comPort", _config.ComPort },
                                { "networkInterface", _config.NetworkInterface },
                                { "printerName", _config.PrinterName },
                                { "printerFont", _config.PrinterFont },
                                { "printEnabled", _config.PrintEnabled },
                                { "useSdk", _config.UseSdk },
                                { "simulate", _config.Simulate }
                            });
                            break;
                        }

                    case "/printers":
                        {
                            WriteJson(ctx, 200, new Dictionary<string, object>
                            {
                                { "printers", Printer.ListPrinters() },
                                { "defaultPrinter", Printer.DefaultPrinter() },
                                { "selected", _config.PrinterName },
                                { "printEnabled", _config.PrintEnabled }
                            });
                            break;
                        }

                    case "/print":
                        {
                            if (!_config.PrintEnabled) { WriteJson(ctx, 200, Fail("چاپ بلیط در تنظیمات غیرفعال است")); break; }
                            var req = Json.Deserialize<Dictionary<string, object>>(ReadBody(ctx)) ?? new Dictionary<string, object>();
                            var ticket = BuildTicket(req);
                            if (ticket.TotalToman <= 0 && ticket.Items.Count == 0)
                            { WriteJson(ctx, 400, Fail("اطلاعات بلیط ناقص است")); break; }
                            PosLog.Info("print:start", "چاپ بلیط فاکتور " + ticket.InvoiceNumber);
                            WriteJson(ctx, 200, Printer.Print(ticket, _config.PrinterName, _config.PrinterFont));
                            break;
                        }


                    case "/ping":
                        {
                            var ip = ctx.Request.QueryString["ip"];
                            var portRaw2 = ctx.Request.QueryString["port"];
                            var p = string.IsNullOrEmpty(portRaw2) ? 0 : int.Parse(portRaw2);
                            var timeoutRaw = ctx.Request.QueryString["timeout"];
                            var timeout = string.IsNullOrEmpty(timeoutRaw) ? 2500 : int.Parse(timeoutRaw);
                            WriteJson(ctx, 200, _device.Ping(ip, p, timeout));
                            break;
                        }

                    case "/logs":
                        {
                            if (ctx.Request.HttpMethod == "POST") { PosLog.Clear(); }
                            var afterRaw = ctx.Request.QueryString["after"];
                            var after = string.IsNullOrEmpty(afterRaw) ? 0 : long.Parse(afterRaw);
                            WriteJson(ctx, 200, new Dictionary<string, object>
                            {
                                { "lastId", PosLog.LastId },
                                { "items", PosLog.Since(after) }
                            });
                            break;
                        }

                    case "/events":
                        StreamEvents(ctx);
                        break;

                    case "/discover":
                        {
                            var prefix = ctx.Request.QueryString["subnet"];
                            var prefixes = string.IsNullOrEmpty(prefix)
                                ? LocalSubnetPrefixes()
                                : new List<string> { prefix };
                            var portRaw = ctx.Request.QueryString["port"];
                            var port = string.IsNullOrEmpty(portRaw) ? _config.DevicePort : int.Parse(portRaw);
                            var serial = ctx.Request.QueryString["serial"];
                            if (string.IsNullOrEmpty(serial)) serial = _config.SerialNumber;

                            PosLog.Info("discover", "اسکن زیرشبکه‌های " + string.Join("، ", prefixes.ToArray())
                                + " روی پورت " + port + " با سریال " + serial);
                            var found = _device.DiscoverDetailed(prefixes, port, 400, serial);
                            PosLog.Info("discover", found.Count + " دستگاه پاسخ داد");
                            WriteJson(ctx, 200, new Dictionary<string, object>
                            {
                                { "subnet", prefixes.Count > 0 ? prefixes[0] : "" },
                                { "subnets", prefixes },
                                { "port", port },
                                { "serial", serial },
                                { "devices", found }
                            });
                            break;
                        }


                    case "/pay":
                        {
                            var body = ReadBody(ctx);
                            var req = Json.Deserialize<Dictionary<string, object>>(body) ?? new Dictionary<string, object>();
                            long amountRial = Convert.ToInt64(req.ContainsKey("amountRial") ? req["amountRial"] : 0);
                            string invoice = req.ContainsKey("invoiceNumber") ? Convert.ToString(req["invoiceNumber"]) : "";
                            if (amountRial <= 0) { WriteJson(ctx, 400, Fail("مبلغ نامعتبر است")); break; }

                            var result = _device.Pay(amountRial, invoice);
                            WriteJson(ctx, 200, result);
                            break;
                        }

                    case "/cancel":
                        _device.Cancel();
                        WriteJson(ctx, 200, new Dictionary<string, object> { { "success", false }, { "message", "cancelled" } });
                        break;

                    default:
                        WriteJson(ctx, 404, Fail("not found"));
                        break;
                }
            }
            catch (Exception ex)
            {
                try { WriteJson(ctx, 500, Fail(ex.Message)); } catch { /* ignore */ }
            }
        }

        /// <summary>استریم زندهٔ لاگ و وضعیت (Server-Sent Events) برای صفحهٔ /admin/pos</summary>
        private static void StreamEvents(HttpListenerContext ctx)
        {
            ctx.Response.ContentType = "text/event-stream; charset=utf-8";
            ctx.Response.Headers["Cache-Control"] = "no-cache";
            ctx.Response.SendChunked = true;

            var stream = ctx.Response.OutputStream;
            long last = 0;
            var lastStatus = DateTime.MinValue;
            try
            {
                while (true)
                {
                    foreach (var item in PosLog.Since(last))
                    {
                        last = Convert.ToInt64(item["id"]);
                        SendEvent(stream, "log", item);
                    }

                    if ((DateTime.UtcNow - lastStatus).TotalSeconds >= 5)
                    {
                        lastStatus = DateTime.UtcNow;
                        SendEvent(stream, "status", _device.DeviceStatus());
                    }

                    Thread.Sleep(500);
                }
            }
            catch { /* کلاینت قطع شد */ }
            finally { try { stream.Close(); } catch { } }
        }

        private static void SendEvent(System.IO.Stream stream, string name, object payload)
        {
            var text = "event: " + name + "\ndata: " + Json.Serialize(payload) + "\n\n";
            var bytes = Encoding.UTF8.GetBytes(text);
            stream.Write(bytes, 0, bytes.Length);
            stream.Flush();
        }

        /// <summary>پیشوند زیرشبکهٔ کارت IPv4 محلی، مثل 192.168.16</summary>
        /// <summary>همهٔ زیرشبکه‌های IPv4 فعال روی کیوسک (کابل + وای‌فای)</summary>
        private static List<string> LocalSubnetPrefixes()
        {
            var list = new List<string>();
            try
            {
                foreach (var ni in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Loopback) continue;
                    foreach (var ua in ni.GetIPProperties().UnicastAddresses)
                    {
                        if (ua.Address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) continue;
                        var parts = ua.Address.ToString().Split('.');
                        if (parts[0] == "127" || parts[0] == "169") continue;
                        var pfx = parts[0] + "." + parts[1] + "." + parts[2];
                        if (!list.Contains(pfx)) list.Add(pfx);
                    }
                }
            }
            catch { /* ignore */ }

            if (list.Count == 0) list.Add(LocalSubnetPrefix());
            // زیرشبکهٔ شناخته‌شدهٔ وای‌فای موزه را هم پوشش می‌دهیم
            if (!list.Contains("192.168.16")) list.Add("192.168.16");
            return list;
        }

        private static string LocalSubnetPrefix()
        {
            try
            {
                foreach (var ip in Dns.GetHostAddresses(Dns.GetHostName()))
                {
                    if (ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) continue;
                    var parts = ip.ToString().Split('.');
                    if (parts[0] == "127") continue;
                    return parts[0] + "." + parts[1] + "." + parts[2];
                }
            }
            catch { /* ignore */ }
            return "192.168.16";
        }

        /// <summary>ساخت دادهٔ بلیط از بدنهٔ JSON درخواست چاپ</summary>
        private static TicketData BuildTicket(Dictionary<string, object> req)
        {
            var t = new TicketData();
            Func<string, string> s = key => req.ContainsKey(key) ? Convert.ToString(req[key]) : "";

            if (!string.IsNullOrEmpty(s("museumName"))) t.MuseumName = s("museumName");
            t.InvoiceNumber = s("invoiceNumber");
            t.DateTimeText = s("dateTime");
            t.PaymentMethod = string.IsNullOrEmpty(s("paymentMethod")) ? "card" : s("paymentMethod");
            t.RefNumber = s("refNumber");
            t.MaskedPan = s("maskedPan");
            t.TerminalId = string.IsNullOrEmpty(s("terminalId")) ? _config.TerminalId : s("terminalId");
            t.ResponseCode = s("responseCode");
            t.QrPngBase64 = s("qrPng");
            if (!string.IsNullOrEmpty(s("footer"))) t.Footer = s("footer");
            if (req.ContainsKey("totalToman")) t.TotalToman = Convert.ToInt64(req["totalToman"]);
            if (req.ContainsKey("copies")) t.Copies = Convert.ToInt32(req["copies"]);

            if (req.ContainsKey("items"))
            {
                var arr = req["items"] as System.Collections.IEnumerable;
                if (arr != null)
                {
                    foreach (var raw in arr)
                    {
                        var row = raw as Dictionary<string, object>;
                        if (row == null) continue;
                        t.Items.Add(new TicketLine
                        {
                            Name = row.ContainsKey("name") ? Convert.ToString(row["name"]) : "",
                            Quantity = row.ContainsKey("quantity") ? Convert.ToInt32(row["quantity"]) : 1,
                            TotalToman = row.ContainsKey("totalToman") ? Convert.ToInt64(row["totalToman"]) : 0
                        });
                    }
                }
            }
            return t;
        }

        private static Dictionary<string, object> Fail(string message)

        {
            return new Dictionary<string, object> { { "success", false }, { "message", message } };
        }

        private static void AddCors(HttpListenerContext ctx)
        {
            var origin = ctx.Request.Headers["Origin"];
            if (!string.IsNullOrEmpty(origin) && _config.AllowedOrigins.Contains(origin))
                ctx.Response.Headers["Access-Control-Allow-Origin"] = origin;
            else
                ctx.Response.Headers["Access-Control-Allow-Origin"] = "*";
            ctx.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type, X-Pos-Token";
            ctx.Response.Headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
        }

        private static string ReadBody(HttpListenerContext ctx)
        {
            using (var reader = new StreamReader(ctx.Request.InputStream, Encoding.UTF8))
                return reader.ReadToEnd();
        }

        private static void WriteJson(HttpListenerContext ctx, int status, object payload)
        {
            ctx.Response.ContentType = "application/json; charset=utf-8";
            Write(ctx, status, Json.Serialize(payload));
        }

        private static void Write(HttpListenerContext ctx, int status, string body)
        {
            var bytes = Encoding.UTF8.GetBytes(body);
            ctx.Response.StatusCode = status;
            ctx.Response.ContentLength64 = bytes.Length;
            ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
            ctx.Response.OutputStream.Close();
        }
    }
}
