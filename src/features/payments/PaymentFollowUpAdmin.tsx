import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import "../portal/payment-follow-up.css";

type Member = { id: string; name: string };
type Plan = { id: string; member_id: string; work_date: string; due_date: string; expected_amount_cents: number | null };
type Paid = { id: string; member_id: string; day_date: string; amount_cents: number; voided_at: string | null };
type Feedback = { id: string; member_id: string; payment_id: string | null; plan_id: string | null; response: string; proposed_amount_cents: number | null; reason: string | null; review_status: string; created_at: string };
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", {style:"currency",currency:"BRL"});

export default function PaymentFollowUpAdmin() {
  const [members, setMembers] = useState<Member[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [paidRows, setPaidRows] = useState<Paid[]>([]);
  const [memberId, setMemberId] = useState("");
  const [workDate, setWorkDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    if (!supabase) return;
    setBusy(true); setError("");
    try {
      const [m,p,f,paid] = await Promise.all([
        supabase.from("members").select("id,name").order("name"),
        supabase.from("payment_plans").select("id,member_id,work_date,due_date,expected_amount_cents").order("due_date", {ascending:false}).limit(200),
        supabase.from("payment_feedback").select("id,member_id,payment_id,plan_id,response,proposed_amount_cents,reason,review_status,created_at").order("created_at", {ascending:false}).limit(200),
        supabase.from("payments").select("id,member_id,day_date,amount_cents,voided_at").order("day_date",{ascending:false}).limit(1000),
      ]);
      if (m.error || p.error || f.error || paid.error) throw m.error || p.error || f.error || paid.error;
      setMembers((m.data ?? []) as Member[]); setPlans((p.data ?? []) as Plan[]); setFeedback((f.data ?? []) as Feedback[]); setPaidRows((paid.data ?? []) as Paid[]);
    } catch(e) { setError(e instanceof Error ? e.message : "Não foi possível carregar as previsões."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const visibleFeedback = useMemo(() => feedback.filter(f => filter === "all" || (filter === "dispute" && f.response === "dispute" && f.review_status === "pending") || (filter === "received" && f.response === "received") || (filter === "resolved" && f.review_status === "resolved")), [feedback, filter]);
  const today = new Date().toISOString().slice(0,10);
  const paidFor = (plan: Plan) => paidRows.filter(p=>!p.voided_at && p.member_id===plan.member_id && p.day_date===plan.work_date).reduce((sum,p)=>sum+Number(p.amount_cents),0);
  const overdue = plans.filter(p => p.due_date < today && p.expected_amount_cents != null && paidFor(p) < p.expected_amount_cents).length;
  const pendingCents = plans.reduce((sum,p)=>sum+Math.max(0,(p.expected_amount_cents??0)-paidFor(p)),0);
  const disputes = feedback.filter(f => f.response === "dispute" && f.review_status === "pending").length;
  const confirmations = feedback.filter(f => f.response === "received").length;
  const name = (id: string) => members.find(m => m.id === id)?.name ?? "Integrante";
  async function save() {
    if (!supabase) return;
    if (!memberId || !workDate || !dueDate || (amount !== "" && (!Number.isFinite(Number(amount)) || Number(amount)<0))) {setError("Informe integrante, data do serviço, data prevista e um valor válido.");return;}
    setBusy(true);setError("");setNotice("");
    try {
      const existing = plans.find(p => p.member_id===memberId && p.work_date===workDate);
      const values = {member_id:memberId,work_date:workDate,due_date:dueDate,expected_amount_cents:amount==="" ? null : Math.round(Number(amount)*100)};
      const result = existing ? await supabase.from("payment_plans").update(values).eq("id",existing.id) : await supabase.from("payment_plans").insert(values);
      if (result.error) throw result.error;
      setNotice("Previsão salva. Isso não registra pagamento financeiro.");await refresh();
    } catch(e) {setError(e instanceof Error ? e.message : "Falha ao salvar previsão.");}
    finally {setBusy(false);}
  }
  async function resolve(id: string) {
    if(!supabase) return;
    setBusy(true);setError("");
    try {const result=await supabase.from("payment_feedback").update({review_status:"resolved",reviewed_at:new Date().toISOString()}).eq("id",id);if(result.error)throw result.error;await refresh();}
    catch(e){setError(e instanceof Error?e.message:"Falha ao concluir análise.");}
    finally{setBusy(false);}
  }
  return <section className="portal-panel pflow" style={{marginTop:20}}>
    <div className="pflow-heading"><h4>Previsões individuais e conferência do freelancer</h4><button className="subtle-button" onClick={() => void refresh()} disabled={busy}>Atualizar</button></div>
    <p className="muted">A data prevista não registra um pagamento. O pagamento efetivo continua sendo registrado na seção de pagamentos acima.</p>
    {error && <p className="sync-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="pflow-editor"><label>Integrante<select value={memberId} onChange={e=>setMemberId(e.target.value)}><option value="">Selecione</option>{members.map(m=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label>
    <label>Data do serviço<input type="date" value={workDate} onChange={e=>setWorkDate(e.target.value)} /></label>
    <label>Data prevista de pagamento<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} /></label>
    <label>Valor previsto (R$, opcional)<input type="number" min="0" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} /></label>
    <button className="primary-button" type="button" disabled={busy} onClick={() => void save()}>Salvar previsão</button></div>
    <div className="mf22-payment-kpis"><article><small>Saldo previsto a pagar*</small><strong>{money(pendingCents)}</strong></article><article><small>Previsões em atraso*</small><strong>{overdue}</strong></article><article><small>Recebimentos confirmados</small><strong>{confirmations}</strong></article><article><small>Contestações pendentes</small><strong>{disputes}</strong></article></div>
    <p className="muted">*Saldo estimado comparando previsões e pagamentos registrados da mesma pessoa e data de serviço; o cálculo não substitui o fechamento financeiro.</p>
    <h4>Previsões cadastradas</h4>
    {plans.length===0 ? <p className="muted">Nenhuma previsão cadastrada.</p> : plans.slice(0,30).map(p=><div className="pflow-row" key={p.id}><div><strong>{name(p.member_id)}</strong><small>Serviço {p.work_date} · Previsto {p.due_date} · {p.expected_amount_cents==null?"Valor não informado":money(Number(p.expected_amount_cents))} · Pago: {money(paidFor(p))} · Saldo: {p.expected_amount_cents==null?"Não calculado":money(Math.max(0,p.expected_amount_cents-paidFor(p)))}</small></div></div>)}
    <div className="mf22-followup-filter"><h4>Respostas e solicitações de correção</h4><label>Situação<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todas</option><option value="dispute">Contestações pendentes</option><option value="received">Confirmados</option><option value="resolved">Analisados</option></select></label></div>
    {visibleFeedback.length===0 ? <p className="muted">Nenhuma resposta nesse filtro.</p> : visibleFeedback.map(f=><div className="pflow-row" key={f.id}><div><strong>{name(f.member_id)} — {f.response==="received"?"Recebimento confirmado":"Contestação de valor"}</strong><small>{f.payment_id?"Pagamento registrado":"Previsão de pagamento"} · {f.review_status==="pending"?"Pendente":"Analisado"}</small>{f.response==="dispute"&&<small>Valor solicitado: {f.proposed_amount_cents==null?"Não informado":money(Number(f.proposed_amount_cents))} · {f.reason}</small>}</div>{f.review_status==="pending"&&<button className="subtle-button" type="button" disabled={busy} onClick={()=>void resolve(f.id)}>Marcar como analisado</button>}</div>)}
    <p className="muted">Marcar como analisado encerra a solicitação administrativa, mas não altera valores, datas ou pagamentos.</p>
  </section>;
}
