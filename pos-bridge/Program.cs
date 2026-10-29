using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization; // System.Web.Extensions

namespace PosBridge
{
    /// <summary>
    /// سرویس پل کارت‌خوان: یک وب‌سرور کوچک روی 127.0.0.1 که درخواست پرداخت را
    /// از کیوسک (مرورگر) می‌گیرد و آن را به دستگاه پوز (شبکه یا USB) می‌فرستد.
    ///
    /// لایه‌های امنیتی:
    ///   • فقط روی 127.0.0.1 گوش می‌دهد (از شبکه در دسترس نیست).
    ///   • درخواست مرورگر از هر Origin غیرمجاز پیش از هر کاری رد می‌شود (نه فقط با هدر CORS)،
    ///     تا هیچ سایت دیگری که در مرورگر کیوسک باز شود نتواند پرداخت یا تنظیمات را دست بزند.
    ///   • اگر accessToken تنظیم شود، همهٔ مسیرها به‌جز /health آن را لازم دارند (مقایسهٔ زمان‌ثابت).
    ///   • بدنهٔ درخواست‌ها محدودیت حجم دارد و ورودی‌ها اعتبارسنجی می‌شوند.
    /// </summary>
    internal static class Program
    {
        private const int MaxBodyBytes = 512 * 1024;
        private const string Version = "2.0.0";

        private static Config _config;
        private static PosDevice _device;
        private static TransactionJournal _journal;
        private static string _baseDir;
        private static string _configPath;
        private static readonly object ConfigLock = new object();
        private static readonly CashierPin Cashier = new CashierPin();
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        // نگه‌داشتن در فیلد ایستا تا GC آن را آزاد نکند (یک نسخه از سرویس)
        private static Mutex _singleInstance;

        private static int Main(string[] args)
        {
            _baseDir = AppDomain.CurrentDomain.BaseDirectory;
            AppDomain.CurrentDomain.UnhandledException += (s, e) => LogCrash(e.ExceptionObject as Exception);

            if (Array.IndexOf(args, "--setup") >= 0) return RunSetup();

            bool firstInstance;
            _singleInstance = new Mutex(true, "Global\\MuseumPosBridge", out firstInstance);
            if (!firstInstance)
            {
                Console.WriteLine("PosBridge is already running.");
                return 2;
            }

            _configPath = Path.Combine(_baseDir, "appsettings.json");
            _config = Config.Load(_configPath);
            var journalPath = Path.IsPathRooted(_config.JournalPath)
                ? _config.JournalPath
                : Path.Combine(_baseDir, _config.JournalPath);
            _journal = new TransactionJournal(journalPath);
            _device = new PosDevice(_config, _journal);

            // درخواست‌های بلند (/pay تا چند دقیقه، /events دائمی) نباید بقیه را منتظر بگذارند
            ThreadPool.SetMinThreads(64, 64);

            var listener = new HttpListener();
            listener.Prefixes.Add(_config.ListenUrl);
            listener.Start();
            Console.WriteLine("POS bridge " + Version + " listening on " + _config.ListenUrl);
            Console.WriteLine("Device: " + (_config.IsLan ? _config.DeviceIp + ":" + _config.DevicePort : _config.ComPort) +
                              "  protocol=" + _config.EffectiveProtocol + "  response=" + _config.ResponseMode +
                              (_config.Simulate ? "  [SIMULATE]" : ""));
            PosLog.Info("startup", "سرویس پل نسخهٔ " + Version + " روی " + _config.ListenUrl + " بالا آمد — دفتر تراکنش‌ها: " + journalPath);
            if (string.IsNullOrEmpty(_config.AccessToken))
                PosLog.Warn("security", "accessToken تنظیم نشده است؛ برای امنیت کامل یک توکن تصادفی در appsettings.json بگذارید");

            while (true)
            {
                var ctx = listener.GetContext();
                new Thread(() => Handle(ctx)) { IsBackground = true }.Start();
            }
        }

        /// <summary>«PosBridge.exe --setup» از نصب‌کننده: توکن و رمز متصدی بدون پنل مدیریت</summary>
        private static int RunSetup()
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            var path = Path.Combine(_baseDir, "appsettings.json");
            try
            {
                if (File.Exists(path)) Json.DeserializeObject(File.ReadAllText(path));
            }
            catch (Exception ex)
            {
                // فایل خراب با مقادیر پیش‌فرض بازنویسی نشود (IP دستگاه و بقیه از دست می‌رود)
                Console.WriteLine("appsettings.json خوانده نشد؛ تنظیمات تغییر نکرد: " + ex.Message);
                return 1;
            }
            var config = Config.Load(path);
            var result = BridgeSetup.Run(config.AccessToken, config.CashierPinHash, Console.In, Console.Out,
                Console.IsInputRedirected ? (Func<string>)null : BridgeSetup.ReadMasked);
            if (!result.Changed) return 0;
            config.AccessToken = result.AccessToken;
            config.CashierPinHash = result.CashierPinHash;
            config.Save(path);
            return 0;
        }

        private static void LogCrash(Exception ex)
        {
            try
            {
                var dir = Path.Combine(_baseDir ?? ".", "logs");
                Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "crash.log"),
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + " " + ex + Environment.NewLine);
            }
            catch { /* ignore */ }
        }

        /* ------------------------------ امنیت ------------------------------ */

        /// <summary>
        /// Origin مجاز: بدون Origin (ابزارهای محلی مثل PowerShell)، فهرست allowedOrigins، یا
        /// صفحه‌های لوکال‌هاست (برنامهٔ دسکتاپ) اگر allowLoopbackOrigins روشن باشد.
        /// </summary>
        internal static bool IsOriginAllowed(string origin, Config config)
        {
            if (string.IsNullOrEmpty(origin)) return true;
            if (origin == "null") return false;
            var o = origin.Trim().TrimEnd('/');
            foreach (var allowed in config.AllowedOrigins)
                if (string.Equals(allowed, o, StringComparison.OrdinalIgnoreCase)) return true;

            Uri uri;
            if (config.AllowLoopbackOrigins && Uri.TryCreate(o, UriKind.Absolute, out uri) &&
                (uri.Scheme == "http" || uri.Scheme == "https") &&
                (uri.Host == "127.0.0.1" || uri.Host == "localhost" || uri.Host == "[::1]"))
                return true;
            return false;
        }

        private static bool IsAuthorized(HttpListenerContext ctx, string path)
        {
            if (string.IsNullOrEmpty(_config.AccessToken)) return true;
            var token = ctx.Request.Headers["X-Pos-Token"];
            // EventSource نمی‌تواند هدر بفرستد؛ فقط برای /events توکن در آدرس پذیرفته می‌شود
            if (string.IsNullOrEmpty(token) && path == "/events") token = ctx.Request.QueryString["token"];
            return SecureEquals(token, _config.AccessToken);
        }

        /// <summary>مقایسهٔ زمان‌ثابت (روی هش) تا از روی زمان پاسخ نتوان توکن را حدس زد</summary>
        internal static bool SecureEquals(string a, string b)
        {
            if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b)) return false;
            using (var sha = SHA256.Create())
            {
                var x = sha.ComputeHash(Encoding.UTF8.GetBytes(a));
                var y = sha.ComputeHash(Encoding.UTF8.GetBytes(b));
                var diff = 0;
                for (var i = 0; i < x.Length; i++) diff |= x[i] ^ y[i];
                return diff == 0;
            }
        }

        private static void Handle(HttpListenerContext ctx)
        {
            try
            {
                var origin = ctx.Request.Headers["Origin"];
                var originOk = IsOriginAllowed(origin, _config);
                AddHeaders(ctx, origin, originOk);
                if (!originOk)
                {
                    PosLog.Warn("security", "درخواست از مبدأ غیرمجاز " + origin + " رد شد");
                    WriteJson(ctx, 403, new Dictionary<string, object>
                    {
                        { "error", "origin_not_allowed" },
                        { "origin", origin },
                        { "message", "این آدرس اجازهٔ استفاده از کارت‌خوان را ندارد؛ آن را به allowedOrigins در appsettings.json اضافه کنید" }
                    });
                    return;
                }
                if (ctx.Request.HttpMethod == "OPTIONS") { Write(ctx, 204, ""); return; }

                var path = ctx.Request.Url.AbsolutePath.TrimEnd('/').ToLowerInvariant();
                var post = ctx.Request.HttpMethod == "POST";

                if (path != "/health" && !IsAuthorized(ctx, path))
                {
                    PosLog.Warn("auth", "درخواست بدون توکن معتبر به " + path + " رد شد");
                    WriteJson(ctx, 401, new Dictionary<string, object> { { "error", "unauthorized" }, { "message", "توکن دسترسی سرویس پل درست نیست" } });
                    return;
                }

                if (post && (path == "/pay" || path == "/config" || path == "/print" || path == "/cancel" ||
                             path == "/transactions/review" || path == "/cash/authorize" || path == "/cash/pin") &&
                    !(ctx.Request.ContentType ?? "").StartsWith("application/json", StringComparison.OrdinalIgnoreCase))
                {
                    WriteJson(ctx, 415, Fail("بدنهٔ درخواست باید JSON باشد"));
                    return;
                }

                var device = _device;
                switch (path)
                {
                    case "/health":
                        WriteJson(ctx, 200, new Dictionary<string, object>
                        {
                            { "status", "ok" },
                            { "version", Version },
                            { "terminalId", _config.TerminalId },
                            { "merchantId", _config.MerchantId },
                            { "simulate", _config.Simulate },
                            { "device", device.DeviceStatus() }
                        });
                        break;

                    case "/config":
                        HandleConfig(ctx, post);
                        break;

                    case "/printers":
                        WriteJson(ctx, 200, new Dictionary<string, object>
                        {
                            { "printers", Printer.ListPrinters() },
                            { "defaultPrinter", Printer.DefaultPrinter() },
                            { "selected", _config.PrinterName },
                            { "printEnabled", _config.PrintEnabled }
                        });
                        break;

                    case "/print":
                        {
                            if (!post) { WriteJson(ctx, 405, Fail("POST لازم است")); break; }
                            if (!_config.PrintEnabled) { WriteJson(ctx, 200, Fail("چاپ بلیط در تنظیمات غیرفعال است")); break; }
                            var req = ReadJson(ctx);
                            if (req == null) { WriteJson(ctx, 400, Fail("بدنهٔ درخواست نامعتبر است")); break; }
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
                            var port = ParseInt(ctx.Request.QueryString["port"], 0, 0, 65535);
                            var timeout = ParseInt(ctx.Request.QueryString["timeout"], 2500, 200, 10000);
                            WriteJson(ctx, 200, device.Ping(ip, port, timeout));
                            break;
                        }

                    case "/logs":
                        {
                            if (post) PosLog.Clear();
                            long after;
                            long.TryParse(ctx.Request.QueryString["after"], NumberStyles.Integer, CultureInfo.InvariantCulture, out after);
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
                            if (device.Busy) { WriteJson(ctx, 409, Fail("کارت‌خوان مشغول تراکنش است؛ جست‌وجو بعداً انجام شود")); break; }
                            var prefix = ctx.Request.QueryString["subnet"];
                            var prefixes = string.IsNullOrEmpty(prefix) || !IsSubnetPrefix(prefix)
                                ? LocalSubnetPrefixes()
                                : new List<string> { prefix };
                            var port = ParseInt(ctx.Request.QueryString["port"], _config.DevicePort, 1, 65535);
                            var serial = ctx.Request.QueryString["serial"];
                            if (string.IsNullOrEmpty(serial)) serial = _config.SerialNumber;

                            PosLog.Info("discover", "اسکن زیرشبکه‌های " + string.Join("، ", prefixes.ToArray()) + " روی پورت " + port);
                            var found = device.DiscoverDetailed(prefixes, port, 400, serial);
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
                            if (!post) { WriteJson(ctx, 405, Fail("POST لازم است")); break; }
                            var req = ReadJson(ctx);
                            if (req == null) { WriteJson(ctx, 400, Fail("بدنهٔ درخواست نامعتبر است")); break; }
                            long amountRial, amountToman;
                            if (!TryLong(Get(req, "amountRial"), out amountRial)) { WriteJson(ctx, 400, Fail("مبلغ نامعتبر است")); break; }
                            if (req.ContainsKey("amountToman") && (!TryLong(Get(req, "amountToman"), out amountToman) || amountToman * 10 != amountRial))
                            { WriteJson(ctx, 400, Fail("مبلغ ریالی و تومانی با هم نمی‌خوانند")); break; }

                            var outcome = device.Pay(Convert.ToString(Get(req, "transactionId")), amountRial,
                                Convert.ToString(Get(req, "invoiceNumber")));
                            WriteJson(ctx, outcome.Status, outcome.Body);
                            break;
                        }

                    case "/status":
                        {
                            var status = device.Status(ctx.Request.QueryString["id"]);
                            if (status == null) WriteJson(ctx, 404, Fail("تراکنشی با این شناسه پیدا نشد"));
                            else WriteJson(ctx, 200, status);
                            break;
                        }

                    case "/cancel":
                        {
                            if (!post) { WriteJson(ctx, 405, Fail("POST لازم است")); break; }
                            var req = ReadJson(ctx) ?? new Dictionary<string, object>();
                            var accepted = device.Cancel(Convert.ToString(Get(req, "transactionId")));
                            WriteJson(ctx, 200, new Dictionary<string, object>
                            {
                                { "accepted", accepted },
                                { "message", accepted
                                    ? "درخواست لغو ثبت شد؛ اگر کارت‌خوان هنوز منتظر کارت است، دکمهٔ قرمز (لغو) را روی دستگاه بزنید"
                                    : "تراکنش فعالی برای لغو نیست" }
                            });
                            break;
                        }

                    case "/transactions":
                        {
                            var limit = ParseInt(ctx.Request.QueryString["limit"], 50, 1, 200);
                            WriteJson(ctx, 200, new Dictionary<string, object>
                            {
                                { "items", device.Transactions(limit) },
                                { "needsReview", device.NeedsReviewCount() }
                            });
                            break;
                        }

                    case "/cash/status":
                        WriteJson(ctx, 200, new Dictionary<string, object>
                        {
                            { "pinConfigured", !string.IsNullOrEmpty(_config.CashierPinHash) },
                            { "lockedSeconds", Cashier.LockedSeconds() }
                        });
                        break;

                    case "/cash/authorize":
                        HandleCashAuthorize(ctx, post);
                        break;

                    case "/cash/pin":
                        HandleCashPin(ctx, post);
                        break;

                    case "/transactions/review":
                        {
                            var req = ReadJson(ctx);
                            var id = req == null ? null : Convert.ToString(Get(req, "transactionId"));
                            var note = req == null ? null : Convert.ToString(Get(req, "note"));
                            if (note != null && note.Length > 300) note = note.Substring(0, 300);
                            var ok = !string.IsNullOrEmpty(id) && device.MarkReviewed(id, note);
                            WriteJson(ctx, ok ? 200 : 404, new Dictionary<string, object> { { "ok", ok } });
                            break;
                        }

                    default:
                        WriteJson(ctx, 404, Fail("not found"));
                        break;
                }
            }
            catch (Exception ex)
            {
                PosLog.Error("http", ex.Message);
                try { WriteJson(ctx, 500, Fail("خطای داخلی سرویس پل")); } catch { /* ignore */ }
            }
        }

        /// <summary>
        /// تأیید پرداخت نقدی با رمز متصدی. فقط با رمز درست، فروش نقدی در دفتر ثبت و به کیوسک
        /// اجازهٔ صدور بلیط داده می‌شود؛ تلاش‌های نادرست شمرده و پس از ۵ بار قفل می‌شود.
        /// </summary>
        private static void HandleCashAuthorize(HttpListenerContext ctx, bool post)
        {
            if (!post) { WriteJson(ctx, 405, Fail("POST لازم است")); return; }
            var req = ReadJson(ctx);
            if (req == null) { WriteJson(ctx, 400, Fail("بدنهٔ درخواست نامعتبر است")); return; }

            long amountToman;
            var invoice = (Convert.ToString(Get(req, "invoiceNumber")) ?? "").Trim();
            if (!TryLong(Get(req, "amountToman"), out amountToman) || amountToman <= 0 || amountToman * 10 > _config.MaxAmountRial)
            { WriteJson(ctx, 400, Fail("مبلغ نامعتبر است")); return; }
            if (invoice.Length == 0 || invoice.Length > 64)
            { WriteJson(ctx, 400, Fail("شمارهٔ فاکتور نامعتبر است")); return; }

            var check = Cashier.Check(Convert.ToString(Get(req, "pin")), _config.CashierPinHash);
            if (check.Outcome != CashierPin.Outcome.Ok)
            {
                WriteJson(ctx, 200, CashFailure(check, "رمز متصدی نادرست است"));
                if (check.Outcome != CashierPin.Outcome.NotConfigured)
                    PosLog.Warn("cash", "رمز نادرست متصدی برای فاکتور " + invoice + (check.Outcome == CashierPin.Outcome.Locked ? " — ورود رمز قفل شد" : ""));
                return;
            }

            var now = PosTransaction.Now();
            var tx = new PosTransaction
            {
                Id = "cash-" + Guid.NewGuid().ToString("N"),
                InvoiceNumber = invoice,
                AmountRial = amountToman * 10,
                Status = "cash",
                Via = "cash",
                Message = "پرداخت نقدی با تأیید متصدی",
                CreatedAt = now,
                CompletedAt = now
            };
            _journal.Save(tx);
            PosLog.Info("cash", "پرداخت نقدی فاکتور " + invoice + " به مبلغ " + amountToman + " تومان با رمز متصدی تأیید شد");
            WriteJson(ctx, 200, new Dictionary<string, object>
            {
                { "ok", true }, { "authorizationId", tx.Id }, { "message", "پرداخت نقدی تأیید شد" }
            });
        }

        /// <summary>تنظیم، تغییر یا حذف رمز متصدی؛ اگر رمزی تنظیم شده باشد، رمز فعلی لازم است</summary>
        private static void HandleCashPin(HttpListenerContext ctx, bool post)
        {
            if (!post) { WriteJson(ctx, 405, Fail("POST لازم است")); return; }
            var req = ReadJson(ctx);
            if (req == null) { WriteJson(ctx, 400, Fail("بدنهٔ درخواست نامعتبر است")); return; }
            var next = (Convert.ToString(Get(req, "newPin")) ?? "").Trim();
            if (next.Length > 0 && !CashierPin.IsValidPin(next))
            { WriteJson(ctx, 400, Fail("رمز متصدی باید ۴ تا ۸ رقم باشد")); return; }

            lock (ConfigLock)
            {
                if (!string.IsNullOrEmpty(_config.CashierPinHash))
                {
                    var check = Cashier.Check(Convert.ToString(Get(req, "currentPin")), _config.CashierPinHash);
                    if (check.Outcome != CashierPin.Outcome.Ok)
                    {
                        WriteJson(ctx, 200, CashFailure(check, "رمز فعلی متصدی نادرست است"));
                        PosLog.Warn("cash", "تلاش برای تغییر رمز متصدی با رمز فعلی نادرست");
                        return;
                    }
                }
                else if (next.Length == 0)
                {
                    WriteJson(ctx, 400, Fail("رمز جدید را وارد کنید"));
                    return;
                }

                _config.CashierPinHash = next.Length == 0 ? "" : CashierPin.Hash(next);
                _config.Save(_configPath);
            }

            var enabled = next.Length > 0;
            PosLog.Info("cash", enabled ? "رمز متصدی تنظیم شد" : "رمز متصدی حذف شد؛ پرداخت نقدی غیرفعال است");
            WriteJson(ctx, 200, new Dictionary<string, object>
            {
                { "ok", true },
                { "pinConfigured", enabled },
                { "message", enabled ? "رمز متصدی ذخیره شد" : "رمز متصدی حذف شد؛ پرداخت نقدی غیرفعال شد" }
            });
        }

        private static Dictionary<string, object> CashFailure(CashierPin.CheckResult check, string wrongMessage)
        {
            switch (check.Outcome)
            {
                case CashierPin.Outcome.NotConfigured:
                    return new Dictionary<string, object>
                    {
                        { "ok", false }, { "code", "NOT_CONFIGURED" },
                        { "message", "رمز متصدی تنظیم نشده است؛ پرداخت نقدی از پنل مدیریت فعال می‌شود" }
                    };
                case CashierPin.Outcome.Locked:
                    return new Dictionary<string, object>
                    {
                        { "ok", false }, { "code", "LOCKED" }, { "retryAfterSeconds", check.RetryAfterSeconds },
                        { "message", "به‌دلیل تلاش‌های نادرست، ورود رمز تا " +
                            Math.Max(1, (check.RetryAfterSeconds + 59) / 60) + " دقیقه قفل است" }
                    };
                default:
                    return new Dictionary<string, object>
                    {
                        { "ok", false }, { "code", "WRONG_PIN" }, { "remainingAttempts", check.RemainingAttempts },
                        { "message", wrongMessage + " (" + check.RemainingAttempts + " تلاش دیگر)" }
                    };
            }
        }

        private static void HandleConfig(HttpListenerContext ctx, bool post)
        {
            if (post)
            {
                var req = ReadJson(ctx);
                if (req == null) { WriteJson(ctx, 400, Fail("بدنهٔ درخواست نامعتبر است")); return; }

                lock (ConfigLock)
                {
                    var ip = Convert.ToString(Get(req, "deviceIp"));
                    if (req.ContainsKey("deviceIp") && !string.IsNullOrEmpty(ip) && !Config.IsValidIp(ip.Trim()))
                    { WriteJson(ctx, 400, Fail("IP کارت‌خوان نامعتبر است")); return; }
                    int port;
                    if (req.ContainsKey("devicePort") && (!int.TryParse(Convert.ToString(Get(req, "devicePort")), out port) || port < 1 || port > 65535))
                    { WriteJson(ctx, 400, Fail("پورت کارت‌خوان نامعتبر است")); return; }

                    var next = Config.Load(_configPath);
                    // مقادیری که فقط از پنل مدیریت عوض می‌شوند؛ توکن و رمزها فقط از فایل
                    Action<string, Action<string>> str = (k, set) => { if (req.ContainsKey(k) && req[k] != null) set(Convert.ToString(req[k], CultureInfo.InvariantCulture).Trim()); };
                    Action<string, Action<int>> num = (k, set) => { int v; if (req.ContainsKey(k) && int.TryParse(Convert.ToString(req[k], CultureInfo.InvariantCulture), out v)) set(v); };
                    Action<string, Action<bool>> flag = (k, set) => { bool v; if (req.ContainsKey(k) && bool.TryParse(Convert.ToString(req[k], CultureInfo.InvariantCulture), out v)) set(v); };
                    str("connectionMode", v => next.ConnectionMode = v);
                    str("protocol", v => next.Protocol = v);
                    str("responseMode", v => next.ResponseMode = v);
                    str("deviceIp", v => { if (v.Length > 0) next.DeviceIp = v; });
                    num("devicePort", v => next.DevicePort = v);
                    num("callbackPort", v => next.CallbackPort = v);
                    num("timeoutSeconds", v => next.TimeoutSeconds = v);
                    str("merchantId", v => next.MerchantId = v);
                    str("terminalId", v => next.TerminalId = v);
                    str("serialNumber", v => next.SerialNumber = v);
                    str("comPort", v => next.ComPort = v);
                    str("networkInterface", v => next.NetworkInterface = v);
                    str("printerName", v => next.PrinterName = v);
                    str("printerFont", v => next.PrinterFont = v);
                    flag("printEnabled", v => next.PrintEnabled = v);
                    next.Normalize();

                    if (!_device.Retire())
                    {
                        WriteJson(ctx, 409, Fail("کارت‌خوان مشغول تراکنش است؛ پس از پایان آن دوباره ذخیره کنید"));
                        return;
                    }
                    next.Save(_configPath);
                    _config = next;
                    _device = new PosDevice(_config, _journal);
                    PosLog.Info("config", "تنظیمات تازه اعمال شد — " + _config.DeviceIp + ":" + _config.DevicePort +
                        " (" + _config.EffectiveProtocol + "/" + _config.ResponseMode + ")");
                }
            }

            var c = _config;
            WriteJson(ctx, 200, new Dictionary<string, object>
            {
                { "connectionMode", c.ConnectionMode },
                { "protocol", c.Protocol },
                { "responseMode", c.ResponseMode },
                { "deviceIp", c.DeviceIp },
                { "devicePort", c.DevicePort },
                { "callbackPort", c.CallbackPort },
                { "timeoutSeconds", c.TimeoutSeconds },
                { "merchantId", c.MerchantId },
                { "terminalId", c.TerminalId },
                { "serialNumber", c.SerialNumber },
                { "comPort", c.ComPort },
                { "networkInterface", c.NetworkInterface },
                { "printerName", c.PrinterName },
                { "printerFont", c.PrinterFont },
                { "printEnabled", c.PrintEnabled },
                { "tokenRequired", !string.IsNullOrEmpty(c.AccessToken) },
                { "simulate", c.Simulate }
            });
        }

        /// <summary>استریم زندهٔ لاگ و وضعیت (Server-Sent Events) برای صفحهٔ /admin/pos</summary>
        private static void StreamEvents(HttpListenerContext ctx)
        {
            ctx.Response.ContentType = "text/event-stream; charset=utf-8";
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

        private static void SendEvent(Stream stream, string name, object payload)
        {
            var text = "event: " + name + "\ndata: " + Json.Serialize(payload) + "\n\n";
            var bytes = Encoding.UTF8.GetBytes(text);
            stream.Write(bytes, 0, bytes.Length);
            stream.Flush();
        }

        private static bool IsSubnetPrefix(string prefix)
        {
            var parts = prefix.Split('.');
            if (parts.Length != 3) return false;
            foreach (var p in parts)
            {
                int n;
                if (!int.TryParse(p, out n) || n < 0 || n > 255) return false;
            }
            return true;
        }

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

            // زیرشبکهٔ شناخته‌شدهٔ وای‌فای موزه را هم پوشش می‌دهیم
            if (!list.Contains("192.168.16")) list.Add("192.168.16");
            return list;
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
            t.MaskedPan = PcPosProtocol.MaskPan(s("maskedPan"));
            t.TerminalId = string.IsNullOrEmpty(s("terminalId")) ? _config.TerminalId : s("terminalId");
            t.ResponseCode = s("responseCode");
            t.QrPngBase64 = s("qrPng");
            if (!string.IsNullOrEmpty(s("footer"))) t.Footer = s("footer");
            long total;
            if (TryLong(Get(req, "totalToman"), out total)) t.TotalToman = total;
            t.Copies = ParseInt(s("copies"), 1, 1, 3);

            if (req.ContainsKey("items"))
            {
                var arr = req["items"] as System.Collections.IEnumerable;
                if (arr != null)
                {
                    foreach (var raw in arr)
                    {
                        var row = raw as Dictionary<string, object>;
                        if (row == null) continue;
                        long lineTotal;
                        TryLong(Get(row, "totalToman"), out lineTotal);
                        t.Items.Add(new TicketLine
                        {
                            Name = row.ContainsKey("name") ? Convert.ToString(row["name"]) : "",
                            Quantity = ParseInt(Convert.ToString(Get(row, "quantity")), 1, 1, 1000),
                            TotalToman = lineTotal
                        });
                        if (t.Items.Count >= 100) break;
                    }
                }
            }
            return t;
        }

        /* ------------------------------ ابزار ------------------------------ */

        private static object Get(Dictionary<string, object> d, string key)
        {
            return d != null && d.ContainsKey(key) ? d[key] : null;
        }

        private static bool TryLong(object v, out long result)
        {
            result = 0;
            if (v == null) return false;
            if (v is int || v is long) { result = Convert.ToInt64(v); return true; }
            if (v is decimal || v is double)
            {
                var d = Convert.ToDecimal(v);
                if (d != decimal.Truncate(d)) return false;
                result = (long)d;
                return true;
            }
            return long.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out result);
        }

        private static int ParseInt(string raw, int fallback, int min, int max)
        {
            int v;
            if (!int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out v)) return fallback;
            return v < min ? min : (v > max ? max : v);
        }

        private static Dictionary<string, object> Fail(string message)
        {
            return new Dictionary<string, object> { { "success", false }, { "message", message } };
        }

        private static void AddHeaders(HttpListenerContext ctx, string origin, bool originOk)
        {
            var h = ctx.Response.Headers;
            h["Cache-Control"] = "no-store";
            h["X-Content-Type-Options"] = "nosniff";
            if (string.IsNullOrEmpty(origin) || !originOk) return;

            h["Access-Control-Allow-Origin"] = origin;
            h["Vary"] = "Origin";
            h["Access-Control-Allow-Headers"] = "Content-Type, X-Pos-Token";
            h["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
            h["Access-Control-Max-Age"] = "600";
            // اجازهٔ دسترسی صفحهٔ https منتشرشده به سرویس محلی (Private Network Access در Chrome)
            if (ctx.Request.Headers["Access-Control-Request-Private-Network"] == "true")
                h["Access-Control-Allow-Private-Network"] = "true";
        }

        private static Dictionary<string, object> ReadJson(HttpListenerContext ctx)
        {
            var body = ReadBody(ctx);
            if (body == null) return null;
            if (body.Trim().Length == 0) return new Dictionary<string, object>();
            try { return Json.Deserialize<Dictionary<string, object>>(body); }
            catch { return null; }
        }

        private static string ReadBody(HttpListenerContext ctx)
        {
            if (ctx.Request.ContentLength64 > MaxBodyBytes) return null;
            using (var reader = new StreamReader(ctx.Request.InputStream, Encoding.UTF8))
            {
                var buf = new char[MaxBodyBytes + 1];
                var total = 0;
                int n;
                while (total <= MaxBodyBytes && (n = reader.Read(buf, total, buf.Length - total)) > 0) total += n;
                return total > MaxBodyBytes ? null : new string(buf, 0, total);
            }
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
