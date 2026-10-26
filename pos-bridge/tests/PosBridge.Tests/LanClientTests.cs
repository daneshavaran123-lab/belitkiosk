using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using Xunit;

namespace PosBridge.Tests
{
    /// <summary>
    /// کارت‌خوان ساختگی روی 127.0.0.1: درخواست PCBUY را می‌خواند و پاسخ POSBUY را یا روی همان
    /// اتصال (same) یا با اتصال برگشتی به پورت کیوسک (callback) می‌فرستد.
    /// </summary>
    internal sealed class FakeDevice : IDisposable
    {
        private readonly TcpListener _listener = new TcpListener(IPAddress.Loopback, 0);
        public int Port { get { return ((IPEndPoint)_listener.LocalEndpoint).Port; } }
        public string Mode = "same";
        public int CallbackPort;
        public int DelayMs = 100;
        public Func<string[], string> Respond;
        public string LastRequest;
        public int Requests;

        public FakeDevice()
        {
            _listener.Start();
            new Thread(Loop) { IsBackground = true }.Start();
        }

        private void Loop()
        {
            while (true)
            {
                TcpClient c;
                try { c = _listener.AcceptTcpClient(); }
                catch { return; }
                new Thread(() => Handle(c)) { IsBackground = true }.Start();
            }
        }

        private void Handle(TcpClient c)
        {
            try
            {
                var s = c.GetStream();
                var sb = new StringBuilder();
                var buf = new byte[256];
                while (!sb.ToString().Contains("\n"))
                {
                    var n = s.Read(buf, 0, buf.Length);
                    if (n <= 0) { c.Close(); return; }
                    sb.Append(Encoding.ASCII.GetString(buf, 0, n));
                }
                LastRequest = sb.ToString();
                Interlocked.Increment(ref Requests);
                var text = LastRequest.Trim();
                var fields = text.Substring(1, text.LastIndexOf('*') - 1).Split(',');
                var body = Respond == null ? null : Respond(fields);
                if (body == null) { Thread.Sleep(5000); c.Close(); return; }
                var frame = PcPosProtocol.Frame(body);

                if (Mode == "same")
                {
                    Thread.Sleep(DelayMs);
                    s.Write(frame, 0, frame.Length);
                    Thread.Sleep(200);
                    c.Close();
                }
                else
                {
                    c.Close();
                    Thread.Sleep(DelayMs);
                    using (var back = new TcpClient())
                    {
                        back.Connect(IPAddress.Loopback, CallbackPort);
                        back.GetStream().Write(frame, 0, frame.Length);
                        Thread.Sleep(200);
                    }
                }
            }
            catch { /* ignore */ }
        }

        public void Dispose()
        {
            _listener.Stop();
        }
    }

    public class LanClientTests : IDisposable
    {
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "posbridge-lan-" + Guid.NewGuid().ToString("N"));
        private readonly FakeDevice _device = new FakeDevice();
        private readonly TransactionJournal _journal;
        private readonly int _callbackPort = FreePort();

        public LanClientTests()
        {
            _journal = new TransactionJournal(Path.Combine(_dir, "tx.jsonl"));
            _device.CallbackPort = _callbackPort;
        }

        public void Dispose()
        {
            _device.Dispose();
            try { Directory.Delete(_dir, true); }
            catch { /* ignore */ }
        }

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            var p = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return p;
        }

        private PcPosLanClient Client(string mode, int timeoutSeconds = 3, string deviceIp = "127.0.0.1")
        {
            return new PcPosLanClient(new LanOptions
            {
                DeviceIp = deviceIp,
                DevicePort = _device.Port,
                CallbackPort = _callbackPort,
                ResponseMode = mode,
                ConnectTimeoutMs = 1000,
                ConnectAttempts = 1,
                ResponseTimeoutSeconds = timeoutSeconds,
                CancelGraceSeconds = 1,
                LateResponseSeconds = 10,
                ExpectedTerminalId = "5634056"
            }, _journal);
        }

        private PosTransaction NewTx(long amount = 50000)
        {
            var t = new PosTransaction
            {
                Id = Guid.NewGuid().ToString(),
                MessageId = _journal.NextMessageId(),
                AmountRial = amount,
                PosInvoice = "261026123456",
                Status = "pending",
                CreatedAt = PosTransaction.Now()
            };
            _journal.Save(t);
            return t;
        }

        private static string Approve(string[] req, int code = 0, string rrn = "123456789012")
        {
            // req: PCBUY, amount, invoice, date, messageId, tashim, appId, ""
            return "POSBUY," + code + "," + req[1] + "," + (code == 0 ? rrn : "") + ",654321,20261026120005,6618774,5634056,603799XXXXXX1234," + req[4] + ",";
        }

        [Theory]
        [InlineData("same", "same")]
        [InlineData("callback", "callback")]
        [InlineData("auto", "same")]
        [InlineData("auto", "callback")]
        public void ApprovesInEveryResponseMode(string clientMode, string deviceMode)
        {
            _device.Mode = deviceMode;
            _device.Respond = r => Approve(r);
            using (var client = Client(clientMode))
            {
                var tx = client.Pay(NewTx());
                Assert.Equal("approved", tx.Status);
                Assert.Equal("123456789012", tx.Rrn);
                Assert.Equal("approved", _journal.Get(tx.Id).Status);
                Assert.StartsWith("$PCBUY,50000,261026123456,", _device.LastRequest);
                Assert.EndsWith(",0,,*" + PcPosProtocol.Checksum(_device.LastRequest.Substring(1, _device.LastRequest.LastIndexOf('*') - 1)) + "\r\n", _device.LastRequest);
            }
        }

        [Fact]
        public void DeclineIsReturnedWithPersianMessage()
        {
            _device.Respond = r => Approve(r, 55);
            using (var client = Client("same"))
            {
                var tx = client.Pay(NewTx());
                Assert.Equal("declined", tx.Status);
                Assert.Equal("رمز کارت نامعتبر است", tx.Message);
                Assert.False(tx.NeedsReview);
            }
        }

        [Fact]
        public void SilentDeviceTimesOutAndNeedsReview()
        {
            _device.Respond = r => null;
            using (var client = Client("same", timeoutSeconds: 1))
            {
                var tx = client.Pay(NewTx());
                Assert.Equal("timeout", tx.Status);
                Assert.True(tx.NeedsReview);
                Assert.True(tx.IsUncertain);
            }
        }

        [Fact]
        public void UnreachableDeviceFailsWithoutSending()
        {
            var deadPort = FreePort();
            using (var client = new PcPosLanClient(new LanOptions
            {
                DeviceIp = "127.0.0.1", DevicePort = deadPort, ResponseMode = "same",
                ConnectTimeoutMs = 500, ConnectAttempts = 2, ResponseTimeoutSeconds = 2
            }, _journal))
            {
                var tx = client.Pay(NewTx());
                Assert.Equal("failed", tx.Status);
                Assert.False(tx.NeedsReview);
                Assert.Equal("", tx.SentAt);
            }
        }

        [Fact]
        public void CancelWaitsForDeviceAndKeepsApprovalThatArrivesInGrace()
        {
            _device.Mode = "callback";
            _device.DelayMs = 1300;
            _device.Respond = r => Approve(r);
            using (var client = Client("auto", timeoutSeconds: 5))
            {
                var tx = NewTx();
                new Thread(() => { Thread.Sleep(700); client.Cancel(tx.Id); }).Start();
                var result = client.Pay(tx);
                Assert.Equal("approved", result.Status);
                Assert.True(result.CancelRequested);
            }
        }

        [Fact]
        public void LateApprovalAfterCancelIsJournaledForReview()
        {
            _device.Mode = "callback";
            _device.DelayMs = 2500;
            _device.Respond = r => Approve(r, rrn: "999999999999");
            using (var client = Client("auto", timeoutSeconds: 5))
            {
                var tx = NewTx();
                new Thread(() => { Thread.Sleep(300); client.Cancel(tx.Id); }).Start();
                var result = client.Pay(tx);
                Assert.Equal("cancelled", result.Status);

                Thread.Sleep(2500);
                var saved = _journal.Get(tx.Id);
                Assert.Equal("approved_late", saved.Status);
                Assert.True(saved.NeedsReview);
                Assert.Equal("999999999999", saved.Rrn);
            }
        }

        [Fact]
        public void CallbackFromOtherAddressIsIgnored()
        {
            // دستگاه ثبت‌شده 127.0.0.2 است ولی پاسخ برگشتی از 127.0.0.1 می‌آید
            _device.Mode = "callback";
            _device.Respond = r => Approve(r);
            using (var client = new PcPosLanClient(new LanOptions
            {
                DeviceIp = "127.0.0.2", DevicePort = _device.Port, CallbackPort = _callbackPort, ResponseMode = "callback",
                ConnectTimeoutMs = 1000, ConnectAttempts = 1, ResponseTimeoutSeconds = 2, ExpectedTerminalId = "5634056"
            }, _journal))
            {
                var tx = client.Pay(NewTx());
                if (tx.Status == "failed") return; // سیستمی که 127.0.0.2 ندارد
                Assert.Equal("timeout", tx.Status);
                Assert.False(tx.IsSuccess);
            }
        }

        [Fact]
        public void SecondConcurrentPaymentIsRefused()
        {
            _device.DelayMs = 1500;
            _device.Respond = r => Approve(r);
            using (var client = Client("same"))
            {
                PosTransaction first = null;
                var t = new Thread(() => first = client.Pay(NewTx()));
                t.Start();
                Thread.Sleep(400);
                var second = client.Pay(NewTx());
                t.Join();
                Assert.Equal("failed", second.Status);
                Assert.Equal("approved", first.Status);
                Assert.Equal(1, _device.Requests);
            }
        }

        [Fact]
        public void ListenerPortConflictFailsBeforeSending()
        {
            var blocker = new TcpListener(IPAddress.Any, _callbackPort);
            blocker.Start();
            try
            {
                _device.Respond = r => Approve(r);
                using (var client = Client("callback"))
                {
                    var tx = client.Pay(NewTx());
                    Assert.Equal("failed", tx.Status);
                    Assert.Equal(0, _device.Requests);
                }
            }
            finally
            {
                blocker.Stop();
            }
        }
    }
}
