using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Xunit;

namespace PosBridge.Tests
{
    public class ReviewSyncTests : IDisposable
    {
        private const string Url = "https://abcdefgh.supabase.co";
        private const string Key = "sb_publishable_TESTKEY";
        private const string KioskKey = "kiosk-secret-0123456789abcdef";
        private const string KioskId = "6b1f0f7e-8c2f-4f0e-9c0e-2a1b5f3d9a11";

        private readonly string _dir = Path.Combine(Path.GetTempPath(), "posbridge-sync-" + Guid.NewGuid().ToString("N"));
        private readonly TransactionJournal _journal;
        private readonly FakeTransport _transport = new FakeTransport();
        private DateTime _now = new DateTime(2026, 10, 30, 12, 0, 0, DateTimeKind.Utc);

        public ReviewSyncTests()
        {
            Directory.CreateDirectory(_dir);
            _journal = new TransactionJournal(Path.Combine(_dir, "tx.jsonl"));
        }

        public void Dispose()
        {
            try { Directory.Delete(_dir, true); }
            catch { /* ignore */ }
        }

        /* ---------------- ابزارهای تست ---------------- */

        private sealed class Call
        {
            public string Url;
            public Dictionary<string, string> Headers;
            public string Body;
            public Dictionary<string, object> Json { get { return (Dictionary<string, object>)Parse(Body); } }
            public List<Dictionary<string, object>> Rows
            {
                get { return ((List<object>)Json["p_rows"]).Cast<Dictionary<string, object>>().ToList(); }
            }
        }

        private sealed class FakeTransport : ISyncTransport
        {
            public readonly List<Call> Calls = new List<Call>();
            public Func<Call, SyncResponse> Handler = c => Ok("2026-10-30T12:00:00Z", new object[0], 0);

            public SyncResponse Post(string url, IDictionary<string, string> headers, string body)
            {
                var call = new Call { Url = url, Headers = new Dictionary<string, string>(headers), Body = body };
                Calls.Add(call);
                return Handler(call);
            }
        }

        private static SyncResponse Ok(string serverTime, IEnumerable<object> remote, double offset)
        {
            return new SyncResponse
            {
                Status = 200,
                Body = JsonSerializer.Serialize(new Dictionary<string, object>
                {
                    { "server_time", serverTime }, { "clock_offset_seconds", offset }, { "remote_reviews", remote.ToList() }
                })
            };
        }

        private static object Parse(string json)
        {
            using (var doc = JsonDocument.Parse(json)) return Plain(doc.RootElement);
        }

        private static object Plain(JsonElement e)
        {
            switch (e.ValueKind)
            {
                case JsonValueKind.Object:
                    var d = new Dictionary<string, object>();
                    foreach (var p in e.EnumerateObject()) d[p.Name] = Plain(p.Value);
                    return d;
                case JsonValueKind.Array:
                    return e.EnumerateArray().Select(Plain).ToList();
                case JsonValueKind.String: return e.GetString();
                case JsonValueKind.Number: return e.GetDouble();
                case JsonValueKind.True: return true;
                case JsonValueKind.False: return false;
                default: return null;
            }
        }

        private ReviewSync Sync(string key = Key, int intervalSeconds = 60)
        {
            var settings = new SyncSettings
            {
                SupabaseUrl = Url, SupabaseKey = key, KioskId = KioskId, KioskSyncKey = KioskKey,
                IntervalSeconds = intervalSeconds
            };
            return new ReviewSync(settings, _journal, Path.Combine(_dir, "sync-state.json"), _transport,
                o => JsonSerializer.Serialize(o), json => Parse(json), () => _now);
        }

        private PosTransaction Flag(string id, string status = "uncertain", long amount = 1500000, string pan = "603799******7391")
        {
            var t = new PosTransaction
            {
                Id = id, MessageId = 1, AmountRial = amount, PosInvoice = "1", InvoiceNumber = "INV-" + id,
                Status = status, NeedsReview = true, MaskedPan = pan, Rrn = "123456789012",
                CreatedAt = "2026-10-30T09:12:00.0000000Z", Message = "رسید دستگاه را بررسی کنید"
            };
            _journal.Save(t);
            return t;
        }

        private static string Ids(Call c) { return string.Join(",", c.Rows.Select(r => (string)r["transaction_id"]).OrderBy(x => x)); }

        /* ---------------- ساخت بدنه ---------------- */

        [Fact]
        public void BodyNeverContainsCardData()
        {
            Flag("a", pan: "603799******7391");
            Sync().RunOnce();
            var body = _transport.Calls.Single().Body;
            Assert.DoesNotContain("603799", body);
            Assert.DoesNotContain("7391", body);
            Assert.DoesNotContain("masked", body, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("pan", body.Replace("transaction", "").Replace("expand", ""), StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public void RowsContainOnlyTheContractKeys()
        {
            Flag("a");
            Sync().RunOnce();
            var keys = _transport.Calls.Single().Rows.Single().Keys.OrderBy(k => k).ToArray();
            var allowed = new[]
            {
                "transaction_id", "occurred_at", "amount_rial", "status", "reason", "invoice_number", "rrn",
                "needs_review", "reviewed", "review_note", "reviewed_at"
            }.OrderBy(k => k).ToArray();
            Assert.Equal(allowed, keys);
        }

        [Fact]
        public void RowMapsFieldsAndUsesReviewNoteNotSystemNote()
        {
            var t = Flag("a");
            t.Note = "پیام سیستمی که نباید برود";
            _journal.Save(t);
            _journal.MarkReviewed("a", "با رسید بانک تطبیق شد", "کیوسک", null);
            Sync().RunOnce();

            var row = _transport.Calls.Single().Rows.Single();
            Assert.Equal("a", row["transaction_id"]);
            Assert.Equal(1500000d, row["amount_rial"]);
            Assert.Equal("INV-a", row["invoice_number"]);
            Assert.Equal("123456789012", row["rrn"]);
            Assert.Equal("2026-10-30T09:12:00.0000000Z", row["occurred_at"]);
            Assert.Equal(true, row["reviewed"]);
            Assert.Equal(false, row["needs_review"]);
            Assert.Equal("با رسید بانک تطبیق شد", row["review_note"]);
            Assert.DoesNotContain("پیام سیستمی", _transport.Calls.Single().Body);
        }

        [Theory]
        [InlineData("approved_late", "تأیید پس از لغو یا پایان زمان رسید")]
        [InlineData("timeout", "کارت‌خوان در زمان مقرر پاسخ نداد")]
        [InlineData("uncertain", "نتیجهٔ پرداخت نامطمئن است؛ رسید دستگاه را بررسی کنید")]
        [InlineData("failed", "ارسال به کارت‌خوان نیمه‌کاره ماند")]
        public void ReasonComesFromAFixedStatusTable(string status, string reason)
        {
            Flag("a", status);
            Sync().RunOnce();
            Assert.Equal(reason, _transport.Calls.Single().Rows.Single()["reason"]);
        }

        [Fact]
        public void InvalidAmountRowsAreSkippedInsteadOfBreakingTheBatch()
        {
            Flag("bad", amount: 0);
            Flag("good");
            Sync().RunOnce();
            Assert.Equal("good", Ids(_transport.Calls.Single()));
        }

        /* ---------------- دسته‌بندی و فقط تغییرها ---------------- */

        [Fact]
        public void SplitsRowsIntoBatches()
        {
            // دفتر با fsync نوشته می‌شود؛ برای اینکه تست‌های زمان‌بندی‌شدهٔ دیگر را کند نکند، دسته کوچک می‌شود
            for (var i = 0; i < 8; i++) Flag("t" + i);
            var sync = Sync();
            sync.BatchSize = 3;
            Assert.True(sync.RunOnce());
            Assert.Equal(new[] { 3, 3, 2 }, _transport.Calls.Select(c => c.Rows.Count).ToArray());
            Assert.Equal(8, _transport.Calls.SelectMany(c => c.Rows).Select(r => (string)r["transaction_id"]).Distinct().Count());
        }

        [Fact]
        public void BatchSizeNeverExceedsTheServerLimit()
        {
            var sync = Sync();
            Assert.Equal(500, ReviewSync.MaxRowsPerCall);
            Assert.Equal(500, sync.BatchSize);
            sync.BatchSize = 100000;                       // بیش از سقف سرور هم پذیرفته نمی‌شود
            for (var i = 0; i < 3; i++) Flag("t" + i);
            Assert.True(sync.RunOnce());
            Assert.True(_transport.Calls.All(c => c.Rows.Count <= 500));
        }

        [Fact]
        public void LaterRunsSendOnlyWhatChanged()
        {
            Flag("a");
            System.Threading.Thread.Sleep(50);
            Flag("b");
            var sync = Sync();
            sync.RunOnce();
            System.Threading.Thread.Sleep(50);
            Flag("c");
            sync.RunOnce();

            var ids = Ids(_transport.Calls.Last()).Split(',');
            Assert.Contains("c", ids);
            Assert.DoesNotContain("a", ids);
        }

        [Fact]
        public void CallsOnceEvenWithNothingToSendSoTheServerSeesTheKiosk()
        {
            Assert.True(Sync().RunOnce());
            var call = _transport.Calls.Single();
            Assert.Empty(call.Rows);
        }

        [Fact]
        public void BodyCarriesKioskIdKeyAndClock()
        {
            Flag("a");
            Sync().RunOnce();
            var json = _transport.Calls.Single().Json;
            Assert.Equal(KioskId, json["p_kiosk_id"]);
            Assert.Equal(KioskKey, json["p_key"]);
            Assert.Equal("2026-10-30T12:00:00.0000000Z", json["p_kiosk_now"]);
            Assert.Equal("1970-01-01T00:00:00.0000000Z", json["p_since"]);
            Assert.Equal(Url + "/rest/v1/rpc/kiosk_sync_review_transactions", _transport.Calls.Single().Url);
        }

        /* ---------------- هدرها ---------------- */

        [Fact]
        public void PublishableKeyGoesOnlyInApikeyHeader()
        {
            Sync("sb_publishable_ABC").RunOnce();
            var h = _transport.Calls.Single().Headers;
            Assert.Equal("sb_publishable_ABC", h["apikey"]);
            Assert.False(h.ContainsKey("Authorization"));
            Assert.Equal("application/json", h["Content-Type"]);
        }

        [Fact]
        public void JwtKeyIsAlsoSentAsBearer()
        {
            Sync("eyJhbGciOi.payload.sig").RunOnce();
            var h = _transport.Calls.Single().Headers;
            Assert.Equal("eyJhbGciOi.payload.sig", h["apikey"]);
            Assert.Equal("Bearer eyJhbGciOi.payload.sig", h["Authorization"]);
        }

        /* ---------------- پاسخ و بررسی از راه دور ---------------- */

        [Fact]
        public void SuccessAppliesRemoteReviewsAndMovesTheWatermarks()
        {
            Flag("a");
            _transport.Handler = c => Ok("2026-10-30T12:00:05Z", new object[]
            {
                new Dictionary<string, object>
                {
                    { "transaction_id", "a" }, { "review_note", "تطبیق شد" },
                    { "reviewed_at", "2026-10-30T11:59:00Z" }, { "reviewed_by", "admin@example.com" }
                },
                new Dictionary<string, object> { { "transaction_id", "unknown" }, { "reviewed_by", "x@y.z" } }
            }, 3);
            var sync = Sync();
            Assert.True(sync.RunOnce());

            var a = _journal.Get("a");
            Assert.True(a.Reviewed);
            Assert.Equal("admin@example.com", a.ReviewedBy);
            Assert.Equal("تطبیق شد", a.ReviewNote);

            _now = _now.AddMinutes(1);
            sync.RunOnce();
            Assert.Equal("2026-10-30T12:00:05Z", _transport.Calls.Last().Json["p_since"]);
            var status = sync.Status();
            Assert.Equal(3d, Convert.ToDouble(status["clockOffsetSeconds"]));
            Assert.Equal("", status["lastError"]);
        }

        [Fact]
        public void RowsRejectedByTheServerAreCountedNotFatal()
        {
            Flag("a");
            _transport.Handler = c => new SyncResponse
            {
                Status = 200,
                Body = JsonSerializer.Serialize(new Dictionary<string, object>
                {
                    { "server_time", "2026-10-30T12:00:05Z" }, { "clock_offset_seconds", 0 },
                    { "rejected", 2 }, { "remote_reviews", new List<object>() }
                })
            };
            var sync = Sync();
            Assert.True(sync.RunOnce());
            Assert.Equal(2, Convert.ToInt32(sync.Status()["lastRejected"]));
            Assert.Equal(0, Convert.ToInt32(sync.Status()["pendingCount"]));   // علامت جلو رفت؛ ردیف خراب تا ابد تکرار نمی‌شود
        }

        /* ---------------- خطا: هیچ چیز گم نمی‌شود، هیچ رازی نشت نمی‌کند ---------------- */

        [Fact]
        public void HttpErrorKeepsWatermarksSoNothingIsLost()
        {
            Flag("a");
            var fail = true;
            _transport.Handler = c => fail
                ? new SyncResponse { Status = 403, Body = "{\"code\":\"42501\",\"message\":\"invalid kiosk key\"}" }
                : Ok("2026-10-30T12:00:05Z", new object[0], 0);
            var sync = Sync();

            Assert.False(sync.RunOnce());
            Assert.Contains("403", (string)sync.Status()["lastError"]);

            fail = false;
            Assert.True(sync.RunOnce());
            Assert.Equal("a", Ids(_transport.Calls.Last()));   // همان ردیف دوباره فرستاده شد
            Assert.Equal("", sync.Status()["lastError"]);
        }

        [Fact]
        public void NetworkExceptionIsHandledAndRetried()
        {
            Flag("a");
            var boom = true;
            _transport.Handler = c =>
            {
                if (boom) throw new IOException("The remote name could not be resolved: 'abcdefgh.supabase.co'");
                return Ok("2026-10-30T12:00:05Z", new object[0], 0);
            };
            var sync = Sync();

            Assert.False(sync.RunOnce());
            Assert.NotEqual("", (string)sync.Status()["lastError"]);
            boom = false;
            Assert.True(sync.RunOnce());
            Assert.Equal("a", Ids(_transport.Calls.Last()));
        }

        [Fact]
        public void SecretsNeverAppearInStatusOrState()
        {
            Flag("a");
            // سرور خطایی برمی‌گرداند که کلید را (مثلاً از ورودی) تکرار کرده است
            _transport.Handler = c => new SyncResponse
            {
                Status = 400, Body = "{\"message\":\"bad key " + KioskKey + " and " + Key + "\"}"
            };
            var sync = Sync();
            sync.RunOnce();

            var status = JsonSerializer.Serialize(sync.Status());
            var state = File.ReadAllText(Path.Combine(_dir, "sync-state.json"));
            foreach (var text in new[] { status, state })
            {
                Assert.DoesNotContain(KioskKey, text);
                Assert.DoesNotContain(Key, text);
            }
        }

        [Fact]
        public void MalformedSuccessBodyIsAnErrorNotACrash()
        {
            Flag("a");
            _transport.Handler = c => new SyncResponse { Status = 200, Body = "<html>not json</html>" };
            var sync = Sync();
            Assert.False(sync.RunOnce());
            Assert.NotEqual("", (string)sync.Status()["lastError"]);
        }

        /* ---------------- وضعیت ---------------- */

        [Fact]
        public void StatusReportsPendingCountAndKioskId()
        {
            Flag("a");
            Flag("b");
            var sync = Sync();
            Assert.Equal(2, Convert.ToInt32(sync.Status()["pendingCount"]));
            sync.RunOnce();
            Assert.Equal(0, Convert.ToInt32(sync.Status()["pendingCount"]));
            Assert.Equal(KioskId, sync.Status()["kioskId"]);
            Assert.Equal("2026-10-30T12:00:00.0000000Z", sync.Status()["lastSyncedAt"]);
        }

        [Fact]
        public void StatePersistsAcrossRestarts()
        {
            Flag("a");
            Sync().RunOnce();
            var restarted = Sync();
            Assert.Equal(0, Convert.ToInt32(restarted.Status()["pendingCount"]));
            Assert.Equal("2026-10-30T12:00:00.0000000Z", restarted.Status()["lastSyncedAt"]);
        }
    }
}
