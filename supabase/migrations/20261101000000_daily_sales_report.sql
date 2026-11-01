-- ============================================================
-- گزارش فروش روزانه (specs/001-daily-sales-report) — بخش US1
--
-- ۱. نوع آیتم در ردیف‌های فاکتور (item_type، reference_id) تا بلیط‌ها قابل شمارش باشند.
--    ردیف‌های قدیمی دست نمی‌خورند و در گزارش «نامشخص» شمرده می‌شوند.
-- ۲. daily_sales_report(p_day): کل گزارش یک روز به وقت تهران در یک پاسخ JSON.
--    SECURITY INVOKER است، پس همان سیاست‌های RLS فاکتورها تعیین می‌کنند چه کسی چه می‌بیند.
--
-- قابل اجرای دوباره.
-- ============================================================

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS item_type text,
  ADD COLUMN IF NOT EXISTS reference_id bigint;

ALTER TABLE public.invoice_items DROP CONSTRAINT IF EXISTS invoice_items_item_type_check;
ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_item_type_check
  CHECK (item_type IS NULL OR item_type IN ('ticket', 'product', 'event', 'membership', 'donation'));

-- ردیف بلیط باید نوع بلیطش معلوم باشد؛ بدون FK تا حذف یک نوع بلیط فاکتورهای قدیمی را نشکند
ALTER TABLE public.invoice_items DROP CONSTRAINT IF EXISTS invoice_items_ticket_reference_check;
ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_ticket_reference_check
  CHECK (item_type IS DISTINCT FROM 'ticket' OR reference_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS invoices_created_at_idx ON public.invoices (created_at);
CREATE INDEX IF NOT EXISTS invoice_items_invoice_id_idx ON public.invoice_items (invoice_id);

-- قرارداد خروجی: specs/001-daily-sales-report/contracts/daily-sales-report.md
CREATE OR REPLACE FUNCTION public.daily_sales_report(p_day date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Tehran')::date;
  v_from timestamptz;
  v_to timestamptz;
  v_sales jsonb;
  v_tickets jsonb;
BEGIN
  IF p_day IS NULL OR p_day > v_today THEN
    RAISE EXCEPTION 'روز آینده قابل گزارش نیست' USING ERRCODE = '22023';
  END IF;
  v_from := p_day::timestamp AT TIME ZONE 'Asia/Tehran';
  v_to := (p_day + 1)::timestamp AT TIME ZONE 'Asia/Tehran';

  SELECT jsonb_build_object(
    'card', jsonb_build_object(
      'total', coalesce(sum(i.total) FILTER (WHERE i.payment_method = 'card'), 0),
      'count', count(*) FILTER (WHERE i.payment_method = 'card')),
    'cash', jsonb_build_object(
      'total', coalesce(sum(i.total) FILTER (WHERE i.payment_method = 'cash'), 0),
      'count', count(*) FILTER (WHERE i.payment_method = 'cash')),
    'total', coalesce(sum(i.total), 0),
    'invoice_count', count(*))
  INTO v_sales
  FROM invoices i
  WHERE i.created_at >= v_from AND i.created_at < v_to;

  WITH lines AS (
    SELECT ii.item_type, ii.reference_id, ii.quantity
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.created_at >= v_from AND i.created_at < v_to
  ),
  by_type AS (
    SELECT l.reference_id AS ticket_type_id, t.name, t.category, sum(l.quantity)::bigint AS quantity
    FROM lines l
    LEFT JOIN ticket_types t ON t.id = l.reference_id
    WHERE l.item_type = 'ticket'
    GROUP BY l.reference_id, t.name, t.category
  )
  SELECT jsonb_build_object(
    'total', coalesce((SELECT sum(quantity) FROM by_type), 0),
    'by_type', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'ticket_type_id', ticket_type_id, 'name', name, 'category', category, 'quantity', quantity)
        ORDER BY array_position(ARRAY['normal', 'guided', 'vip'], category) NULLS LAST,
          name NULLS LAST, ticket_type_id)
      FROM by_type), '[]'::jsonb),
    'untyped_lines_quantity', coalesce((SELECT sum(quantity) FROM lines WHERE item_type IS NULL), 0))
  INTO v_tickets;

  RETURN jsonb_build_object(
    'day', p_day,
    'generated_at', now(),
    'is_today', p_day = v_today,
    'sales', v_sales,
    'tickets', v_tickets,
    'review', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.daily_sales_report(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daily_sales_report(date) TO anon, authenticated, service_role;
