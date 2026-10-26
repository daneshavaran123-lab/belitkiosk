using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace PosBridge
{
    /// <summary>
    /// پروتکل متنی PC-POS روی LAN — دقیقاً همان قالبی که کتابخانهٔ رسمی PosInterface.dll می‌سازد
    /// (با اجرای خود DLL و ضبط بایت‌های ارسالی و خواندن پارسر پاسخ آن تطبیق داده شده است).
    ///
    /// درخواست خرید (کیوسک ← دستگاه):
    ///   $PCBUY,{مبلغ ریال},{شمارهٔ فاکتور},{yyyyMMddHHmmss},{MessageId},{تعداد تسهیم},{pcposAppId},*{XOR}\r\n
    ///   — توجه: بعد از آخرین فیلد یک «,» اضافه می‌آید و در چک‌سام حساب می‌شود.
    ///
    /// پاسخ (دستگاه ← کیوسک):
    ///   $POSBUY,{کد پاسخ},{مبلغ},{RRN},{STAN},{تاریخ},{پذیرنده},{پایانه},{شمارهٔ کارت},{MessageId},*{XOR}\r\n
    ///   کد ۰ یعنی تراکنش موفق؛ بقیهٔ کدها در <see cref="ErrorMessage"/> آمده‌اند.
    ///
    /// چک‌سام = XOR همهٔ بایت‌های بین «$» و «*» به‌صورت دو رقم هگز بزرگ.
    /// </summary>
    internal static class PcPosProtocol
    {
        /// <summary>بیشترین طول یک فریم؛ کتابخانهٔ رسمی هم بافر ۱۰۰۰ بایتی دارد</summary>
        public const int MaxFrameBytes = 1024;

        /// <summary>بیشترین MessageId — کتابخانهٔ رسمی آن را int می‌داند</summary>
        public const long MaxMessageId = 999999999;

        /// <summary>
        /// بدنهٔ درخواست خرید (بدون «$»، چک‌سام و CRLF). همهٔ ورودی‌ها باید از قبل
        /// اعتبارسنجی شده باشند؛ در غیر این صورت ArgumentException پرتاب می‌شود.
        /// </summary>
        public static string BuildPurchaseBody(long amountRial, string posInvoice, DateTime date, long messageId, string appId)
        {
            if (amountRial <= 0) throw new ArgumentException("amount must be positive");
            if (messageId <= 0 || messageId > MaxMessageId) throw new ArgumentException("messageId out of range");
            if (!IsDigits(posInvoice)) throw new ArgumentException("invoice must be digits");
            if (!IsSafeField(appId ?? "")) throw new ArgumentException("appId contains reserved characters");

            // تاریخ همیشه میلادی و با فرهنگ ثابت؛ روی ویندوز فارسی ToString معمولی سال شمسی می‌دهد
            return "PCBUY," +
                   amountRial.ToString(CultureInfo.InvariantCulture) + "," +
                   posInvoice + "," +
                   date.ToString("yyyyMMddHHmmss", CultureInfo.InvariantCulture) + "," +
                   messageId.ToString(CultureInfo.InvariantCulture) + "," +
                   "0," +              // تعداد تسهیم (بدون تسهیم)
                   (appId ?? "") + ",";
        }

        /// <summary>قاب کامل: $body*CS\r\n به‌صورت ASCII</summary>
        public static byte[] Frame(string body)
        {
            return Encoding.ASCII.GetBytes("$" + body + "*" + Checksum(body) + "\r\n");
        }

        public static string Checksum(string body)
        {
            byte x = 0;
            foreach (var b in Encoding.ASCII.GetBytes(body ?? "")) x ^= b;
            return x.ToString("X2", CultureInfo.InvariantCulture);
        }

        public static bool IsDigits(string s)
        {
            if (string.IsNullOrEmpty(s)) return false;
            foreach (var c in s) if (c < '0' || c > '9') return false;
            return true;
        }

        /// <summary>فیلد نباید جداکننده‌ها یا کاراکتر غیر ASCII داشته باشد</summary>
        public static bool IsSafeField(string s)
        {
            foreach (var c in s)
                if (c < 0x20 || c > 0x7E || c == ',' || c == '$' || c == '*') return false;
            return true;
        }

        /// <summary>
        /// شمارهٔ فاکتور مخصوص دستگاه: فقط رقم و حداکثر maxDigits رقم آخر.
        /// شمارهٔ فاکتور کیوسک (مثل INV-20261026-123456) حروف و خط تیره دارد که دستگاه نمی‌پذیرد.
        /// </summary>
        public static string ToPosInvoice(string invoiceNumber, int maxDigits)
        {
            var sb = new StringBuilder();
            foreach (var c in invoiceNumber ?? "") if (c >= '0' && c <= '9') sb.Append(c);
            var digits = sb.ToString();
            if (digits.Length == 0) digits = DateTime.Now.ToString("yyMMddHHmmss", CultureInfo.InvariantCulture);
            if (maxDigits > 0 && digits.Length > maxDigits) digits = digits.Substring(digits.Length - maxDigits);
            return digits;
        }

        /// <summary>
        /// شمارهٔ کارت را برای ذخیره و نمایش ماسک می‌کند: فقط ۶ رقم اول و ۴ رقم آخر.
        /// اگر دستگاه شماره را از قبل ماسک کرده باشد، همان شکل (با * به‌جای کاراکترهای ماسک) نگه داشته می‌شود.
        /// </summary>
        public static string MaskPan(string pan)
        {
            if (string.IsNullOrEmpty(pan)) return "";
            var trimmed = pan.Trim();
            var digitsOnly = true;
            foreach (var c in trimmed) if (c < '0' || c > '9') { digitsOnly = false; break; }

            if (digitsOnly)
            {
                if (trimmed.Length < 10) return new string('*', trimmed.Length);
                return trimmed.Substring(0, 6) + new string('*', trimmed.Length - 10) + trimmed.Substring(trimmed.Length - 4);
            }

            var sb = new StringBuilder();
            foreach (var c in trimmed)
            {
                if (sb.Length >= 24) break;
                sb.Append(c >= '0' && c <= '9' ? c : (c == '-' || c == ' ' ? c : '*'));
            }
            // اطمینان از اینکه هرگز بیش از ۱۰ رقم واقعی از کارت باقی نماند
            var digitCount = 0;
            foreach (var c in sb.ToString()) if (c >= '0' && c <= '9') digitCount++;
            return digitCount > 10 ? MaskPan(Digits(trimmed)) : sb.ToString();
        }

        private static string Digits(string s)
        {
            var sb = new StringBuilder();
            foreach (var c in s) if (c >= '0' && c <= '9') sb.Append(c);
            return sb.ToString();
        }

        /// <summary>
        /// تجزیه و اعتبارسنجی یک فریم پاسخ. چک‌سام با آخرین «*» پیدا می‌شود تا ستاره‌های
        /// احتمالی داخل شمارهٔ کارت ماسک‌شده مشکلی ایجاد نکنند.
        /// </summary>
        public static PosBuyResponse Parse(string frame)
        {
            var r = new PosBuyResponse { Raw = frame ?? "" };
            var text = (frame ?? "").Trim('\r', '\n', ' ', '\0');

            if (!text.StartsWith("$")) { r.FormatError = "فریم با $ شروع نشده است"; return r; }
            var star = text.LastIndexOf('*');
            if (star < 2 || text.Length - star - 1 != 2) { r.FormatError = "چک‌سام فریم پیدا نشد"; return r; }

            var body = text.Substring(1, star - 1);
            var received = text.Substring(star + 1);
            if (!string.Equals(Checksum(body), received, StringComparison.OrdinalIgnoreCase))
            {
                r.FormatError = "چک‌سام نادرست است (دریافتی " + received + "، محاسبه‌شده " + Checksum(body) + ")";
                return r;
            }
            r.ChecksumValid = true;

            var f = body.Split(',');
            r.Type = f[0].Trim();
            if (f.Length < 2) { r.FormatError = "فیلد کد پاسخ وجود ندارد"; return r; }

            int code;
            if (!int.TryParse(f[1].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out code))
            {
                r.FormatError = "کد پاسخ عددی نیست: " + f[1];
                return r;
            }
            r.Code = code;
            r.Amount = Field(f, 2);
            r.Rrn = Field(f, 3);
            r.Stan = Field(f, 4);
            r.DateTime = Field(f, 5);
            r.MerchantId = Field(f, 6);
            r.TerminalId = Field(f, 7);
            r.CardNumber = Field(f, 8);
            r.MessageId = Field(f, 9);
            return r;
        }

        private static string Field(string[] f, int i)
        {
            return f.Length > i ? f[i].Trim() : "";
        }

        /// <summary>جدول کدهای پاسخ — برگرفته از خود کتابخانهٔ رسمی PosInterface.dll</summary>
        public static string ErrorMessage(int code)
        {
            string m;
            return Messages.TryGetValue(code, out m) ? m : "تراکنش ناموفق (کد " + code + ")";
        }

        private static readonly Dictionary<int, string> Messages = new Dictionary<int, string>
        {
            { 0, "تراکنش موفق" },
            { 3, "پذیرندهٔ فروشگاهی نامعتبر" },
            { 5, "از انجام تراکنش صرف‌نظر شد" },
            { 6, "بروز خطا" },
            { 12, "تراکنش نامعتبر" },
            { 51, "موجودی کافی نیست" },
            { 55, "رمز کارت نامعتبر است" },
            { 56, "کارت نامعتبر است" },
            { 61, "مبلغ تراکنش بیش از حد مجاز است" },
            { 84, "بانک صادرکنندهٔ کارت پاسخ نمی‌دهد" },
            { 400, "کارت‌خوان پاسخی از سوئیچ دریافت نکرد" },
            { 402, "ارتباط کارت‌خوان با سوئیچ برقرار نیست" },
            { 403, "ارسال کارت‌خوان ناموفق بود" },
            { 410, "چاپ رسید کارت‌خوان ناموفق بود" },
            { 412, "کارت‌خوان درخواست را نتوانست بخواند" },
            { 501, "پیش‌نیازهای کارت‌خوان انجام نشده (ورود، تسویه یا برگشت)" },
            { 502, "تراکنش توسط کاربر لغو شد" },
            { 777, "زمان انتظار به پایان رسید" },
        };
    }

    /// <summary>پاسخ تجزیه‌شدهٔ دستگاه</summary>
    internal sealed class PosBuyResponse
    {
        public string Raw = "";
        public bool ChecksumValid;
        /// <summary>اگر خالی نباشد فریم قابل اعتماد نیست</summary>
        public string FormatError;
        public string Type = "";
        public int Code = -1;
        public string Amount = "";
        public string Rrn = "";
        public string Stan = "";
        public string DateTime = "";
        public string MerchantId = "";
        public string TerminalId = "";
        public string CardNumber = "";
        public string MessageId = "";

        public bool IsValid { get { return ChecksumValid && FormatError == null; } }
    }

    /// <summary>
    /// جداکنندهٔ فریم از جریان TCP: بایت‌ها تکه‌تکه می‌رسند و ممکن است یک فریم در چند
    /// Read یا چند فریم در یک Read باشد.
    /// </summary>
    internal sealed class FrameReader
    {
        private readonly List<byte> _buf = new List<byte>();

        /// <summary>بیش از MaxFrameBytes بدون پایان خط رسیده است (دادهٔ نامعتبر)</summary>
        public bool Overflow { get; private set; }

        public void Append(byte[] data, int count)
        {
            for (var i = 0; i < count; i++) _buf.Add(data[i]);
        }

        /// <summary>اولین فریم کامل («$ ... \n») را برمی‌دارد؛ زبالهٔ قبل از «$» دور ریخته می‌شود</summary>
        public bool TryTake(out string frame)
        {
            frame = null;
            var start = _buf.IndexOf((byte)'$');
            if (start < 0)
            {
                _buf.Clear();
                return false;
            }
            if (start > 0) _buf.RemoveRange(0, start);

            var end = _buf.IndexOf((byte)'\n');
            if (end < 0)
            {
                if (_buf.Count > PcPosProtocol.MaxFrameBytes) { Overflow = true; _buf.Clear(); }
                return false;
            }

            frame = Encoding.ASCII.GetString(_buf.GetRange(0, end + 1).ToArray());
            _buf.RemoveRange(0, end + 1);
            return true;
        }

        /// <summary>وقتی اتصال بسته شد: فریمی که CRLF ندارد ولی با چک‌سام تمام شده</summary>
        public bool TryTakeUnterminated(out string frame)
        {
            frame = null;
            var start = _buf.IndexOf((byte)'$');
            if (start < 0) return false;
            var text = Encoding.ASCII.GetString(_buf.GetRange(start, _buf.Count - start).ToArray()).TrimEnd('\r', '\n', ' ', '\0');
            _buf.Clear();
            var star = text.LastIndexOf('*');
            if (star < 2 || text.Length - star - 1 != 2) return false;
            frame = text;
            return true;
        }
    }
}
