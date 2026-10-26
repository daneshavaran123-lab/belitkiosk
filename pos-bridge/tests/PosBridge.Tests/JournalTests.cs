using System;
using System.IO;
using Xunit;

namespace PosBridge.Tests
{
    public class JournalTests : IDisposable
    {
        private readonly string _path = Path.Combine(Path.GetTempPath(), "posbridge-test-" + Guid.NewGuid().ToString("N"), "tx.jsonl");

        public void Dispose()
        {
            try { Directory.Delete(Path.GetDirectoryName(_path), true); }
            catch { /* ignore */ }
        }

        private static PosTransaction Tx(string id, long amount = 50000)
        {
            return new PosTransaction { Id = id, MessageId = 10, AmountRial = amount, PosInvoice = "1", Status = "pending" };
        }

        private static PosBuyResponse Approval(string amount = "50000", string rrn = "123456789012", string terminal = "5634056")
        {
            return new PosBuyResponse
            {
                ChecksumValid = true, Type = "POSBUY", Code = 0, Amount = amount, Rrn = rrn,
                TerminalId = terminal, CardNumber = "6037991234561234", MessageId = "10"
            };
        }

        [Fact]
        public void PersistsAndReloadsWithPersianText()
        {
            var j = new TransactionJournal(_path);
            var t = Tx("a");
            t.Status = "declined";
            t.Message = "موجودی کافی نیست \"quoted\"\nline";
            j.Save(t);

            var reloaded = new TransactionJournal(_path).Get("a");
            Assert.Equal("declined", reloaded.Status);
            Assert.Equal(t.Message, reloaded.Message);
            Assert.Equal(50000, reloaded.AmountRial);
        }

        [Fact]
        public void MarksInterruptedTransactionsOnRestart()
        {
            var j = new TransactionJournal(_path);
            var pending = Tx("not-sent");
            j.Save(pending);
            var sent = Tx("sent");
            sent.Status = "sent";
            j.Save(sent);

            var reloaded = new TransactionJournal(_path);
            Assert.Equal("failed", reloaded.Get("not-sent").Status);
            Assert.False(reloaded.Get("not-sent").NeedsReview);
            Assert.Equal("uncertain", reloaded.Get("sent").Status);
            Assert.True(reloaded.Get("sent").NeedsReview);
        }

        [Fact]
        public void IgnoresTruncatedLastLine()
        {
            var j = new TransactionJournal(_path);
            j.Save(Tx("ok"));
            File.AppendAllText(_path, "{\"id\":\"broken\",\"stat");
            var reloaded = new TransactionJournal(_path);
            Assert.NotNull(reloaded.Get("ok"));
            Assert.Null(reloaded.Get("broken"));
        }

        [Fact]
        public void MessageIdsAreUniqueAcrossRestartsAndStayInIntRange()
        {
            var j = new TransactionJournal(_path);
            var a = j.NextMessageId();
            var t = Tx("x");
            t.MessageId = a;
            j.Save(t);
            var b = new TransactionJournal(_path).NextMessageId();
            Assert.True(b > a);
            Assert.InRange(b, 1, PcPosProtocol.MaxMessageId);
        }

        [Fact]
        public void ApprovesOnlyWhenEverythingMatches()
        {
            var j = new TransactionJournal(_path);
            var t = Tx("good");
            PaymentRules.Apply(t, Approval(), "5634056", true, j);
            Assert.Equal("approved", t.Status);
            Assert.True(t.IsSuccess);
            Assert.Equal("603799******1234", t.MaskedPan);
        }

        [Theory]
        [InlineData("49999", "123456789012", "5634056")] // مبلغ متفاوت
        [InlineData("50000", "", "5634056")]             // بدون RRN
        [InlineData("50000", "123456789012", "1111111")] // پایانهٔ دیگر
        public void SuspiciousApprovalNeedsReviewAndIsNotSuccess(string amount, string rrn, string terminal)
        {
            var t = Tx("s");
            PaymentRules.Apply(t, Approval(amount, rrn, terminal), "5634056", true, new TransactionJournal(_path));
            Assert.Equal("uncertain", t.Status);
            Assert.True(t.NeedsReview);
            Assert.False(t.IsSuccess);
        }

        [Fact]
        public void ReplayedRrnIsRejected()
        {
            var j = new TransactionJournal(_path);
            var first = Tx("first");
            PaymentRules.Apply(first, Approval(), "5634056", true, j);
            j.Save(first);

            var second = Tx("second");
            PaymentRules.Apply(second, Approval(), "5634056", true, j);
            Assert.Equal("uncertain", second.Status);
            Assert.Contains("RRN", second.Message);
        }

        [Fact]
        public void DeclineIsDefinitive()
        {
            var t = Tx("d");
            var r = Approval();
            r.Code = 55;
            PaymentRules.Apply(t, r, "5634056", true, null);
            Assert.Equal("declined", t.Status);
            Assert.False(t.NeedsReview);
            Assert.Equal("رمز کارت نامعتبر است", t.Message);
        }

        [Fact]
        public void LateApprovalAfterTimeoutIsKeptForReview()
        {
            var j = new TransactionJournal(_path);
            var t = Tx("late");
            t.Status = "timeout";
            t.NeedsReview = true;
            j.Save(t);

            Assert.True(PaymentRules.ApplyLate(j.Get("late"), Approval(), "5634056", true, j));
            var saved = j.Get("late");
            Assert.Equal("approved_late", saved.Status);
            Assert.True(saved.NeedsReview);
            Assert.True(saved.LateResponse);

            // پاسخ تکراری چیزی را عوض نمی‌کند
            Assert.False(PaymentRules.ApplyLate(saved, Approval(), "5634056", true, j));
        }

        [Fact]
        public void LateDeclineClearsReviewFlag()
        {
            var j = new TransactionJournal(_path);
            var t = Tx("late-decline");
            t.Status = "timeout";
            t.NeedsReview = true;
            j.Save(t);
            var r = Approval();
            r.Code = 51;
            PaymentRules.ApplyLate(j.Get("late-decline"), r, "5634056", true, j);
            Assert.Equal("declined", j.Get("late-decline").Status);
            Assert.False(j.Get("late-decline").NeedsReview);
        }

        [Fact]
        public void ResultNeverContainsFullCardNumber()
        {
            var t = Tx("pan");
            PaymentRules.Apply(t, Approval(), "5634056", true, null);
            var json = FlatJson.Serialize(t.ToResult());
            Assert.DoesNotContain("6037991234561234", json);
        }

        [Fact]
        public void FlatJsonRoundTrip()
        {
            var json = FlatJson.Serialize(new System.Collections.Generic.Dictionary<string, object>
            {
                { "s", "a\"b\\c\u0001د" }, { "n", 9007199254740993L }, { "b", true }, { "z", null }
            });
            var back = FlatJson.Parse(json);
            Assert.Equal("a\"b\\c\u0001د", back["s"]);
            Assert.Equal(9007199254740993L, back["n"]);
            Assert.Equal(true, back["b"]);
            Assert.Null(back["z"]);
        }
    }
}
