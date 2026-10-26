using System;
using Xunit;

namespace PosBridge.Tests
{
    public class CashierPinTests
    {
        [Fact]
        public void HashIsSaltedAndVerifies()
        {
            var a = CashierPin.Hash("4821");
            var b = CashierPin.Hash("4821");
            Assert.StartsWith("pbkdf2-sha256$100000$", a);
            Assert.NotEqual(a, b); // نمک تصادفی
            Assert.DoesNotContain("4821", a);
            Assert.True(CashierPin.Matches("4821", a));
            Assert.True(CashierPin.Matches("4821", b));
            Assert.False(CashierPin.Matches("4822", a));
            Assert.False(CashierPin.Matches("", a));
        }

        [Theory]
        [InlineData("123")]
        [InlineData("123456789")]
        [InlineData("12a4")]
        [InlineData("")]
        [InlineData(null)]
        public void RejectsInvalidPins(string pin)
        {
            Assert.False(CashierPin.IsValidPin(pin));
        }

        [Theory]
        [InlineData("")]
        [InlineData("plain-text")]
        [InlineData("pbkdf2-sha256$10$AAAA$AAAA")]
        [InlineData("pbkdf2-sha256$100000$not-base64$AAAA")]
        public void MalformedStoredHashNeverMatches(string stored)
        {
            Assert.False(CashierPin.Matches("1234", stored));
        }

        [Fact]
        public void NotConfiguredWhenNoHash()
        {
            Assert.Equal(CashierPin.Outcome.NotConfigured, new CashierPin().Check("1234", "").Outcome);
        }

        [Fact]
        public void LocksAfterFiveWrongAttemptsThenUnlocksAfterFiveMinutes()
        {
            var now = new DateTime(2026, 10, 26, 10, 0, 0, DateTimeKind.Utc);
            var guard = new CashierPin(() => now);
            var hash = CashierPin.Hash("4821");

            for (var i = 1; i < CashierPin.MaxFailures; i++)
            {
                var r = guard.Check("0000", hash);
                Assert.Equal(CashierPin.Outcome.Wrong, r.Outcome);
                Assert.Equal(CashierPin.MaxFailures - i, r.RemainingAttempts);
            }
            Assert.Equal(CashierPin.Outcome.Locked, guard.Check("0000", hash).Outcome);

            // حتی رمز درست هم تا پایان قفل پذیرفته نمی‌شود
            now = now.AddMinutes(4);
            var locked = guard.Check("4821", hash);
            Assert.Equal(CashierPin.Outcome.Locked, locked.Outcome);
            Assert.InRange(locked.RetryAfterSeconds, 1, 60);
            Assert.True(guard.LockedSeconds() > 0);

            now = now.AddMinutes(1).AddSeconds(1);
            Assert.Equal(0, guard.LockedSeconds());
            Assert.Equal(CashierPin.Outcome.Ok, guard.Check("4821", hash).Outcome);
        }

        [Fact]
        public void CorrectPinResetsFailureCount()
        {
            var guard = new CashierPin();
            var hash = CashierPin.Hash("4821");
            guard.Check("0000", hash);
            guard.Check("0000", hash);
            Assert.Equal(CashierPin.Outcome.Ok, guard.Check("4821", hash).Outcome);
            Assert.Equal(CashierPin.MaxFailures - 1, guard.Check("0000", hash).RemainingAttempts);
        }
    }
}
