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
    
        /* ---------- همگام‌سازی بررسی با سرور (specs/001-daily-sales-report) ---------- */

        private static PosTransaction Uncertain(string id, long amount = 50000)
        {
            var t = Tx(id, amount);
            t.Status = "uncertain";
            t.NeedsReview = true;
            t.Message = "نامطمئن";
            return t;
        }

        [Fact]
        public void SyncFieldsSurviveReload()
        {
            var j = new TransactionJournal(_path);
            j.Save(Uncertain("a"));
            Assert.True(j.MarkReviewed("a", "با رسید بانک تطبیق شد", "کیوسک", null));

            var r = new TransactionJournal(_path).Get("a");
            Assert.True(r.Reviewed);
            Assert.False(r.NeedsReview);
            Assert.Equal("کیوسک", r.ReviewedBy);
            Assert.Equal("با رسید بانک تطبیق شد", r.ReviewNote);
            Assert.False(string.IsNullOrEmpty(r.ReviewedAt));
            Assert.False(string.IsNullOrEmpty(r.UpdatedAt));
        }

        [Fact]
        public void EverySaveAdvancesUpdatedAt()
        {
            var j = new TransactionJournal(_path);
            var t = Uncertain("a");
            j.Save(t);
            var first = j.Get("a").UpdatedAt;
            System.Threading.Thread.Sleep(50);
            j.Save(t);
            Assert.True(string.CompareOrdinal(j.Get("a").UpdatedAt, first) > 0);
        }

        [Fact]
        public void ChangedSinceReturnsOnlyFlaggedTransactions()
        {
            var j = new TransactionJournal(_path);
            var ok = Tx("ok");
            PaymentRules.Apply(ok, Approval(), "5634056", true, j);   // موفق عادی: هرگز فرستاده نمی‌شود
            j.Save(ok);
            j.Save(Uncertain("flagged"));
            var cancelled = Tx("cancelled");
            cancelled.Status = "cancelled";                            // لغو عادی: فرستاده نمی‌شود
            j.Save(cancelled);

            var ids = new System.Collections.Generic.List<string>();
            foreach (var t in j.ChangedSince("")) ids.Add(t.Id);
            Assert.Equal(new[] { "flagged" }, ids.ToArray());
        }

        [Fact]
        public void KioskSideReviewIsStillSynced()
        {
            // MarkReviewed، NeedsReview را false می‌کند؛ بررسی روی کیوسک باید همچنان به سرور برسد
            var j = new TransactionJournal(_path);
            j.Save(Uncertain("a"));
            var before = j.Get("a").UpdatedAt;
            System.Threading.Thread.Sleep(50);
            Assert.True(j.MarkReviewed("a", "", "کیوسک", null));

            var changed = j.ChangedSince(before);
            Assert.Single(changed);
            Assert.True(changed[0].Reviewed);
            Assert.False(changed[0].NeedsReview);
        }

        [Fact]
        public void LateDeclineIsSyncedAsResolved()
        {
            // رد دیررس نگرانی را برطرف می‌کند (NeedsReview=false) بی‌آنکه کسی «بررسی شد» بزند
            var j = new TransactionJournal(_path);
            var t = Uncertain("a");
            t.Status = "timeout";
            j.Save(t);
            var declined = new PosBuyResponse { ChecksumValid = true, Type = "POSBUY", Code = 51, Rrn = "1", MessageId = "10" };
            Assert.True(PaymentRules.ApplyLate(t, declined, "5634056", true, j));

            var changed = j.ChangedSince("");
            Assert.Single(changed);
            Assert.Equal("declined", changed[0].Status);
            Assert.False(changed[0].NeedsReview);
            Assert.False(changed[0].Reviewed);
        }

        [Fact]
        public void ChangedSinceIsInclusiveOfTheWatermark()
        {
            var j = new TransactionJournal(_path);
            j.Save(Uncertain("a"));
            var stamp = j.Get("a").UpdatedAt;
            Assert.Single(j.ChangedSince(stamp));                 // >= : ردیف هم‌زمان با علامت جا نمی‌ماند
            System.Threading.Thread.Sleep(50);
            Assert.Empty(j.ChangedSince(PosTransaction.Now()));
        }

        [Fact]
        public void RemoteReviewIsAppliedOnceAndNeverUndone()
        {
            var j = new TransactionJournal(_path);
            j.Save(Uncertain("a"));
            Assert.True(j.ApplyRemoteReview("a", "تطبیق شد", "2026-10-30T10:00:00.0000000Z", "admin@example.com"));

            var r = j.Get("a");
            Assert.True(r.Reviewed);
            Assert.False(r.NeedsReview);
            Assert.Equal("admin@example.com", r.ReviewedBy);
            Assert.Equal("2026-10-30T10:00:00.0000000Z", r.ReviewedAt);
            Assert.Equal("تطبیق شد", r.ReviewNote);
            Assert.DoesNotContain("تطبیق شد", r.Note);              // یادداشت بررسی با پیام‌های سیستمی قاطی نمی‌شود

            // بار دوم یا بررسی دیگر چیزی را عوض نمی‌کند
            Assert.False(j.ApplyRemoteReview("a", "دوم", "2026-10-31T10:00:00.0000000Z", "other@example.com"));
            Assert.Equal("admin@example.com", j.Get("a").ReviewedBy);
            Assert.True(j.MarkReviewed("a", "کیوسک هم زد", "کیوسک", null));   // idempotent
            Assert.Equal("تطبیق شد", j.Get("a").ReviewNote);
        }

        [Fact]
        public void RemoteReviewOfUnknownTransactionIsIgnored()
        {
            var j = new TransactionJournal(_path);
            Assert.False(j.ApplyRemoteReview("nope", "x", "2026-10-30T10:00:00.0000000Z", "a@b.c"));
            Assert.False(j.MarkReviewed("nope", "x", "کیوسک", null));
        }

        [Fact]
        public void OldRecordsWithoutUpdatedAtFallBackToCompletedAt()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path));
            File.WriteAllText(_path,
                "{\"id\":\"old\",\"messageId\":5,\"amountRial\":1000,\"status\":\"uncertain\",\"needsReview\":true," +
                "\"completedAt\":\"2026-10-01T08:00:00.0000000Z\"}\n");
            var j = new TransactionJournal(_path);
            Assert.Equal("2026-10-01T08:00:00.0000000Z", j.Get("old").UpdatedAt);
            Assert.Single(j.ChangedSince(""));
        }
    }
}
