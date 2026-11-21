-- Meu Freela Dev: acompanhamento de previsões e confirmação / contestação.
-- Execute somente após schema.sql e migração 003, em banco de desenvolvimento.
BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  due_date date NOT NULL,
  expected_amount_cents bigint CHECK (expected_amount_cents IS NULL OR expected_amount_cents >= 0),
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  UNIQUE(member_id, work_date)
);

CREATE TABLE IF NOT EXISTS public.payment_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES public.payments(id) ON DELETE RESTRICT,
  plan_id uuid REFERENCES public.payment_plans(id) ON DELETE RESTRICT,
  response text NOT NULL CHECK (response IN ('received','dispute')),
  proposed_amount_cents bigint CHECK (proposed_amount_cents IS NULL OR proposed_amount_cents >= 0),
  reason text,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','resolved')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feedback_exactly_one_target CHECK ((payment_id IS NULL) <> (plan_id IS NULL)),
  CONSTRAINT feedback_reason_required CHECK (response <> 'dispute' OR length(trim(coalesce(reason,''))) >= 5),
  CONSTRAINT feedback_received_only_payment CHECK (response <> 'received' OR payment_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_feedback_payment_unique ON public.payment_feedback(payment_id) WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_feedback_plan_unique ON public.payment_feedback(plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_feedback_member_idx ON public.payment_feedback(member_id);

ALTER TABLE public.payment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_plans_read ON public.payment_plans FOR SELECT TO authenticated
USING (public.is_staff() OR member_id = public.my_member_id());
CREATE POLICY payment_plans_staff_insert ON public.payment_plans FOR INSERT TO authenticated
WITH CHECK (public.is_staff());
CREATE POLICY payment_plans_staff_update ON public.payment_plans FOR UPDATE TO authenticated
USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY payment_plans_staff_delete ON public.payment_plans FOR DELETE TO authenticated
USING (public.is_staff());
CREATE POLICY payment_feedback_read ON public.payment_feedback FOR SELECT TO authenticated
USING (public.is_staff() OR member_id = public.my_member_id());
CREATE POLICY payment_feedback_staff_update ON public.payment_feedback FOR UPDATE TO authenticated
USING (public.is_staff()) WITH CHECK (public.is_staff());

-- Uma função segura é a ÚNICA forma de o integrante criar/alterar sua resposta.
CREATE OR REPLACE FUNCTION public.answer_payment(
  p_payment_id uuid,
  p_response text,
  p_proposed_amount_cents bigint DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member_id uuid;
BEGIN
  v_member_id := public.my_member_id();
  IF auth.uid() IS NULL OR public.my_access() <> 'member' OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'Somente o próprio integrante pode responder.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.id = p_payment_id AND p.member_id = v_member_id AND p.voided_at IS NULL) THEN
    RAISE EXCEPTION 'Pagamento não encontrado ou estornado.';
  END IF;
  IF p_response NOT IN ('received','dispute') THEN RAISE EXCEPTION 'Resposta inválida.'; END IF;
  IF p_response = 'dispute' AND (length(trim(coalesce(p_reason,''))) < 5 OR p_proposed_amount_cents IS NULL OR p_proposed_amount_cents < 0) THEN
    RAISE EXCEPTION 'Informe o valor que considera correto e a justificativa (mínimo 5 caracteres).';
  END IF;
  IF p_response = 'received' THEN
    p_proposed_amount_cents := NULL; p_reason := NULL;
  END IF;
  INSERT INTO public.payment_feedback(member_id,payment_id,response,proposed_amount_cents,reason)
  VALUES(v_member_id,p_payment_id,p_response,p_proposed_amount_cents,trim(p_reason))
  ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO UPDATE
  SET response = EXCLUDED.response, proposed_amount_cents = EXCLUDED.proposed_amount_cents,
      reason = EXCLUDED.reason, review_status = 'pending', reviewed_by = NULL,
      reviewed_at = NULL, updated_at = now()
  WHERE public.payment_feedback.member_id = v_member_id;
END $$;

CREATE OR REPLACE FUNCTION public.dispute_payment_plan(
 p_plan_id uuid, p_proposed_amount_cents bigint, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member_id uuid;
BEGIN
 v_member_id := public.my_member_id();
 IF auth.uid() IS NULL OR public.my_access() <> 'member' OR v_member_id IS NULL THEN
   RAISE EXCEPTION 'Somente o próprio integrante pode contestar.';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.payment_plans WHERE id = p_plan_id AND member_id = v_member_id) THEN
   RAISE EXCEPTION 'Previsão não encontrada.';
 END IF;
 IF p_proposed_amount_cents IS NULL OR p_proposed_amount_cents < 0 OR length(trim(coalesce(p_reason,''))) < 5 THEN
   RAISE EXCEPTION 'Informe um valor válido e uma justificativa de pelo menos 5 caracteres.';
 END IF;
 INSERT INTO public.payment_feedback(member_id,plan_id,response,proposed_amount_cents,reason)
 VALUES(v_member_id,p_plan_id,'dispute',p_proposed_amount_cents,trim(p_reason))
 ON CONFLICT (plan_id) WHERE plan_id IS NOT NULL DO UPDATE
 SET proposed_amount_cents = EXCLUDED.proposed_amount_cents, reason = EXCLUDED.reason,
     review_status = 'pending', reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
 WHERE public.payment_feedback.member_id = v_member_id;
END $$;

REVOKE ALL ON FUNCTION public.answer_payment(uuid,text,bigint,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dispute_payment_plan(uuid,bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.answer_payment(uuid,text,bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispute_payment_plan(uuid,bigint,text) TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_plans TO authenticated;
GRANT SELECT, UPDATE ON public.payment_feedback TO authenticated;
-- Corrige permissão antiga perigosa: integrante não pode criar ou alterar pagamentos.
DROP POLICY IF EXISTS payments_insert ON public.payments;
DROP POLICY IF EXISTS payments_update ON public.payments;
CREATE POLICY payments_insert ON public.payments FOR INSERT TO authenticated WITH CHECK (public.is_staff());
CREATE POLICY payments_update ON public.payments FOR UPDATE TO authenticated
USING (public.is_staff()) WITH CHECK (public.is_staff());

COMMIT;
