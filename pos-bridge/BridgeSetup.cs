using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace PosBridge
{
    /// <summary>
    /// راه‌اندازی اولیه از نصب‌کننده («PosBridge.exe --setup»)، بدون نیاز به پنل مدیریت:
    /// اگر accessToken خالی باشد یک توکن تصادفی می‌سازد (برنامهٔ ویندوزی آن را خودش از
    /// appsettings.json می‌خواند) و اگر رمز متصدی تنظیم نشده باشد، آن را (اختیاری) می‌پرسد.
    /// </summary>
    internal static class BridgeSetup
    {
        public const int PinAttempts = 3;

        public sealed class Result
        {
            public string AccessToken;
            public string CashierPinHash;
            public bool Changed;
        }

        /// <param name="readSecret">خواندن رمز بدون نمایش روی صفحه؛ null یعنی خواندن یک خط از input</param>
        public static Result Run(string accessToken, string cashierPinHash, TextReader input, TextWriter output,
            Func<string> readSecret = null)
        {
            var result = new Result { AccessToken = accessToken ?? "", CashierPinHash = cashierPinHash ?? "" };
            Func<string> read = readSecret ?? input.ReadLine;

            if (result.AccessToken.Length == 0)
            {
                result.AccessToken = NewToken();
                result.Changed = true;
                output.WriteLine("توکن دسترسی سرویس کارت‌خوان ساخته شد (برنامهٔ ویندوزی آن را خودکار استفاده می‌کند).");
            }

            if (result.CashierPinHash.Length == 0)
            {
                for (var attempt = 0; attempt < PinAttempts; attempt++)
                {
                    output.Write("رمز متصدی برای پرداخت نقدی (۴ تا ۸ رقم؛ Enter = بعداً): ");
                    var pin = (read() ?? "").Trim();
                    if (pin.Length == 0)
                    {
                        output.WriteLine("رمز متصدی گذاشته نشد؛ پرداخت نقدی تا تنظیم آن غیرفعال است.");
                        break;
                    }
                    if (!CashierPin.IsValidPin(pin))
                    {
                        output.WriteLine("رمز باید ۴ تا ۸ رقم باشد.");
                        continue;
                    }
                    output.Write("تکرار رمز متصدی: ");
                    if ((read() ?? "").Trim() != pin)
                    {
                        output.WriteLine("تکرار رمز مطابقت ندارد.");
                        continue;
                    }
                    result.CashierPinHash = CashierPin.Hash(pin);
                    result.Changed = true;
                    output.WriteLine("رمز متصدی ذخیره شد.");
                    break;
                }
            }
            return result;
        }

        /// <summary>۳۲ بایت تصادفی امن به‌صورت هگز</summary>
        public static string NewToken()
        {
            var bytes = new byte[32];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
            var sb = new StringBuilder(bytes.Length * 2);
            foreach (var b in bytes) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }

        /// <summary>خواندن رمز از کنسول با نمایش ستاره</summary>
        public static string ReadMasked()
        {
            var sb = new StringBuilder();
            while (true)
            {
                var key = Console.ReadKey(true);
                if (key.Key == ConsoleKey.Enter) break;
                if (key.Key == ConsoleKey.Backspace)
                {
                    if (sb.Length > 0)
                    {
                        sb.Length--;
                        Console.Write("\b \b");
                    }
                    continue;
                }
                if (!char.IsControl(key.KeyChar))
                {
                    sb.Append(key.KeyChar);
                    Console.Write('*');
                }
            }
            Console.WriteLine();
            return sb.ToString();
        }
    }
}
