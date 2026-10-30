#!/usr/bin/env bash
# آزمون migrationها روی یک PostgreSQL موقت (اصل III constitution):
#   bash supabase/tests/run.sh
#
# ۱. یک cluster موقت PostgreSQL می‌سازد (فقط روی 127.0.0.1، بدون unix socket).
# ۲. stub.sql (شبیه‌سازی حداقلی Supabase) و همهٔ supabase/migrations/*.sql را به ترتیب نام اجرا می‌کند.
# ۳. migrationهای قابل اجرای دوباره (از RERUNNABLE_FROM به بعد) را یک بار دیگر اجرا می‌کند.
# ۴. هر سناریوی supabase/tests/*.sql را روی یک دیتابیس تازه اجرا می‌کند؛ سناریو با RAISE EXCEPTION شکست می‌خورد.
#
# پیش‌نیاز: PostgreSQL 14+ (initdb، pg_ctl، psql). پورت با PGPORT (پیش‌فرض 55432).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PGPORT:-55432}"
# migrationهای پیش از این تاریخ با قاعدهٔ «قابل اجرای دوباره» نوشته نشده‌اند
RERUNNABLE_FROM="20261029100000"

if ! command -v initdb >/dev/null 2>&1; then
  for d in /usr/lib/postgresql/*/bin; do
    if [ -x "$d/initdb" ]; then PATH="$d:$PATH"; fi
  done
fi
command -v initdb >/dev/null 2>&1 || { echo "✗ PostgreSQL (initdb) پیدا نشد"; exit 1; }

AS=()
if [ "$(id -u)" = 0 ]; then
  # initdb با root اجرا نمی‌شود؛ cluster با کاربر postgres ساخته می‌شود
  id postgres >/dev/null 2>&1 || { echo "✗ اجرا با root به کاربر postgres نیاز دارد"; exit 1; }
  WORK="$(mktemp -d /tmp/belit-pgtest.XXXXXX)"
  chown postgres "$WORK"
  AS=(runuser -u postgres --)
else
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/belit-pgtest.XXXXXX")"
fi
DATA="$WORK/data"

run_as() { ${AS[@]+"${AS[@]}"} "$@"; }
cleanup() {
  run_as pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

run_as initdb -D "$DATA" -U postgres -A trust --no-sync >/dev/null
run_as pg_ctl -D "$DATA" -l "$WORK/postgres.log" -w \
  -o "-p $PORT -k '' -c listen_addresses=127.0.0.1 -c fsync=off" start >/dev/null

export PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=postgres PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

migrations=("$ROOT"/supabase/migrations/*.sql)
scenarios=()
for f in "$HERE"/*.sql; do
  [ "$(basename "$f")" = "stub.sql" ] || scenarios+=("$f")
done

fresh_db() {
  "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1"
  "${PSQL[@]}" -d "$1" -f "$HERE/stub.sql"
  for m in "${migrations[@]}"; do
    if ! "${PSQL[@]}" -d "$1" -f "$m" >/dev/null; then
      echo "✗ migration $(basename "$m")"
      return 1
    fi
  done
}

echo "▶ ${#migrations[@]} migration"
fresh_db mig_check
rerun=0
for m in "${migrations[@]}"; do
  if [[ "$(basename "$m")" > "$RERUNNABLE_FROM" ]] || [[ "$(basename "$m")" == "$RERUNNABLE_FROM"* ]]; then
    "${PSQL[@]}" -d mig_check -f "$m" >/dev/null || { echo "✗ اجرای دوبارهٔ $(basename "$m")"; exit 1; }
    rerun=$((rerun + 1))
  fi
done
echo "✓ همهٔ migrationها اجرا شدند ($rerun migration دوباره هم اجرا شد)"

fail=0
for s in "${scenarios[@]}"; do
  name="$(basename "$s" .sql)"
  db="t_${name//[^a-zA-Z0-9_]/_}"
  fresh_db "$db"
  if "${PSQL[@]}" -d "$db" -f "$s"; then
    echo "✓ $name"
  else
    echo "✗ $name"
    fail=1
  fi
done
exit "$fail"
