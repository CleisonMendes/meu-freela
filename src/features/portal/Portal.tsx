import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, Wallet, RefreshCw, ArrowUpRight, Sparkles, CalendarClock, TrendingUp } from "lucide-react";
import { supabase } from "../../lib/supabase";
import type { Me } from "../../auth/access";
import "./portal.css";

type Member = { id: string; name: string; role: string };
type Shift = { id: string; work_date: string; start_time: string; end_time: string; status: string; reply_status: string; reply_note: string | null };
type Entry = { day_date: string; present: boolean; sales_cents: number; tips_cents: number };
type Payment = { id: string; day_date: string; paid_at: string; amount_cents: number; voided_at: string | null };
type Plan = { id: string; work_date: string; due_date: string; expected_amount_cents: number | null };
type Availability = { id: string; work_date: string; start_time: string; end_time: string };
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const localDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");
const time = (value: string) => value.slice(0, 5);

export default function Portal({ me, goToSchedule, goToPayments }: { me: Me; goToSchedule: () => void; goToPayments: () => void }) {
  const [member, setMember] = useState<Member | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [availabilities, setAvailabilities] = useState<Availability[]>([]);
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!supabase || !me.memberId) return;
    setBusy(true);
    setError("");
    try {
      // O filtro no cliente melhora a consulta; o RLS da migração 003 é a proteção real.
      const [m, s, e, p, a, forecasts] = await Promise.all([
        supabase.from("members").select("id,name,role").eq("id", me.memberId).single(),
        supabase.from("shift_assignments").select("id,work_date,start_time,end_time,status,reply_status,reply_note").eq("member_id", me.memberId).order("work_date", { ascending: false }).limit(60),
        supabase.from("day_entries").select("day_date,present,sales_cents,tips_cents").eq("member_id", me.memberId).order("day_date", { ascending: false }).limit(90),
        supabase.from("payments").select("id,day_date,paid_at,amount_cents,voided_at").eq("member_id", me.memberId).order("paid_at", { ascending: false }).limit(90),
        supabase.from("member_availability").select("id,work_date,start_time,end_time").eq("member_id", me.memberId).order("work_date", { ascending: false }).limit(60),
        supabase.from("payment_plans").select("id,work_date,due_date,expected_amount_cents").eq("member_id",me.memberId).order("work_date",{ascending:false}).limit(90),
      ]);
      const firstError = m.error || s.error || e.error || p.error || a.error || forecasts.error;
      if (firstError) throw firstError;
      setMember(m.data as Member);
      setShifts((s.data ?? []) as Shift[]);
      setEntries((e.data ?? []) as Entry[]);
      setPayments((p.data ?? []) as Payment[]);
      setAvailabilities((a.data ?? []) as Availability[]);
      setPlans((forecasts.data ?? []) as Plan[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar seus dados.");
    } finally {
      setBusy(false);
    }
  }, [me.memberId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const totalReceived = useMemo(() => payments.filter(p => !p.voided_at).reduce((sum, p) => sum + p.amount_cents, 0), [payments]);
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
  const weekStartDate = new Date(now); weekStartDate.setDate(now.getDate() - ((now.getDay()+6)%7));
  const weekStart = `${weekStartDate.getFullYear()}-${String(weekStartDate.getMonth()+1).padStart(2,"0")}-${String(weekStartDate.getDate()).padStart(2,"0")}`;
  const paidMonth = payments.filter(p=>!p.voided_at && p.paid_at.slice(0,10)>=monthStart).reduce((sum,p)=>sum+p.amount_cents,0);
  const paidWeek = payments.filter(p=>!p.voided_at && p.paid_at.slice(0,10)>=weekStart).reduce((sum,p)=>sum+p.amount_cents,0);
  const expected = plans.reduce((sum,p)=>sum+(p.expected_amount_cents??0),0);
  const matchedPaid = payments.filter(p=>!p.voided_at && plans.some(f=>f.work_date===p.day_date)).reduce((sum,p)=>sum+p.amount_cents,0);
  const pendingEstimate = Math.max(0,expected-matchedPaid);
  const nextDue = plans.filter(p=>p.due_date>=new Date().toISOString().slice(0,10)).sort((a,b)=>a.due_date.localeCompare(b.due_date))[0];
  const completedDays = useMemo(() => entries.filter(e => e.present).length, [entries]);
  const upcoming = useMemo(() => {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return shifts.filter(s => s.status === "confirmed" && s.work_date >= todayIso).sort((a, b) => a.work_date.localeCompare(b.work_date)).slice(0, 8);
  }, [shifts]);
  if (!me.memberId) return <section className="content-card"><h3>Cadastro não vinculado</h3><p>Seu login precisa estar associado a uma pessoa cadastrada na equipe. Solicite ao dono do sistema.</p></section>;

  return <section className="content-card portal">
    <div className="portal-hero">
      <div className="portal-hero-copy">
        <span className="portal-hero-kicker"><Sparkles size={14} /> SEU PAINEL PESSOAL</span>
        <h2>Olá, {member?.name?.split(" ")[0] ?? "freelancer"}<span className="portal-wave" aria-hidden="true"> ✦</span></h2>
        <p>Acompanhe seus turnos, seus ganhos e o que vem pela frente. Tudo em um só lugar.</p>
        <div className="portal-hero-meta"><span className="portal-role-chip">{member?.role ?? "Integrante"}</span><span><CalendarClock size={14} /> {upcoming.length ? `Próxima escala: ${localDate(upcoming[0].work_date)}` : "Sem escalas futuras"}</span></div>
        <div className="portal-hero-actions"><button type="button" className="primary-button" onClick={goToPayments}>Ver meus pagamentos <ArrowUpRight size={16}/></button><button type="button" className="portal-hero-secondary" onClick={goToSchedule}>Minhas escalas <CalendarDays size={15}/></button></div>
      </div>
      <div className="portal-hero-art" aria-hidden="true"><span className="portal-hero-orbit orbit-one"/><span className="portal-hero-orbit orbit-two"/><div className="portal-hero-money"><small>RECEBIDO NO MÊS</small><strong>{money(paidMonth)}</strong><span><TrendingUp size={15}/> Seu resumo financeiro</span></div></div>
      <button type="button" className="portal-refresh" onClick={() => void refresh()} disabled={busy} aria-label="Atualizar meu espaço"><RefreshCw size={17} className={busy ? "portal-spinning" : ""}/></button>
    </div>
    {error && <div role="alert" className="sync-error">{error}</div>}
    <div className="portal-section-intro"><div><span className="eyebrow">VISÃO RÁPIDA</span><h3>Seu resumo</h3></div><span>Informações atualizadas do seu cadastro</span></div>
    <div className="portal-kpis">
      <article><CalendarDays size={20}/><span>Dias com presença (até 90 registros)</span><strong>{completedDays}</strong></article>
      <article><Wallet size={20}/><span>Pagamentos recebidos (até 90 registros)</span><strong>{money(totalReceived)}</strong></article>
      <article><Clock3 size={20}/><span>Próximas escalas</span><strong>{upcoming.length}</strong></article>
      <article><CheckCircle2 size={20}/><span>Disponibilidades recentes</span><strong>{availabilities.length}</strong></article>
    </div>
    <div className="portal-section-intro"><div><span className="eyebrow">FINANCEIRO</span><h3>Seus recebimentos</h3></div><button type="button" className="portal-inline-link" onClick={goToPayments}>Ver histórico <ArrowUpRight size={15}/></button></div>
    <div className="mf22-portal-finance"><article><small>Recebido nesta semana</small><strong>{money(paidWeek)}</strong></article><article><small>Recebido neste mês</small><strong>{money(paidMonth)}</strong></article><article><small>Saldo previsto*</small><strong>{money(pendingEstimate)}</strong></article><article><small>Próxima data prevista</small><strong>{nextDue ? localDate(nextDue.due_date) : "Não informada"}</strong></article></div>
    <p className="portal-disclaimer">*Saldo estimado apenas com previsões cadastradas e pagamentos associados à data do serviço; não substitui a conferência financeira. Resultados limitados aos registros carregados.</p>
    <p className="portal-disclaimer">Os valores acima representam pagamentos registrados, não saldo a receber. Não incluem pagamentos estornados. Os totais são limitados aos registros carregados.</p>
    <div className="portal-section-intro"><div><span className="eyebrow">ROTINA</span><h3>Atividade recente</h3></div><span>Escalas, registros e disponibilidades</span></div>
    <div className="portal-grid">
      <article className="portal-panel"><div className="portal-panel-title"><h4>Minhas próximas escalas</h4><button className="subtle-button" type="button" onClick={goToSchedule}>Abrir escalas</button></div>
        {upcoming.length === 0 ? <p className="muted">Você não possui turnos futuros confirmados.</p> : upcoming.map(s => <div className="portal-line" key={s.id}><div><strong>{localDate(s.work_date)}</strong><span>{time(s.start_time)} às {time(s.end_time)}{s.end_time <= s.start_time ? " (dia seguinte)" : ""}</span></div><small>{s.reply_status === "accepted" ? "Presença confirmada" : s.reply_status === "declined" ? "Não poderá comparecer" : "Aguardando sua resposta"}</small></div>)}
      </article>
      <article className="portal-panel"><div className="portal-panel-title"><h4>Últimos pagamentos</h4><button type="button" className="subtle-button" onClick={goToPayments}>Meus pagamentos</button></div>
        {payments.length === 0 ? <p className="muted">Nenhum pagamento registrado.</p> : payments.slice(0, 8).map(p => <div className="portal-line" key={p.id}><div><strong>{localDate(p.paid_at)}</strong><span>Serviço: {localDate(p.day_date)}</span></div><strong className={p.voided_at ? "portal-void" : ""}>{money(p.amount_cents)}{p.voided_at ? " · estornado" : ""}</strong></div>)}
      </article>
      <article className="portal-panel"><h4>Meus últimos lançamentos</h4>
        {entries.length === 0 ? <p className="muted">Nenhum lançamento diário registrado.</p> : entries.slice(0, 8).map(e => <div className="portal-line" key={e.day_date}><div><strong>{localDate(e.day_date)}</strong><span>{e.present ? "Presença registrada" : "Sem presença"}</span></div><small>Gorjetas: {money(e.tips_cents)} · Vendas: {money(e.sales_cents)}</small></div>)}
      </article>
      <article className="portal-panel"><h4>Minhas disponibilidades</h4>
        {availabilities.length === 0 ? <p className="muted">Nenhuma disponibilidade informada.</p> : availabilities.slice(0, 8).map(a => <div className="portal-line" key={a.id}><strong>{localDate(a.work_date)}</strong><span>{time(a.start_time)}–{time(a.end_time)}</span></div>)}
        <button type="button" className="primary-button" onClick={goToSchedule}>Informar disponibilidade</button>
      </article>
    </div>
  </section>;
}
