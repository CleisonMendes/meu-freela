-- Meu Freela 2.1 | Complemento de Escalas - SOMENTE SUPABASE DEV
-- Depende da migração 202611210001_schedule.sql já aplicada.
-- Aditiva: preserva as escalas e disponibilidades existentes.
BEGIN;

CREATE TABLE public.shift_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date date NOT NULL,
  role text NOT NULL CHECK (role IN ('Garçom', 'Caixa', 'Bar', 'Cozinha')),
  required_count integer NOT NULL CHECK (required_count BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_date, role)
);
CREATE INDEX shift_requirements_date_idx ON public.shift_requirements (work_date);

ALTER TABLE public.shift_assignments
  ADD COLUMN reply_status text NOT NULL DEFAULT 'pending'
    CHECK (reply_status IN ('pending', 'accepted', 'declined')),
  ADD COLUMN reply_note text CHECK (length(reply_note) <= 300),
  ADD COLUMN replied_at timestamptz;

ALTER TABLE public.shift_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY shift_requirements_read ON public.shift_requirements FOR SELECT TO authenticated
  USING (public.my_access() IS NOT NULL);
CREATE POLICY shift_requirements_insert ON public.shift_requirements FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY shift_requirements_update ON public.shift_requirements FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY shift_requirements_delete ON public.shift_requirements FOR DELETE TO authenticated
  USING (public.is_staff());

-- Um freelancer só poderá alterar o próprio retorno da escala.
CREATE POLICY shift_member_reply ON public.shift_assignments FOR UPDATE TO authenticated
  USING (public.my_access() = 'member' AND member_id = public.my_member_id() AND status = 'confirmed')
  WITH CHECK (public.my_access() = 'member' AND member_id = public.my_member_id() AND status = 'confirmed');

-- A política UPDATE acima, isoladamente, não restringe colunas.
-- Este trigger impede que o integrante altere horário, data, pessoa ou estado oficial.
CREATE OR REPLACE FUNCTION public.guard_shift_member_reply()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF public.my_access() = 'member' THEN
    IF OLD.member_id IS DISTINCT FROM public.my_member_id() OR OLD.status <> 'confirmed' THEN
      RAISE EXCEPTION 'Você só pode responder às suas escalas confirmadas.';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['reply_status','reply_note','replied_at','updated_at'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['reply_status','reply_note','replied_at','updated_at']) THEN
      RAISE EXCEPTION 'Integrantes não podem modificar dados da escala.';
    END IF;
    IF NEW.reply_status NOT IN ('accepted','declined') THEN
      RAISE EXCEPTION 'Escolha confirmar presença ou informar que não poderá comparecer.';
    END IF;
    IF NEW.reply_status = 'declined' AND length(btrim(coalesce(NEW.reply_note, ''))) = 0 THEN
      RAISE EXCEPTION 'Informe um motivo para não comparecer.';
    END IF;
    NEW.replied_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shift_member_reply_guard
BEFORE UPDATE ON public.shift_assignments
FOR EACH ROW EXECUTE FUNCTION public.guard_shift_member_reply();

-- Revogação e concessão restritas às tabelas do módulo.
REVOKE ALL ON public.shift_requirements FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_requirements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_requirements TO service_role;
GRANT SELECT, UPDATE ON public.shift_assignments TO authenticated;
REVOKE ALL ON FUNCTION public.guard_shift_member_reply() FROM PUBLIC, anon, authenticated;
COMMIT;
