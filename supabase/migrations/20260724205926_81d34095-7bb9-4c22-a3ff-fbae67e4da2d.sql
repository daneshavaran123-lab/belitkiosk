CREATE TABLE public.survey_responses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  overall_rating smallint NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  guide_rating smallint CHECK (guide_rating BETWEEN 1 AND 5),
  environment_rating smallint CHECK (environment_rating BETWEEN 1 AND 5),
  visitor_name text,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.survey_responses TO anon, authenticated;
GRANT SELECT, DELETE ON public.survey_responses TO authenticated;
GRANT ALL ON public.survey_responses TO service_role;

ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit survey" ON public.survey_responses
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Admins view surveys" ON public.survey_responses
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete surveys" ON public.survey_responses
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));