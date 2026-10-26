using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.Linq;

namespace PosBridge
{
    /// <summary>یک خط از بلیط چاپی</summary>
    internal class TicketLine
    {
        public string Name = "";
        public int Quantity = 1;
        public long TotalToman;
    }

    /// <summary>دادهٔ کامل بلیط برای چاپ</summary>
    internal class TicketData
    {
        public string MuseumName = "موزه افتخارات کشتی ایران";
        public string InvoiceNumber = "";
        public string DateTimeText = "";
        public string PaymentMethod = "card";
        public long TotalToman;
        public string RefNumber = "";
        public string MaskedPan = "";
        public string TerminalId = "";
        public string ResponseCode = "";
        public string Footer = "این بلیط را در ورودی موزه ارائه دهید";
        /// <summary>تصویر QR به‌صورت data:image/png;base64 (توسط کیوسک ساخته می‌شود)</summary>
        public string QrPngBase64 = "";
        public List<TicketLine> Items = new List<TicketLine>();
        public int Copies = 1;
    }

    /// <summary>
    /// چاپ بلیط روی پرینتر حرارتی ۸۰ میلی‌متری با استفاده از GDI،
    /// تا متن فارسی (راست‌به‌چپ) با فونت ویندوز درست رندر شود.
    /// </summary>
    internal static class Printer
    {
        public static List<string> ListPrinters()
        {
            var list = new List<string>();
            foreach (string p in PrinterSettings.InstalledPrinters) list.Add(p);
            return list;
        }

        public static string DefaultPrinter()
        {
            try { return new PrinterSettings().PrinterName; }
            catch { return ""; }
        }

        public static Dictionary<string, object> Print(TicketData ticket, string printerName, string fontName)
        {
            try
            {
                var doc = new PrintDocument();
                if (!string.IsNullOrEmpty(printerName)) doc.PrinterSettings.PrinterName = printerName;
                if (!doc.PrinterSettings.IsValid)
                    return Result(false, "پرینتر «" + printerName + "» روی این ویندوز پیدا نشد");

                doc.DocumentName = "Museum Ticket " + ticket.InvoiceNumber;
                doc.DefaultPageSettings.Margins = new Margins(8, 8, 12, 12);
                // ۸۰ میلی‌متر ≈ ۳٫۱۵ اینچ (واحد: صدم اینچ)
                try { doc.DefaultPageSettings.PaperSize = new PaperSize("Roll80", 295, 1200); }
                catch { /* برخی درایورها اندازهٔ سفارشی نمی‌پذیرند */ }

                var copies = Math.Max(1, Math.Min(3, ticket.Copies));
                doc.PrinterSettings.Copies = (short)copies;

                Bitmap qr = null;
                if (!string.IsNullOrEmpty(ticket.QrPngBase64)) qr = DecodeImage(ticket.QrPngBase64);

                doc.PrintPage += (s, e) => Render(e, ticket, qr, string.IsNullOrEmpty(fontName) ? "Tahoma" : fontName);
                doc.Print();

                PosLog.Info("print:ok", "بلیط فاکتور " + ticket.InvoiceNumber + " روی «" +
                    doc.PrinterSettings.PrinterName + "» چاپ شد");
                return Result(true, "بلیط چاپ شد", doc.PrinterSettings.PrinterName);
            }
            catch (Exception ex)
            {
                PosLog.Error("print:failed", ex.Message);
                return Result(false, "چاپ ناموفق بود: " + ex.Message);
            }
        }

        private static void Render(PrintPageEventArgs e, TicketData t, Bitmap qr, string fontName)
        {
            var g = e.Graphics;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;

            var width = e.MarginBounds.Width;
            var left = e.MarginBounds.Left;
            float y = e.MarginBounds.Top;

            var rtl = new StringFormat(StringFormatFlags.DirectionRightToLeft);
            var center = new StringFormat(StringFormatFlags.DirectionRightToLeft) { Alignment = StringAlignment.Center };

            using (var title = new Font(fontName, 13, FontStyle.Bold))
            using (var head = new Font(fontName, 10, FontStyle.Bold))
            using (var body = new Font(fontName, 9))
            using (var small = new Font(fontName, 7.5f))
            using (var pen = new Pen(Color.Black, 1))
            {
                g.DrawString(t.MuseumName, title, Brushes.Black, new RectangleF(left, y, width, 30), center);
                y += 26;
                g.DrawString("بلیط ورود / رسید خرید", head, Brushes.Black, new RectangleF(left, y, width, 22), center);
                y += 22;
                g.DrawLine(pen, left, y, left + width, y);
                y += 6;

                y = Row(g, body, rtl, left, y, width, "شماره فاکتور", t.InvoiceNumber);
                y = Row(g, body, rtl, left, y, width, "تاریخ", t.DateTimeText);
                y = Row(g, body, rtl, left, y, width, "روش پرداخت", t.PaymentMethod == "cash" ? "نقدی" : "کارت‌خوان");

                y += 4;
                g.DrawLine(pen, left, y, left + width, y);
                y += 6;

                foreach (var item in t.Items)
                {
                    y = Row(g, body, rtl, left, y, width,
                        item.Name + " × " + item.Quantity, Money(item.TotalToman));
                }

                y += 4;
                g.DrawLine(pen, left, y, left + width, y);
                y += 6;
                y = Row(g, head, rtl, left, y, width, "مبلغ کل", Money(t.TotalToman));

                if (!string.IsNullOrEmpty(t.RefNumber) || !string.IsNullOrEmpty(t.MaskedPan))
                {
                    y += 4;
                    g.DrawLine(pen, left, y, left + width, y);
                    y += 6;
                    if (!string.IsNullOrEmpty(t.RefNumber)) y = Row(g, body, rtl, left, y, width, "کد پیگیری", t.RefNumber);
                    if (!string.IsNullOrEmpty(t.MaskedPan)) y = Row(g, body, rtl, left, y, width, "شماره کارت", t.MaskedPan);
                    if (!string.IsNullOrEmpty(t.TerminalId)) y = Row(g, body, rtl, left, y, width, "پایانه", t.TerminalId);
                    if (!string.IsNullOrEmpty(t.ResponseCode)) y = Row(g, body, rtl, left, y, width, "کد پاسخ", t.ResponseCode);
                }

                if (qr != null)
                {
                    y += 10;
                    var size = Math.Min(170, width - 20);
                    g.DrawImage(qr, left + (width - size) / 2, y, size, size);
                    y += size + 6;
                }

                y += 6;
                g.DrawString(t.Footer, small, Brushes.Black, new RectangleF(left, y, width, 40), center);
                y += 26;
                g.DrawString(t.InvoiceNumber, small, Brushes.Black, new RectangleF(left, y, width, 20), center);
            }

            e.HasMorePages = false;
        }

        private static float Row(Graphics g, Font font, StringFormat rtl, int left, float y, int width,
            string label, string value)
        {
            var lineHeight = font.GetHeight(g) + 4;
            var rect = new RectangleF(left, y, width, lineHeight);
            g.DrawString(label, font, Brushes.Black, rect, rtl);
            var ltr = new StringFormat { Alignment = StringAlignment.Near };
            g.DrawString(value ?? "", font, Brushes.Black, rect, ltr);
            return y + lineHeight;
        }

        private static string Money(long toman)
        {
            return string.Format("{0:n0} تومان", toman);
        }

        private static Bitmap DecodeImage(string dataUrl)
        {
            try
            {
                var base64 = dataUrl.Contains(",") ? dataUrl.Split(',').Last() : dataUrl;
                var bytes = Convert.FromBase64String(base64);
                using (var ms = new MemoryStream(bytes)) return new Bitmap(Image.FromStream(ms));
            }
            catch (Exception ex)
            {
                PosLog.Warn("print:qr", "تصویر QR خوانده نشد: " + ex.Message);
                return null;
            }
        }

        private static Dictionary<string, object> Result(bool ok, string message, string printer = "")
        {
            return new Dictionary<string, object>
            {
                { "success", ok },
                { "message", message },
                { "printer", printer }
            };
        }
    }
}
