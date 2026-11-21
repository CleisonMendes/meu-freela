-- Meu Freela 2.1 — módulo de escalas (ambiente de homologação primeiro)
-- Migração aditiva: não altera nem apaga cadastros, dias ou pagamentos existentes.
BEGIN;

CREATE TABLE public.shift_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  start_time time NOT NULL,
  end_time time NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  CONSTRAINT distinct_template_times CHECK (start_time <> end_time)
);

CREATE TABLE public.member_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  note text CHECK (length(note) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT distinct_availability_times CHECK (start_time <> end_time),
  CONSTRAINT availability_unique UNIQUE(member_id, work_date, start_time, end_time)
);

CREATE TABLE public.shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  template_id uuid REFERENCES public.shift_templates(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  notes text CHECK (length(notes) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT distinct_shift_times CHECK (start_time <> end_time)
);
CREATE INDEX schedule_by_date ON public.shift_assignments(work_date, status);
CREATE INDEX schedule_by_member ON public.shift_assignments(member_id, work_date);
CREATE INDEX availability_by_date ON public.member_availability(work_date, member_id);

-- As horas são locais do estabelecimento. end <= start significa saída no dia seguinte.
-- Evita sobreposição de escalas inclusive para turnos noturnos e chamadas simultâneas.
CREATE OR REPLACE FUNCTION public.guard_shift_assignment()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE begin_at timestamp; finish_at timestamp;
BEGIN
  IF NEW.status = 'confirmed' THEN
    IF NOT EXISTS (SELECT 1 FROM public.members WHERE id = NEW.member_id AND active) THEN
      RAISE EXCEPTION 'Integrante inexistente ou inativo.';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext(NEW.member_id::text));
    begin_at := NEW.work_date + NEW.start_time;
    finish_at := NEW.work_date + NEW.end_time + CASE WHEN NEW.end_time <= NEW.start_time THEN interval '1 day' ELSE interval '0 day' END;
    IF EXISTS (
      SELECT 1 FROM public.shift_assignments s
      WHERE s.member_id = NEW.member_id AND s.status = 'confirmed'
        AND s.id IS DISTINCT FROM NEW.id
        AND tsrange(begin_at,finish_at,'[)') &&
          tsrange(s.work_date + s.start_time,
                  s.work_date + s.end_time + CASE WHEN s.end_time <= s.start_time THEN interval '1 day' ELSE interval '0 day' END,
                  '[)')
    ) THEN
      RAISE EXCEPTION 'Conflito: integrante já escalado nesse intervalo.';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER shift_assignment_guard BEFORE INSERT OR UPDATE ON public.shift_assignments
 FOR EACH ROW EXECUTE FUNCTION public.guard_shift_assignment();

ALTER TABLE public.shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_assignments ENABLE ROW LEVEL SECURITY;

-- Modelos: todos os usuários cadastrados podem consultar, somente equipe gestora altera.
CREATE POLICY template_read ON public.shift_templates FOR SELECT TO authenticated
 USING (public.my_access() IS NOT NULL);
CREATE POLICY template_staff_insert ON public.shift_templates FOR INSERT TO authenticated
 WITH CHECK (public.is_staff());
CREATE POLICY template_staff_update ON public.shift_templates FOR UPDATE TO authenticated
 USING (public.is_staff()) WITH CHECK (public.is_staff());

-- Disponibilidade: integrante vê/escreve a própria; equipe gestora vê todas.
CREATE POLICY availability_read ON public.member_availability FOR SELECT TO authenticated
 USING (public.is_staff() OR (public.my_access() = 'member' AND member_id = public.my_member_id()));
CREATE POLICY availability_insert ON public.member_availability FOR INSERT TO authenticated
 WITH CHECK (public.is_staff() OR (public.my_access() = 'member' AND member_id = public.my_member_id()));
CREATE POLICY availability_update ON public.member_availability FOR UPDATE TO authenticated
 USING (public.is_staff() OR (public.my_access() = 'member' AND member_id = public.my_member_id()))
 WITH CHECK (public.is_staff() OR (public.my_access() = 'member' AND member_id = public.my_member_id()));
CREATE POLICY availability_delete ON public.member_availability FOR DELETE TO authenticated
 USING (public.is_staff() OR (public.my_access() = 'member' AND member_id = public.my_member_id()));

-- Escala oficial: membro vê SOMENTE a própria; equipe gestora vê/edita todas.
CREATE POLICY assignment_read ON public.shift_assignments FOR SELECT TO authenticated
 USING (public.is_staff() OR (public.my_access() = 'member' AND member_id = public.my_member_id()));
CREATE POLICY assignment_staff_insert ON public.shift_assignments FOR INSERT TO authenticated
 WITH CHECK (public.is_staff());
CREATE POLICY assignment_staff_update ON public.shift_assignments FOR UPDATE TO authenticated
 USING (public.is_staff()) WITH CHECK (public.is_staff());

REVOKE ALL ON public.shift_templates, public.member_availability, public.shift_assignments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.shift_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_availability TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.shift_assignments TO authenticated;
REVOKE ALL ON FUNCTION public.guard_shift_assignment() FROM PUBLIC, anon, authenticated;
COMMIT;
