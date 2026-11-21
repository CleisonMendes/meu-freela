-- =====================================================================
-- Meu Freela Dia 2.0 — esquema PostgreSQL para o Supabase
-- Rode UMA vez, em um projeto novo: SQL Editor > New query > colar > Run.
-- Dinheiro sempre em centavos inteiros (bigint).
-- Acessos: owner (dono), manager (gerente) e member (Garçom, Caixa ou Bar com login).
-- Cozinha não tem login. Só garçons têm vendas.
-- Regra central: todos veem tudo; cada integrante só edita o que é dele;
-- dono e gerentes fecham o dia, confirmam pagamentos e editam a equipe.
-- =====================================================================
begin;

-- ---------- 1) Tabelas ----------
create table public.members (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) > 0),
  role            text not null check (role in ('Garçom','Caixa','Bar','Cozinha')),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  deactivated_at  timestamptz
);

-- Quem entra no sistema. Cada integrante com login (member) aponta para o seu cadastro em members.
create table public.app_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  access     text not null check (access in ('owner','manager','member')),
  member_id  uuid unique references members(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (access <> 'member' or member_id is not null)
);

create table public.days (
  date              date primary key,
  status            text not null default 'open' check (status in ('open','closed')),
  due_date          date,
  team_sales_cents  bigint check (team_sales_cents >= 0),
  team_sales_status text check (team_sales_status in ('confirmed','estimated')),
  closing           jsonb,               -- foto congelada do fechamento
  closed_at         timestamptz,
  closed_by         uuid,
  created_at        timestamptz not null default now(),
  check ((status = 'closed') = (closing is not null))
);

create table public.day_entries (
  day_date     date   not null references days(date)   on delete restrict,
  member_id    uuid   not null references members(id)  on delete restrict,
  present      boolean not null default false,
  sales_cents  bigint not null default 0 check (sales_cents >= 0),
  sales_status text   not null default 'confirmed' check (sales_status in ('confirmed','estimated')),
  tips_cents   bigint not null default 0 check (tips_cents >= 0),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  primary key (day_date, member_id)
);

-- Ajuste excepcional da base do bônus: só dono/gerente (o garçom não mexe no próprio bônus).
create table public.bonus_adjustments (
  day_date            date not null references days(date)  on delete restrict,
  member_id           uuid not null references members(id) on delete restrict,
  original_base_cents bigint not null check (original_base_cents >= 0),
  adjusted_base_cents bigint not null check (adjusted_base_cents >= 0),
  reason              text not null check (length(trim(reason)) > 0),
  created_at          timestamptz not null default now(),
  created_by          uuid,
  primary key (day_date, member_id)
);

-- Pagamentos só são inseridos; o estorno marca o registro, nunca apaga.
create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  day_date     date not null references days(date)  on delete restrict,
  member_id    uuid not null references members(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  paid_at      date not null,
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  voided_at    timestamptz,
  voided_by    uuid,
  void_reason  text,
  check ((voided_at is null) = (void_reason is null))
);
create index payments_member_day_idx on public.payments (member_id, day_date);

-- Meta mensal: linha 'default' + exceções por mês ('2026-11').
create table public.goals (
  month_key    text primary key check (month_key ~ '^(default|[0-9]{4}-[0-9]{2})$'),
  amount_cents bigint not null check (amount_cents >= 0)
);
insert into public.goals (month_key, amount_cents) values ('default', 400000);

create table public.member_history (
  id          bigint generated always as identity primary key,
  member_id   uuid not null,          -- sem FK: o histórico sobrevive à exclusão
  member_name text not null,
  action      text not null,
  details     text,
  actor       uuid,
  at          timestamptz not null default now()
);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  action     text not null,
  entity     text not null,
  entity_key text,
  details    jsonb
);

-- ---------- 2) Funções de apoio ----------
create or replace function public.my_access() returns text
language sql stable security definer set search_path = public as
$$ select access from public.app_users where user_id = auth.uid() $$;

create or replace function public.my_member_id() returns uuid
language sql stable security definer set search_path = public as
$$ select member_id from public.app_users where user_id = auth.uid() $$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(public.my_access() in ('owner','manager'), false) $$;

create or replace function public.write_audit(p_action text, p_entity text, p_key text, p_details jsonb default null)
returns void language sql security definer set search_path = public as
$$ insert into public.audit_log (actor, action, entity, entity_key, details)
   values (auth.uid(), p_action, p_entity, p_key, p_details) $$;

-- Garçons não criam dias diretamente: pedem ao banco "garanta que o dia existe".
create or replace function public.ensure_day(d date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_access() is null then raise exception 'Sem permissão.'; end if;
  insert into public.days (date) values (d) on conflict (date) do nothing;
end $$;

-- ---------- 3) Gatilhos (regras que valem mesmo fora do app) ----------
create or replace function public.tg_members_biu() returns trigger language plpgsql as $$
begin
  new.name := trim(new.name);
  if tg_op = 'UPDATE' then
    if new.role = 'Cozinha' and old.role <> 'Cozinha'
       and exists (select 1 from public.app_users where member_id = new.id and access = 'member') then
      raise exception 'Este integrante tem login: remova o acesso antes de mudar a função para Cozinha.';
    end if;
    new.updated_at := now();
    if old.active and not new.active then new.deactivated_at := now(); end if;
    if not old.active and new.active then new.deactivated_at := null; end if;
  end if;
  return new;
end $$;
create trigger members_biu before insert or update on public.members
  for each row execute function public.tg_members_biu();

create or replace function public.tg_app_users_guard() returns trigger language plpgsql as $$
declare r text;
begin
  if new.access = 'member' then
    select role into r from public.members where id = new.member_id;
    if r = 'Cozinha' then raise exception 'Integrantes da Cozinha não têm login.'; end if;
  end if;
  return new;
end $$;
create trigger app_users_guard before insert or update on public.app_users
  for each row execute function public.tg_app_users_guard();

create or replace function public.tg_members_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into member_history (member_id, member_name, action, details, actor)
    values (new.id, new.name, 'created', 'Cadastro criado como ' || new.role, auth.uid());
  elsif tg_op = 'UPDATE' then
    if new.name is distinct from old.name then
      insert into member_history (member_id, member_name, action, details, actor)
      values (new.id, new.name, 'updated', 'Nome: ' || old.name || ' → ' || new.name, auth.uid());
    end if;
    if new.role is distinct from old.role then
      insert into member_history (member_id, member_name, action, details, actor)
      values (new.id, new.name, 'role_changed', 'Função: ' || old.role || ' → ' || new.role, auth.uid());
    end if;
    if new.active is distinct from old.active then
      insert into member_history (member_id, member_name, action, details, actor)
      values (new.id, new.name, case when new.active then 'reactivated' else 'deactivated' end, null, auth.uid());
    end if;
  else
    insert into member_history (member_id, member_name, action, details, actor)
    values (old.id, old.name, 'deleted', 'Cadastro excluído', auth.uid());
  end if;
  return null;
end $$;
create trigger members_history after insert or update or delete on public.members
  for each row execute function public.tg_members_history();

create or replace function public.tg_days_biu() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.due_date := coalesce(new.due_date, new.date + 3);   -- previsão padrão: 3 dias depois
  else
    if new.date <> old.date then raise exception 'A data do dia não pode ser alterada.'; end if;
    if old.status = 'closed' and new.status = 'closed' and new.closing is distinct from old.closing then
      raise exception 'Dia fechado: reabra antes de alterar o fechamento.';
    end if;
    if old.status = 'open' and new.status = 'closed' then
      new.closed_at := now(); new.closed_by := auth.uid();
    elsif old.status = 'closed' and new.status = 'open' then
      new.closed_at := null; new.closed_by := null;
    end if;
  end if;
  return new;
end $$;
create trigger days_biu before insert or update on public.days
  for each row execute function public.tg_days_biu();

create or replace function public.tg_days_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    perform public.write_audit(
      case when new.status = 'closed' then 'day_closed' else 'day_reopened' end,
      'day', new.date::text, jsonb_build_object('status', new.status));
  end if;
  return null;
end $$;
create trigger days_audit after update on public.days
  for each row execute function public.tg_days_audit();

create or replace function public.tg_entries_guard() returns trigger language plpgsql as $$
declare st text; r text; d date := coalesce(new.day_date, old.day_date);
begin
  select status into st from public.days where date = d;
  if st is distinct from 'open' then
    raise exception 'O dia % está fechado: não é possível alterar lançamentos.', d;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.sales_cents > 0 then
    select role into r from public.members where id = new.member_id;
    if r is distinct from 'Garçom' then
      raise exception 'Só garçons têm vendas lançadas.';
    end if;
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
create trigger day_entries_guard before insert or update or delete on public.day_entries
  for each row execute function public.tg_entries_guard();

create or replace function public.tg_bonus_guard() returns trigger language plpgsql as $$
declare st text; d date := coalesce(new.day_date, old.day_date);
begin
  select status into st from public.days where date = d;
  if st is distinct from 'open' then
    raise exception 'O dia % está fechado: não é possível ajustar o bônus.', d;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.created_by := auth.uid();
  return new;
end $$;
create trigger bonus_guard before insert or update or delete on public.bonus_adjustments
  for each row execute function public.tg_bonus_guard();

create or replace function public.tg_bonus_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.write_audit('bonus_adjustment_removed', 'bonus', old.day_date::text || '/' || old.member_id::text, null);
  else
    perform public.write_audit('bonus_adjusted', 'bonus', new.day_date::text || '/' || new.member_id::text,
      jsonb_build_object('original', new.original_base_cents, 'adjusted', new.adjusted_base_cents, 'reason', new.reason));
  end if;
  return null;
end $$;
create trigger bonus_audit after insert or update or delete on public.bonus_adjustments
  for each row execute function public.tg_bonus_audit();

create or replace function public.tg_payments_guard() returns trigger language plpgsql as $$
declare st text;
begin
  if tg_op = 'INSERT' then
    select status into st from public.days where date = new.day_date;
    if st is distinct from 'closed' then
      raise exception 'Só é possível registrar pagamento de um dia fechado.';
    end if;
    new.created_by := auth.uid();
    return new;
  end if;
  -- UPDATE: só o estorno é permitido
  if old.voided_at is not null then raise exception 'Este pagamento já foi estornado.'; end if;
  if (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason')
     is distinct from (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason') then
    raise exception 'Pagamentos não podem ser editados: estorne e registre de novo.';
  end if;
  if new.void_reason is null or length(trim(new.void_reason)) = 0 then
    raise exception 'Informe o motivo do estorno.';
  end if;
  new.voided_at := now(); new.voided_by := auth.uid();
  return new;
end $$;
create trigger payments_guard before insert or update on public.payments
  for each row execute function public.tg_payments_guard();

create or replace function public.tg_payments_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit('payment_registered', 'payment', new.id::text,
      jsonb_build_object('member_id', new.member_id, 'day', new.day_date, 'amount_cents', new.amount_cents));
  else
    perform public.write_audit('payment_voided', 'payment', new.id::text,
      jsonb_build_object('member_id', new.member_id, 'amount_cents', new.amount_cents, 'reason', new.void_reason));
  end if;
  return null;
end $$;
create trigger payments_audit after insert or update on public.payments
  for each row execute function public.tg_payments_audit();

-- ---------- 4) Permissões (RLS) ----------
alter table public.members           enable row level security;
alter table public.app_users         enable row level security;
alter table public.days              enable row level security;
alter table public.day_entries       enable row level security;
alter table public.bonus_adjustments enable row level security;
alter table public.payments          enable row level security;
alter table public.goals             enable row level security;
alter table public.member_history    enable row level security;
alter table public.audit_log         enable row level security;

-- Leitura: qualquer pessoa cadastrada em app_users vê tudo.
create policy members_read   on public.members           for select to authenticated using (public.my_access() is not null);
create policy days_read      on public.days              for select to authenticated using (public.my_access() is not null);
create policy entries_read   on public.day_entries       for select to authenticated using (public.my_access() is not null);
create policy bonus_read     on public.bonus_adjustments for select to authenticated using (public.my_access() is not null);
create policy payments_read  on public.payments          for select to authenticated using (public.my_access() is not null);
create policy goals_read     on public.goals             for select to authenticated using (public.my_access() is not null);
create policy history_read   on public.member_history    for select to authenticated using (public.is_staff());
create policy audit_read     on public.audit_log         for select to authenticated using (public.is_staff());
create policy app_users_read on public.app_users         for select to authenticated using (user_id = auth.uid() or public.is_staff());

-- Escrita de dono e gerentes: equipe, dias/fechamentos, ajustes de bônus, metas.
create policy members_staff on public.members           for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy days_staff    on public.days              for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy bonus_staff   on public.bonus_adjustments for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy goals_staff   on public.goals             for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Só o dono cria e remove acessos.
create policy app_users_owner on public.app_users for all to authenticated
  using (public.my_access() = 'owner') with check (public.my_access() = 'owner');

-- Lançamentos do dia: staff em qualquer pessoa; integrante com login somente no próprio.
create policy entries_insert on public.day_entries for insert to authenticated
  with check (public.is_staff() or (public.my_access() = 'member' and member_id = public.my_member_id()));
create policy entries_update on public.day_entries for update to authenticated
  using      (public.is_staff() or (public.my_access() = 'member' and member_id = public.my_member_id()))
  with check (public.is_staff() or (public.my_access() = 'member' and member_id = public.my_member_id()));
create policy entries_delete on public.day_entries for delete to authenticated using (public.is_staff());

-- Pagamentos: staff para qualquer pessoa; integrante confirma/estorna só o que é dele. Sem DELETE.
create policy payments_insert on public.payments for insert to authenticated
  with check (public.is_staff() or (public.my_access() = 'member' and member_id = public.my_member_id()));
create policy payments_update on public.payments for update to authenticated
  using      (public.is_staff() or (public.my_access() = 'member' and member_id = public.my_member_id()))
  with check (public.is_staff() or (public.my_access() = 'member' and member_id = public.my_member_id()));

-- ---------- 5) Privilégios ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.members, public.app_users, public.days,
      public.day_entries, public.bonus_adjustments, public.goals to authenticated;
grant select, insert, update on public.payments to authenticated;   -- sem delete
grant select on public.member_history, public.audit_log to authenticated;
grant execute on function public.my_access(), public.my_member_id(), public.is_staff(),
      public.ensure_day(date) to authenticated;

commit;

-- =====================================================================
-- PASSO MANUAL (depois de criar o seu usuário em Authentication > Users):
-- troque o e-mail abaixo pelo seu e rode:
--
-- insert into public.app_users (user_id, access)
-- select id, 'owner' from auth.users where email = 'SEU-EMAIL@exemplo.com';
-- =====================================================================