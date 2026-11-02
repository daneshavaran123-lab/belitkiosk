using System.IO;
using System.Text.RegularExpressions;
using Xunit;

namespace PosBridge.Tests
{
    public class BridgeSetupTests
    {
        private static BridgeSetup.Result Run(string token, string pinHash, string input, out string output)
        {
            var writer = new StringWriter();
            var result = BridgeSetup.Run(token, pinHash, new StringReader(input), writer);
            output = writer.ToString();
            return result;
        }

        [Fact]
        public void CreatesRandomTokenWhenMissing()
        {
            string output;
            var a = Run("", "", "\n", out output);
            var b = Run(null, "", "\n", out output);
            Assert.Matches(new Regex("^[0-9a-f]{64}$"), a.AccessToken);
            Assert.NotEqual(a.AccessToken, b.AccessToken);
            Assert.True(a.Changed);
            Assert.Equal("", a.CashierPinHash); // Enter = بدون رمز متصدی
        }

        [Fact]
        public void KeepsExistingTokenAndPin()
        {
            var hash = CashierPin.Hash("4821");
            string output;
            var r = Run("existing-token", hash, "9999\n9999\n", out output);
            Assert.Equal("existing-token", r.AccessToken);
            Assert.Equal(hash, r.CashierPinHash);
            Assert.False(r.Changed);
            Assert.Equal("", output); // چیزی پرسیده نمی‌شود
        }

        [Fact]
        public void SetsCashierPinAfterConfirmation()
        {
            string output;
            var r = Run("t", "", "4821\n4821\n", out output);
            Assert.True(r.Changed);
            Assert.True(CashierPin.Matches("4821", r.CashierPinHash));
            Assert.DoesNotContain("4821", output);
        }

        [Fact]
        public void RetriesInvalidOrMismatchedPin()
        {
            string output;
            var r = Run("t", "", "12\n4821\n4822\n7350\n7350\n", out output);
            Assert.True(CashierPin.Matches("7350", r.CashierPinHash));
        }

        [Fact]
        public void GivesUpAfterThreeBadAttempts()
        {
            string output;
            var r = Run("t", "", "1\n2\n3\n4821\n4821\n", out output);
            Assert.Equal("", r.CashierPinHash);
            Assert.False(r.Changed);
        }

        [Fact]
        public void EndOfInputSkipsPin()
        {
            string output;
            var r = Run("t", "", "", out output);
            Assert.Equal("", r.CashierPinHash);
            Assert.False(r.Changed);
        }
    }
}
