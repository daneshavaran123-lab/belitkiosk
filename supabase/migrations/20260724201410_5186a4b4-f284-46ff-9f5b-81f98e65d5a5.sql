
-- Roles enum + user_roles table
CREATE TYPE public.app_role AS ENUM ('admin');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "Admins can view roles" ON public.user_roles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Ticket types
CREATE TABLE public.ticket_types (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('normal','guided','vip')),
  base_price INTEGER NOT NULL CHECK (base_price >= 0),
  group_min_count INTEGER NOT NULL DEFAULT 10,
  group_discount_percent INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ticket_types TO anon, authenticated;
GRANT ALL ON public.ticket_types TO service_role;
ALTER TABLE public.ticket_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active tickets" ON public.ticket_types FOR SELECT TO anon, authenticated
USING (active = TRUE OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage tickets" ON public.ticket_types FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.ticket_types (name, description, category, base_price, group_min_count, group_discount_percent) VALUES
('بلیط عادی','بازدید آزاد از تمامی بخش‌های موزه','normal',150000,10,20),
('بلیط با راهنما','بازدید همراه با راهنمای متخصص موزه','guided',300000,10,20),
('بلیط VIP','بازدید اختصاصی + پذیرایی در کافه موزه','vip',750000,5,20);

-- Invoices
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  total INTEGER NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('card','cash')),
  status TEXT NOT NULL DEFAULT 'paid',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.invoices TO anon, authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert invoices" ON public.invoices FOR INSERT TO anon, authenticated WITH CHECK (TRUE);
CREATE POLICY "Admins view invoices" ON public.invoices FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  discount_percent INTEGER NOT NULL DEFAULT 0,
  total_price INTEGER NOT NULL
);
GRANT SELECT, INSERT ON public.invoice_items TO anon, authenticated;
GRANT ALL ON public.invoice_items TO service_role;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert invoice items" ON public.invoice_items FOR INSERT TO anon, authenticated WITH CHECK (TRUE);
CREATE POLICY "Admins view invoice items" ON public.invoice_items FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX invoices_created_idx ON public.invoices (created_at DESC);
CREATE INDEX invoice_items_inv_idx ON public.invoice_items (invoice_id);
