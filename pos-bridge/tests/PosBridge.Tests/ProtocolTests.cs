using System;
using System.Globalization;
using System.Text;
using System.Threading;
using Xunit;

namespace PosBridge.Tests
{
    public class ProtocolTests
    {
        // بایت‌هایی که خود PosInterface.dll برای DoASyncPayment("10000", "", "12345", 2026-10-26 12:00:00)
        // با MessageId=1 روی سوکت فرستاد (ضبط‌شده از اجرای واقعی کتابخانه)
        private const string SdkCapturedRequest = "$PCBUY,10000,12345,20261026120000,1,0,,*70\r\n";

        // پاسخی که پارسر خود کتابخانه پذیرفت و به ErrorCode=0, RRN=123456789012 تبدیل کرد
        private const string SdkAcceptedResponse =
            "$POSBUY,0,10000,123456789012,654321,20261026120005,6618774,5634056,603799XXXXXX1234,1,*3E\r\n";

        [Fact]
        public void PurchaseFrameMatchesOfficialSdkBytes()
        {
            var body = PcPosProtocol.BuildPurchaseBody(10000, "12345", new DateTime(2026, 10, 26, 12, 0, 0), 1, "");
            Assert.Equal("PCBUY,10000,12345,20261026120000,1,0,,", body);
            Assert.Equal(SdkCapturedRequest, Encoding.ASCII.GetString(PcPosProtocol.Frame(body)));
        }

        [Fact]
        public void DateIsGregorianEvenOnPersianWindows()
        {
            var previous = Thread.CurrentThread.CurrentCulture;
            try
            {
                CultureInfo fa;
                try { fa = new CultureInfo("fa-IR"); }
                catch (CultureNotFoundException) { return; } // محیط بدون ICU
                Thread.CurrentThread.CurrentCulture = fa;
                var body = PcPosProtocol.BuildPurchaseBody(5000, "1", new DateTime(2026, 10, 26, 9, 5, 7), 7, "");
                Assert.Contains(",20261026090507,", body);
            }
            finally
            {
                Thread.CurrentThread.CurrentCulture = previous;
            }
        }

        [Theory]
        [InlineData(0, "1", 1, "")]
        [InlineData(10000, "12a45", 1, "")]
        [InlineData(10000, "", 1, "")]
        [InlineData(10000, "123", 0, "")]
        [InlineData(10000, "123", 1000000000, "")]
        [InlineData(10000, "123", 1, "a,b")]
        [InlineData(10000, "123", 1, "x*y")]
        public void RejectsUnsafeRequestFields(long amount, string invoice, long messageId, string appId)
        {
            Assert.Throws<ArgumentException>(() =>
                PcPosProtocol.BuildPurchaseBody(amount, invoice, DateTime.Now, messageId, appId));
        }

        [Fact]
        public void ParsesResponseAcceptedBySdk()
        {
            var r = PcPosProtocol.Parse(SdkAcceptedResponse);
            Assert.True(r.IsValid);
            Assert.Equal("POSBUY", r.Type);
            Assert.Equal(0, r.Code);
            Assert.Equal("10000", r.Amount);
            Assert.Equal("123456789012", r.Rrn);
            Assert.Equal("654321", r.Stan);
            Assert.Equal("20261026120005", r.DateTime);
            Assert.Equal("6618774", r.MerchantId);
            Assert.Equal("5634056", r.TerminalId);
            Assert.Equal("603799XXXXXX1234", r.CardNumber);
            Assert.Equal("1", r.MessageId);
        }

        [Fact]
        public void ParsesResponseWithoutTrailingComma()
        {
            var r = PcPosProtocol.Parse("$POSBUY,51,10000,,654322,20261026120005,6618774,5634056,603799XXXXXX1234,1*27\r\n");
            Assert.True(r.IsValid);
            Assert.Equal(51, r.Code);
            Assert.Equal("1", r.MessageId);
            Assert.Equal("موجودی کافی نیست", PcPosProtocol.ErrorMessage(r.Code));
        }

        [Fact]
        public void ChecksumUsesLastStarSoMaskedPanWithStarsStillParses()
        {
            const string body = "POSBUY,0,10000,123456789012,654321,20261026120005,6618774,5634056,603799******1234,9,";
            var r = PcPosProtocol.Parse("$" + body + "*" + PcPosProtocol.Checksum(body) + "\r\n");
            Assert.True(r.IsValid);
            Assert.Equal("603799******1234", r.CardNumber);
            Assert.Equal("9", r.MessageId);
        }

        [Fact]
        public void AcceptsLowercaseChecksum()
        {
            Assert.True(PcPosProtocol.Parse(SdkAcceptedResponse.Replace("*3E", "*3e")).IsValid);
        }

        [Theory]
        [InlineData("$POSBUY,0,10000,123456789012,654321,20261026120005,6618774,5634056,603799XXXXXX1234,1,*3F\r\n")]
        [InlineData("POSBUY,0,10000,123456789012,654321,20261026120005,6618774,5634056,603799XXXXXX1234,1,*3E\r\n")]
        [InlineData("$POSBUY,0,10000,123456789012,654321,20261026120005,6618774,5634056,603799XXXXXX1234,1,\r\n")]
        [InlineData("$POSBUY,OK,10000*4A\r\n")]
        [InlineData("")]
        public void RejectsInvalidFrames(string frame)
        {
            Assert.False(PcPosProtocol.Parse(frame).IsValid);
        }

        [Fact]
        public void FrameReaderHandlesSplitGarbageAndMultipleFrames()
        {
            var reader = new FrameReader();
            var bytes = Encoding.ASCII.GetBytes("\0\0noise" + SdkAcceptedResponse + SdkAcceptedResponse);
            string frame;
            for (var i = 0; i < bytes.Length; i += 5)
            {
                var chunk = new byte[Math.Min(5, bytes.Length - i)];
                Array.Copy(bytes, i, chunk, 0, chunk.Length);
                reader.Append(chunk, chunk.Length);
            }
            Assert.True(reader.TryTake(out frame));
            Assert.Equal(SdkAcceptedResponse, frame);
            Assert.True(reader.TryTake(out frame));
            Assert.Equal(SdkAcceptedResponse, frame);
            Assert.False(reader.TryTake(out frame));
        }

        [Fact]
        public void FrameReaderTakesUnterminatedFrameOnClose()
        {
            var reader = new FrameReader();
            var bytes = Encoding.ASCII.GetBytes(SdkAcceptedResponse.TrimEnd('\r', '\n'));
            reader.Append(bytes, bytes.Length);
            string frame;
            Assert.False(reader.TryTake(out frame));
            Assert.True(reader.TryTakeUnterminated(out frame));
            Assert.True(PcPosProtocol.Parse(frame).IsValid);
        }

        [Fact]
        public void FrameReaderFlagsOverflow()
        {
            var reader = new FrameReader();
            var junk = Encoding.ASCII.GetBytes("$" + new string('9', PcPosProtocol.MaxFrameBytes + 10));
            reader.Append(junk, junk.Length);
            string frame;
            Assert.False(reader.TryTake(out frame));
            Assert.True(reader.Overflow);
        }

        [Theory]
        [InlineData("6037991234561234", "603799******1234")]
        [InlineData("603799XXXXXX1234", "603799******1234")]
        [InlineData("6037-99**-****-1234", "6037-99**-****-1234")]
        [InlineData("12345", "*****")]
        [InlineData("", "")]
        public void MasksCardNumbers(string pan, string expected)
        {
            Assert.Equal(expected, PcPosProtocol.MaskPan(pan));
        }

        [Fact]
        public void MaskNeverKeepsMoreThanTenDigits()
        {
            var masked = PcPosProtocol.MaskPan("6037-9912-3456-1234");
            var digits = 0;
            foreach (var c in masked) if (char.IsDigit(c)) digits++;
            Assert.True(digits <= 10, masked);
        }

        [Theory]
        [InlineData("INV-20261026-123456", 12, "261026123456")]
        [InlineData("INV-1", 12, "1")]
        [InlineData("12345", 3, "345")]
        public void PosInvoiceIsDigitsOnly(string invoice, int max, string expected)
        {
            Assert.Equal(expected, PcPosProtocol.ToPosInvoice(invoice, max));
        }

        [Fact]
        public void EmptyInvoiceStillProducesDigits()
        {
            Assert.True(PcPosProtocol.IsDigits(PcPosProtocol.ToPosInvoice("", 12)));
        }
    }
}
