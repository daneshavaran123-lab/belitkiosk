using System;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace PosBridge
{
    /// <summary>
    /// رمز متصدی برای تأیید پرداخت نقدی در کیوسک.
    ///
    /// رمز هرگز به مرورگر نمی‌رود و فقط به‌صورت هش PBKDF2 (با نمک تصادفی) در appsettings.json
    /// نگهداری می‌شود. بعد از چند تلاش نادرست، ورود رمز چند دقیقه قفل می‌شود تا نتوان رمز کوتاه را
    /// با امتحان کردن پیدا کرد.
    /// </summary>
    internal sealed class CashierPin
    {
        public const int MaxFailures = 5;
        public static readonly TimeSpan LockDuration = TimeSpan.FromMinutes(5);
        private const int Iterations = 100000;
        private static readonly Regex PinPattern = new Regex("^[0-9]{4,8}$");

        private readonly object _lock = new object();
        private readonly Func<DateTime> _now;
        private int _failures;
        private DateTime _lockedUntil = DateTime.MinValue;

        public CashierPin(Func<DateTime> now = null)
        {
            _now = now ?? (() => DateTime.UtcNow);
        }

        public static bool IsValidPin(string pin)
        {
            return pin != null && PinPattern.IsMatch(pin);
        }

        /// <summary>قالب: pbkdf2-sha256$تکرار$نمک$هش</summary>
        public static string Hash(string pin)
        {
            if (!IsValidPin(pin)) throw new ArgumentException("PIN must be 4-8 digits");
            var salt = new byte[16];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(salt);
            var hash = Derive(pin, salt, Iterations);
            return "pbkdf2-sha256$" + Iterations.ToString(CultureInfo.InvariantCulture) + "$" +
                   Convert.ToBase64String(salt) + "$" + Convert.ToBase64String(hash);
        }

        public static bool Matches(string pin, string stored)
        {
            if (string.IsNullOrEmpty(pin) || string.IsNullOrEmpty(stored)) return false;
            var parts = stored.Split('$');
            int iterations;
            if (parts.Length != 4 || parts[0] != "pbkdf2-sha256" ||
                !int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out iterations) ||
                iterations < 1000)
                return false;
            byte[] salt, expected;
            try
            {
                salt = Convert.FromBase64String(parts[2]);
                expected = Convert.FromBase64String(parts[3]);
            }
            catch (FormatException)
            {
                return false;
            }
            var actual = Derive(pin, salt, iterations);
            if (actual.Length != expected.Length) return false;
            var diff = 0;
            for (var i = 0; i < actual.Length; i++) diff |= actual[i] ^ expected[i];
            return diff == 0;
        }

        private static byte[] Derive(string pin, byte[] salt, int iterations)
        {
            using (var kdf = new Rfc2898DeriveBytes(pin, salt, iterations, HashAlgorithmName.SHA256))
                return kdf.GetBytes(32);
        }

        public enum Outcome { Ok, Wrong, Locked, NotConfigured }

        public sealed class CheckResult
        {
            public Outcome Outcome;
            public int RemainingAttempts;
            public int RetryAfterSeconds;
        }

        /// <summary>ثانیه‌های باقی‌مانده از قفل (۰ یعنی قفل نیست)</summary>
        public int LockedSeconds()
        {
            lock (_lock)
            {
                var left = _lockedUntil - _now();
                return left > TimeSpan.Zero ? (int)Math.Ceiling(left.TotalSeconds) : 0;
            }
        }

        /// <summary>بررسی رمز با شمارش تلاش‌های نادرست و قفل موقت</summary>
        public CheckResult Check(string pin, string storedHash)
        {
            lock (_lock)
            {
                if (string.IsNullOrEmpty(storedHash)) return new CheckResult { Outcome = Outcome.NotConfigured };

                var now = _now();
                if (now < _lockedUntil)
                    return new CheckResult
                    {
                        Outcome = Outcome.Locked,
                        RetryAfterSeconds = (int)Math.Ceiling((_lockedUntil - now).TotalSeconds)
                    };
                if (_lockedUntil != DateTime.MinValue)
                {
                    // قفل قبلی تمام شده؛ شمارش از نو
                    _lockedUntil = DateTime.MinValue;
                    _failures = 0;
                }

                if (IsValidPin(pin) && Matches(pin, storedHash))
                {
                    _failures = 0;
                    return new CheckResult { Outcome = Outcome.Ok, RemainingAttempts = MaxFailures };
                }

                _failures++;
                if (_failures >= MaxFailures)
                {
                    _lockedUntil = now + LockDuration;
                    return new CheckResult { Outcome = Outcome.Locked, RetryAfterSeconds = (int)LockDuration.TotalSeconds };
                }
                return new CheckResult { Outcome = Outcome.Wrong, RemainingAttempts = MaxFailures - _failures };
            }
        }
    }
}
