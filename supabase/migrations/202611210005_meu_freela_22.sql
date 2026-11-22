-- Meu Freela 2.2 - executar EXCLUSIVAMENTE no Supabase DEV após migrações 001-004.
-- Não contém TRUNCATE, DROP TABLE ou mudanças em auth.users.
BEGIN;

-- Eventos estruturados para auditoria operacional.
CREATE TABLE IF NOT EXISTS public.operation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 at timestamptz NOT NULL DEFAULT now(),
 actor uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
 entity text NOT NULL,
 entity_id uuid,
 action text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS operation_events_at_idx ON public.operation_events(at DESC);
ALTER TABLE public.operation_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operation_events_staff_read ON public.operation_events;
CREATE POLICY operation_events_staff_read ON public.operation_events FOR SELECT TO authenticated USING (public.is_staff());
REVOKE ALL ON public.operation_events FROM anon, authenticated;
GRANT SELECT ON public.operation_events TO authenticated;
GRANT SELECT, INSERT ON public.operation_events TO service_role;

-- Notificações internas de destinatário específico, nunca públicas.
CREATE TABLE IF NOT EXISTS public.app_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 title text NOT NULL CHECK (length(title) BETWEEN 1 AND 150),
 body text NOT NULL DEFAULT '',
 category text NOT NULL DEFAULT 'general',
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz
);
CREATE INDEX IF NOT EXISTS app_notifications_user_idx ON public.app_notifications(recipient_id,created_at DESC);
ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_notifications_read ON public.app_notifications;
CREATE POLICY app_notifications_read ON public.app_notifications FOR SELECT TO authenticated USING (recipient_id = auth.uid());
DROP POLICY IF EXISTS app_notifications_ack ON public.app_notifications;
CREATE POLICY app_notifications_ack ON public.app_notifications FOR UPDATE TO authenticated
 USING (recipient_id = auth.uid()) WITH CHECK (recipient_id = auth.uid());
-- O cliente NÃO recebe INSERT; notificações são geradas por triggers confiáveis.
REVOKE ALL ON public.app_notifications FROM anon, authenticated;
GRANT SELECT ON public.app_notifications TO authenticated;
GRANT UPDATE (read_at) ON public.app_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.app_notifications TO service_role;

-- Gatilho central: registrar alterações sem incluir senhas, tokens ou payload completo.
CREATE OR REPLACE FUNCTION public.log_workflow_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_member uuid; v_id uuid; v_action text; v_details jsonb := '{}'::jsonb;
BEGIN
 IF TG_OP = 'DELETE' THEN
  v_id := OLD.id;
ELSE
  v_id := NEW.id;
END IF;
 v_member := CASE WHEN TG_OP = 'DELETE' THEN OLD.member_id ELSE NEW.member_id END;
 v_action := CASE WHEN TG_OP='INSERT' THEN 'created' WHEN TG_OP='DELETE' THEN 'deleted' ELSE 'updated' END;
 IF TG_TABLE_NAME = 'payments' THEN
   v_details := jsonb_build_object('amount_before',CASE WHEN TG_OP='INSERT' THEN null ELSE OLD.amount_cents END,
     'amount_after',CASE WHEN TG_OP='DELETE' THEN null ELSE NEW.amount_cents END,
     'void_before',CASE WHEN TG_OP='INSERT' THEN null ELSE OLD.voided_at END,
     'void_after',CASE WHEN TG_OP='DELETE' THEN null ELSE NEW.voided_at END);
 ELSIF TG_TABLE_NAME = 'payment_plans' THEN
   v_details := jsonb_build_object('due_before',CASE WHEN TG_OP='INSERT' THEN null ELSE OLD.due_date END,
     'due_after',CASE WHEN TG_OP='DELETE' THEN null ELSE NEW.due_date END,
     'amount_before',CASE WHEN TG_OP='INSERT' THEN null ELSE OLD.expected_amount_cents END,
     'amount_after',CASE WHEN TG_OP='DELETE' THEN null ELSE NEW.expected_amount_cents END);
 ELSIF TG_TABLE_NAME = 'payment_feedback' THEN
   v_details := jsonb_build_object('response', CASE WHEN TG_OP='DELETE' THEN OLD.response ELSE NEW.response END,
     'review_status', CASE WHEN TG_OP='DELETE' THEN OLD.review_status ELSE NEW.review_status END);
 ELSIF TG_TABLE_NAME = 'shift_assignments' THEN
   v_details := jsonb_build_object('date',CASE WHEN TG_OP='DELETE' THEN OLD.work_date ELSE NEW.work_date END,
     'status',CASE WHEN TG_OP='DELETE' THEN OLD.status ELSE NEW.status END,
     'reply_status',CASE WHEN TG_OP='DELETE' THEN OLD.reply_status ELSE NEW.reply_status END);
 END IF;
 INSERT INTO public.operation_events(actor,member_id,entity,entity_id,action,details)
 VALUES(v_actor,v_member,TG_TABLE_NAME,v_id,v_action,v_details);
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.log_workflow_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_workflow_payments ON public.payments;
CREATE TRIGGER audit_workflow_payments AFTER INSERT OR UPDATE OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.log_workflow_change();
DROP TRIGGER IF EXISTS audit_workflow_plans ON public.payment_plans;
CREATE TRIGGER audit_workflow_plans AFTER INSERT OR UPDATE OR DELETE ON public.payment_plans FOR EACH ROW EXECUTE FUNCTION public.log_workflow_change();
DROP TRIGGER IF EXISTS audit_workflow_feedback ON public.payment_feedback;
CREATE TRIGGER audit_workflow_feedback AFTER INSERT OR UPDATE OR DELETE ON public.payment_feedback FOR EACH ROW EXECUTE FUNCTION public.log_workflow_change();
DROP TRIGGER IF EXISTS audit_workflow_shifts ON public.shift_assignments;
CREATE TRIGGER audit_workflow_shifts AFTER INSERT OR UPDATE OR DELETE ON public.shift_assignments FOR EACH ROW EXECUTE FUNCTION public.log_workflow_change();

-- Notificações sobre escalas e pagamentos. Triggers usam privilégios do owner da função.
CREATE OR REPLACE FUNCTION public.notify_workflow_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_recipient uuid; v_title text; v_body text; v_cat text;
BEGIN
 IF TG_TABLE_NAME = 'shift_assignments' THEN
   IF TG_OP='UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status
      AND OLD.start_time IS NOT DISTINCT FROM NEW.start_time
      AND OLD.end_time IS NOT DISTINCT FROM NEW.end_time
      AND OLD.work_date IS NOT DISTINCT FROM NEW.work_date THEN RETURN NEW; END IF;
   v_title := CASE WHEN NEW.status='cancelled' THEN 'Escala cancelada' ELSE 'Escala atualizada' END;
   v_body := 'Confira sua escala de ' || NEW.work_date::text;
   v_cat := 'schedule';
 ELSIF TG_TABLE_NAME='payment_plans' THEN
   v_title := 'Previsão de pagamento'; v_body := 'Confira a previsão para ' || NEW.work_date::text; v_cat := 'payment';
 ELSIF TG_TABLE_NAME='payments' THEN
   IF NEW.voided_at IS NOT NULL THEN v_title := 'Pagamento estornado';
   ELSE v_title := 'Pagamento registrado'; END IF;
   v_body := 'Confira o pagamento do serviço de ' || NEW.day_date::text; v_cat := 'payment';
 ELSE RETURN NEW; END IF;
 FOR v_recipient IN SELECT user_id FROM public.app_users WHERE member_id=NEW.member_id AND access='member'
 LOOP
  INSERT INTO public.app_notifications(recipient_id,title,body,category) VALUES(v_recipient,v_title,v_body,v_cat);
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_workflow_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notify_shift_change ON public.shift_assignments;
CREATE TRIGGER notify_shift_change AFTER INSERT OR UPDATE ON public.shift_assignments FOR EACH ROW EXECUTE FUNCTION public.notify_workflow_change();
DROP TRIGGER IF EXISTS notify_payment_plan_change ON public.payment_plans;
CREATE TRIGGER notify_payment_plan_change AFTER INSERT OR UPDATE ON public.payment_plans FOR EACH ROW EXECUTE FUNCTION public.notify_workflow_change();
DROP TRIGGER IF EXISTS notify_payment_change ON public.payments;
CREATE TRIGGER notify_payment_change AFTER INSERT OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.notify_workflow_change();

-- Alertar gestão quando o integrante confirmar recebimento ou solicitar revisão.
CREATE OR REPLACE FUNCTION public.notify_payment_feedback() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid;
BEGIN
 IF TG_OP = 'INSERT' OR NEW.response IS DISTINCT FROM OLD.response OR NEW.review_status IS DISTINCT FROM OLD.review_status THEN
  IF NEW.review_status = 'pending' THEN
   FOR v_user IN SELECT user_id FROM public.app_users WHERE access IN ('owner','manager') LOOP
    INSERT INTO public.app_notifications(recipient_id,title,body,category)
    VALUES(v_user,CASE WHEN NEW.response='dispute' THEN 'Contestação financeira' ELSE 'Recebimento confirmado' END,
      'Há uma nova resposta para analisar em Pagamentos.', 'payment');
   END LOOP;
  ELSE
   FOR v_user IN SELECT user_id FROM public.app_users WHERE member_id=NEW.member_id AND access='member' LOOP
    INSERT INTO public.app_notifications(recipient_id,title,body,category)
    VALUES(v_user,'Contestação analisada','Confira sua solicitação de correção.', 'payment');
   END LOOP;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_payment_feedback() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notify_payment_feedback_change ON public.payment_feedback;
CREATE TRIGGER notify_payment_feedback_change AFTER INSERT OR UPDATE ON public.payment_feedback
FOR EACH ROW EXECUTE FUNCTION public.notify_payment_feedback();

-- Cópia de escalas é atômica; conflito de horário continua protegido pelo trigger existente.
CREATE OR REPLACE FUNCTION public.copy_schedule_week(p_source_monday date, p_destination_monday date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer := 0; v_row record; v_day date;
BEGIN
 IF NOT public.is_staff() THEN RAISE EXCEPTION 'Somente gestão pode copiar escalas.'; END IF;
 IF p_source_monday IS NULL OR p_destination_monday IS NULL OR p_source_monday=p_destination_monday THEN
   RAISE EXCEPTION 'Selecione duas semanas diferentes.';
 END IF;
 IF EXTRACT(ISODOW FROM p_source_monday) <> 1 OR EXTRACT(ISODOW FROM p_destination_monday) <> 1 THEN
   RAISE EXCEPTION 'As datas devem corresponder a segundas-feiras.';
 END IF;
 FOR v_row IN SELECT * FROM public.shift_assignments WHERE status='confirmed'
   AND work_date BETWEEN p_source_monday AND p_source_monday + 6 ORDER BY work_date,start_time LOOP
  v_day := p_destination_monday + (v_row.work_date - p_source_monday);
  IF NOT EXISTS (SELECT 1 FROM public.shift_assignments WHERE member_id=v_row.member_id AND work_date=v_day
     AND start_time=v_row.start_time AND end_time=v_row.end_time AND status='confirmed') THEN
    INSERT INTO public.shift_assignments(member_id,work_date,start_time,end_time,template_id,notes,created_by)
    VALUES(v_row.member_id,v_day,v_row.start_time,v_row.end_time,v_row.template_id,v_row.notes,auth.uid());
    v_count := v_count + 1;
  END IF;
 END LOOP;
 RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.copy_schedule_week(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.copy_schedule_week(date,date) TO authenticated;

-- Cancelamento em lote, sem exclusão física e com auditoria no trigger.
CREATE OR REPLACE FUNCTION public.cancel_schedule_day(p_day date, p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
 IF NOT public.is_staff() THEN RAISE EXCEPTION 'Somente gestão pode cancelar escalas.'; END IF;
 IF length(trim(coalesce(p_reason,''))) < 5 THEN RAISE EXCEPTION 'Informe motivo com pelo menos 5 caracteres.'; END IF;
 UPDATE public.shift_assignments SET status='cancelled',notes=left(trim(p_reason),300)
 WHERE work_date=p_day AND status='confirmed';
 GET DIAGNOSTICS v_count = ROW_COUNT;
 RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.cancel_schedule_day(date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_schedule_day(date,text) TO authenticated;
-- Alteração de horário em lote com validação de conflitos transacional.
CREATE OR REPLACE FUNCTION public.reschedule_shifts(p_ids uuid[], p_start time, p_end time, p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
 IF NOT public.is_staff() THEN RAISE EXCEPTION 'Somente gestão pode editar escalas.'; END IF;
 IF p_ids IS NULL OR cardinality(p_ids)=0 OR cardinality(p_ids)>50 THEN RAISE EXCEPTION 'Selecione de 1 a 50 turnos.'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_start=p_end THEN RAISE EXCEPTION 'Horários inválidos.'; END IF;
 IF length(trim(coalesce(p_reason,''))) < 5 THEN RAISE EXCEPTION 'Informe uma justificativa de pelo menos 5 caracteres.'; END IF;
 UPDATE public.shift_assignments
 SET start_time=p_start,end_time=p_end,notes=left(trim(p_reason),300),reply_status='pending',reply_note=NULL,replied_at=NULL
 WHERE id=ANY(p_ids) AND status='confirmed';
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count <> (SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN
   RAISE EXCEPTION 'Uma ou mais escalas não existem ou foram canceladas.';
 END IF;
 RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.reschedule_shifts(uuid[],time,time,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reschedule_shifts(uuid[],time,time,text) TO authenticated;
COMMIT;
