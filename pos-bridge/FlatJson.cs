using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace PosBridge
{
    /// <summary>
    /// نوشتن/خواندن JSON تخت (فقط رشته، عدد، بولی و null) برای دفتر تراکنش‌ها.
    /// عمداً بدون وابستگی به System.Web.Extensions تا روی هر نسخهٔ .NET آزمون‌پذیر باشد.
    /// </summary>
    internal static class FlatJson
    {
        public static string Serialize(IDictionary<string, object> obj)
        {
            var sb = new StringBuilder("{");
            var first = true;
            foreach (var kv in obj)
            {
                if (!first) sb.Append(',');
                first = false;
                WriteString(sb, kv.Key);
                sb.Append(':');
                var v = kv.Value;
                if (v == null) sb.Append("null");
                else if (v is bool) sb.Append((bool)v ? "true" : "false");
                else if (v is int || v is long) sb.Append(Convert.ToInt64(v).ToString(CultureInfo.InvariantCulture));
                else WriteString(sb, Convert.ToString(v, CultureInfo.InvariantCulture));
            }
            return sb.Append('}').ToString();
        }

        private static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (var c in s ?? "")
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        /// <summary>تجزیهٔ یک شیء تخت؛ برای ورودی نامعتبر null برمی‌گرداند</summary>
        public static Dictionary<string, object> Parse(string json)
        {
            try
            {
                var i = 0;
                var result = new Dictionary<string, object>();
                Skip(json, ref i);
                if (json[i++] != '{') return null;
                Skip(json, ref i);
                if (json[i] == '}') return result;
                while (true)
                {
                    Skip(json, ref i);
                    var key = ReadString(json, ref i);
                    Skip(json, ref i);
                    if (json[i++] != ':') return null;
                    Skip(json, ref i);
                    result[key] = ReadValue(json, ref i);
                    Skip(json, ref i);
                    var c = json[i++];
                    if (c == '}') return result;
                    if (c != ',') return null;
                }
            }
            catch
            {
                return null;
            }
        }

        private static void Skip(string s, ref int i)
        {
            while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
        }

        private static object ReadValue(string s, ref int i)
        {
            if (s[i] == '"') return ReadString(s, ref i);
            if (string.CompareOrdinal(s, i, "null", 0, 4) == 0) { i += 4; return null; }
            if (string.CompareOrdinal(s, i, "true", 0, 4) == 0) { i += 4; return true; }
            if (string.CompareOrdinal(s, i, "false", 0, 5) == 0) { i += 5; return false; }
            var start = i;
            while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '-' || s[i] == '.' || s[i] == 'e' || s[i] == 'E' || s[i] == '+')) i++;
            var num = s.Substring(start, i - start);
            long l;
            if (long.TryParse(num, NumberStyles.Integer, CultureInfo.InvariantCulture, out l)) return l;
            return double.Parse(num, CultureInfo.InvariantCulture);
        }

        private static string ReadString(string s, ref int i)
        {
            if (s[i++] != '"') throw new FormatException("string expected");
            var sb = new StringBuilder();
            while (true)
            {
                var c = s[i++];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }
                var e = s[i++];
                switch (e)
                {
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'u':
                        sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        i += 4;
                        break;
                    default: sb.Append(e); break;
                }
            }
        }
    }
}
