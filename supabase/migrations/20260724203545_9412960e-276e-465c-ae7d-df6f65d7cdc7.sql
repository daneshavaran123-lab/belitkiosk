
-- Products table for all six museum sections
CREATE TABLE public.products (
  id BIGSERIAL PRIMARY KEY,
  section TEXT NOT NULL CHECK (section IN ('bookstore','cafe','souvenirs','membership','events','support')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  icon TEXT NOT NULL DEFAULT 'Package',
  accent TEXT NOT NULL DEFAULT '#cd7f32',
  active BOOLEAN NOT NULL DEFAULT true,
  stock INTEGER,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active products" ON public.products
  FOR SELECT TO anon, authenticated
  USING (active = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage products" ON public.products
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.products_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_touch_updated_at();

-- Seed data
INSERT INTO public.products (section, name, description, price, icon, accent, sort_order) VALUES
-- Bookstore
('bookstore', 'تاریخ کشتی ایران', 'مروری جامع بر تاریخ کهن کشتی پهلوانی ایران از دوران باستان تا امروز.', 450000, 'BookOpen', '#60a5fa', 1),
('bookstore', 'زندگی‌نامه جهان‌پهلوان تختی', 'روایت زندگی و منش پهلوانی غلامرضا تختی، اسطوره کشتی ایران.', 380000, 'BookMarked', '#60a5fa', 2),
('bookstore', 'فنون کشتی آزاد', 'آموزش تصویری فنون پایه و پیشرفته کشتی آزاد برای علاقه‌مندان.', 320000, 'Book', '#60a5fa', 3),
-- Cafe
('cafe', 'چای سنتی ایرانی', 'چای دم‌کشیده با نبات و هل، سرو در استکان کمرباریک.', 45000, 'Coffee', '#fbbf24', 1),
('cafe', 'قهوه ترک', 'قهوه ترک اصیل با فنجان اختصاصی موزه.', 85000, 'Coffee', '#fbbf24', 2),
('cafe', 'شربت سنتی', 'شربت سکنجبین یا بهارنارنج، خنک و گوارا.', 55000, 'GlassWater', '#fbbf24', 3),
('cafe', 'شیرینی سنتی', 'مجموعه شیرینی‌های سنتی: باقلوا، سوهان، گز.', 95000, 'Cookie', '#fbbf24', 4),
-- Souvenirs
('souvenirs', 'نشان رسمی فدراسیون', 'نشان طلایی یادبود فدراسیون کشتی جمهوری اسلامی ایران.', 250000, 'Medal', '#34d399', 1),
('souvenirs', 'پیراهن یادگاری تیم ملی', 'پیراهن رسمی تیم ملی کشتی با طرح اختصاصی موزه.', 850000, 'Shirt', '#34d399', 2),
('souvenirs', 'پرچم فدراسیون', 'پرچم رسمی کشتی ایران، مناسب برای مجموعه‌داران.', 180000, 'Flag', '#34d399', 3),
-- Membership
('membership', 'عضویت نقره‌ای', 'بازدید نامحدود یک‌ساله + ۱۰٪ تخفیف در فروشگاه.', 1500000, 'Gem', '#c084fc', 1),
('membership', 'عضویت طلایی', 'بازدید نامحدود + ۲۰٪ تخفیف + دعوت به رویدادهای ویژه.', 3500000, 'Crown', '#c084fc', 2),
-- Events
('events', 'همایش قهرمانان کشتی', 'دیدار حضوری با قهرمانان المپیک و جهان.', 500000, 'CalendarDays', '#60a5fa', 1),
('events', 'کارگاه آموزش فنون', 'کارگاه یک‌روزه آموزش فنون کشتی توسط مربیان ملی.', 750000, 'Users', '#60a5fa', 2),
-- Support
('support', 'حمایت برنزی', 'همراهی با موزه در حفظ میراث کشتی ایران.', 500000, 'Heart', '#f87171', 1),
('support', 'حمایت نقره‌ای', 'کمک قابل‌توجه به توسعه فعالیت‌های موزه.', 2000000, 'HeartHandshake', '#f87171', 2),
('support', 'حمایت طلایی', 'حامی افتخاری موزه با نام‌بری در تابلوی حامیان.', 10000000, 'Award', '#f87171', 3);
