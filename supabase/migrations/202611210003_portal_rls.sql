-- Meu Freela 2.1 — Portal individual. EXECUTAR SOMENTE no Supabase DEV.
-- Ajusta leitura sem ampliar privilégios: equipe gestora vê tudo;
-- freelancers veem apenas registros vinculados ao seu member_id.
-- IMPORTANTE: o frontend atualizado evita carregar dados globais quando access='member'.
BEGIN;

DROP POLICY IF EXISTS members_read ON public.members;
CREATE POLICY members_read ON public.members FOR SELECT TO authenticated
USING (public.is_staff() OR (public.my_access() = 'member' AND id = public.my_member_id()));

DROP POLICY IF EXISTS days_read ON public.days;
CREATE POLICY days_read ON public.days FOR SELECT TO authenticated
USING (public.is_staff());
-- days.closing armazena JSON financeiro de toda a equipe: nunca expor a integrantes.

DROP POLICY IF EXISTS entries_read ON public.day_entries;
CREATE POLICY entries_read ON public.day_entries FOR SELECT TO authenticated
USING (public.is_staff() OR (public.my_access() = 'member' AND member_id = public.my_member_id()));

DROP POLICY IF EXISTS bonus_read ON public.bonus_adjustments;
CREATE POLICY bonus_read ON public.bonus_adjustments FOR SELECT TO authenticated
USING (public.is_staff() OR (public.my_access() = 'member' AND member_id = public.my_member_id()));

DROP POLICY IF EXISTS payments_read ON public.payments;
CREATE POLICY payments_read ON public.payments FOR SELECT TO authenticated
USING (public.is_staff() OR (public.my_access() = 'member' AND member_id = public.my_member_id()));

DROP POLICY IF EXISTS goals_read ON public.goals;
CREATE POLICY goals_read ON public.goals FOR SELECT TO authenticated USING (public.is_staff());

-- Evita expor operações da equipe para integrantes; histórico e auditoria
-- já possuem SELECT restrito a staff no schema original.
COMMIT;