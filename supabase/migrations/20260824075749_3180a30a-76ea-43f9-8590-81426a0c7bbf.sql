ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS pos_ref_number text,
  ADD COLUMN IF NOT EXISTS pos_masked_pan text,
  ADD COLUMN IF NOT EXISTS pos_response_code text,
  ADD COLUMN IF NOT EXISTS pos_terminal_id text;