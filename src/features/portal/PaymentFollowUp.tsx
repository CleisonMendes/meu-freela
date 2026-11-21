import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import "./payment-follow-up.css";

type Plan = { id: string; work_date: string; due_date: string; expected_amount_cents: number | null; note: string | null };
type Payment = { id: string; day_date: string; paid_at: string; amount_cents: number; voided_at: string | null };
type Feedback = { id: string; payment_id: string | null; plan_id: string | null; response: string; proposed_amount_cents: number | null; reason: string | null; review_status: string };

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateBR = (date: string) => date?.slice(0, 10).split("-").reverse().join("/") ?? "";
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const centsFromInput = (value: string) => Math.round(Number(value.replace(",", ".")) * 100);

export default function PaymentFollowUp({ memberId }: { memberId: string }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState("all");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    if (!supabase) { setError("Conexão com o Supabase não configurada."); return; }
    setBusy(true);
    setError("");
    try {
      const [planResult, paymentResult, feedbackResult] = await Promise.all([
        supabase.from("payment_plans").select("id,work_date,due_date,expected_amount_cents,note").eq("member_id", memberId).order("work_date", { ascending: false }).limit(500),
        supabase.from("payments").select("id,day_date,paid_at,amount_cents,voided_at").eq("member_id", memberId).order("day_date", { ascending: false }).limit(500),
        supabase.from("payment_feedback").select("id,payment_id,plan_id,response,proposed_amount_cents,reason,review_status").eq("member_id", memberId).limit(1000),
      ]);
      if (planResult.error) throw new Error(`payment_plans: ${planResult.error.message} (${planResult.error.code})`);
      if (paymentResult.error) throw new Error(`payments: ${paymentResult.error.message} (${paymentResult.error.code})`);
      if (feedbackResult.error) throw new Error(`payment_feedback: ${feedbackResult.error.message} (${feedbackResult.error.code})`);
      setPlans((planResult.data ?? []) as Plan[]);
      setPayments((paymentResult.data ?? []) as Payment[]);
      setFeedback((feedbackResult.data ?? []) as Feedback[]);
    } catch (e) {
      console.error("Erro ao consultar financeiro individual:", e);
      setError(e instanceof Error ? e.message : "Falha ao consultar pagamentos.");
    } finally { setBusy(false); }
  }, [memberId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const groups = useMemo(() => {
    const dates = new Set([...plans.map(p => p.work_date), ...payments.filter(p => !p.voided_at).map(p => p.day_date)]);
    return [...dates].sort((a, b) => b.localeCompare(a)).map(date => {
      const plan = plans.find(p => p.work_date === date);
      const items = payments.filter(p => p.day_date === date && !p.voided_at);
      const paid = items.reduce((s, p) => s + Number(p.amount_cents), 0);
      const expected = plan?.expected_amount_cents == null ? null : Number(plan.expected_amount_cents);
      const pending = expected == null ? null : Math.max(0, expected - paid);
      const confirmed = items.filter(p => feedback.some(f => f.payment_id === p.id && f.response === "received"));
      const disputed = feedback.some(f => (f.plan_id === plan?.id || items.some(p => p.id === f.payment_id)) && f.response === "dispute" && f.review_status !== "resolved");
      const overdue = pending != null && pending > 0 && !!plan && plan.due_date < todayISO();
      return { date, plan, items, paid, expected, pending, confirmed, disputed, overdue };
    }).filter(g => (!month || g.date.startsWith(month)) && (
      status === "all" ||
      (status === "pending" && g.pending != null && g.pending > 0) ||
      (status === "overdue" && g.overdue) ||
      (status === "registered" && g.items.length > g.confirmed.length) ||
      (status === "confirmed" && g.confirmed.length > 0) ||
      (status === "disputed" && g.disputed)
    ));
  }, [plans, payments, feedback, month, status]);

  const totals = useMemo(() => ({
    paid: groups.reduce((s, g) => s + g.paid, 0),
    pending: groups.reduce((s, g) => s + (g.pending ?? 0), 0),
    overdue: groups.reduce((s, g) => s + (g.overdue ? (g.pending ?? 0) : 0), 0),
    toConfirm: groups.reduce((s, g) => s + g.items.length - g.confirmed.length, 0),
  }), [groups]);

  async function send(kind: "received" | "dispute", id: string, isPlan = false) {
    if (!supabase) return;
    const proposed = centsFromInput(amount);
    if (kind === "dispute" && (!Number.isFinite(proposed) || proposed < 0 || reason.trim().length < 5)) {
      setError("Informe o valor correto e uma justificativa com pelo menos 5 caracteres.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = isPlan
        ? await supabase.rpc("dispute_payment_plan", { p_plan_id: id, p_proposed_amount_cents: proposed, p_reason: reason.trim() })
        : await supabase.rpc("answer_payment", { p_payment_id: id, p_response: kind, p_proposed_amount_cents: kind === "dispute" ? proposed : null, p_reason: kind === "dispute" ? reason.trim() : null });
      if (result.error) throw result.error;
      setTarget(""); setAmount(""); setReason("");
      setNotice(kind === "received" ? "Você confirmou o recebimento. Nenhum novo pagamento foi criado." : "Solicitação de revisão enviada para a gestão.");
      await refresh();
    } catch (e) {
      console.error("Erro ao responder pagamento:", e);
      setError(e instanceof Error ? e.message : "Não foi possível salvar sua resposta.");
    } finally { setBusy(false); }
  }

  function openDispute(id: string, isPlan: boolean, value: number | null) {
    setTarget(`${isPlan ? "plan" : "payment"}:${id}`);
    setAmount(value == null ? "" : (value / 100).toFixed(2));
    setReason(""); setError(""); setNotice("");
  }
  function disputeEditor(id: string, isPlan: boolean) {
    if (target !== `${isPlan ? "plan" : "payment"}:${id}`) return null;
    return <div className="pflow-editor">
      <label>Valor que considera correto (R$)
        <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Ex.: 180,00" />
      </label>
      <label>Justificativa da correção
        <textarea rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="Explique a divergência" />
      </label>
      <div className="pflow-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void send("dispute", id, isPlan)}>Enviar solicitação</button><button type="button" className="subtle-button" onClick={() => setTarget("")}>Cancelar</button></div>
    </div>;
  }

  return <section className="portal-panel pflow">
    <div className="pflow-heading">
      <div><span className="eyebrow">CONTROLE INDIVIDUAL</span><h3>Meus pagamentos</h3><p className="muted">Consulte seus valores e confirme o recebimento de pagamentos já registrados pela gestão.</p></div>
      <button type="button" className="subtle-button" disabled={busy} onClick={() => void refresh()}>{busy ? "Atualizando..." : "Atualizar"}</button>
    </div>
    <div className="pflow-filters"><label>Situação<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">Todos</option><option value="pending">Pendente</option><option value="overdue">Atrasado</option><option value="registered">A confirmar</option><option value="confirmed">Confirmado</option><option value="disputed">Em contestação</option></select></label><label>Mês<input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label></div>
    <div className="pflow-kpis">
      <div><small>Pagamentos registrados</small><strong>{brl(totals.paid)}</strong></div>
      <div><small>Saldo previsto pendente</small><strong>{brl(totals.pending)}</strong></div>
      <div><small>Previsto em atraso</small><strong>{brl(totals.overdue)}</strong></div>
      <div><small>Pagamentos a confirmar</small><strong>{totals.toConfirm}</strong></div>
    </div>
    <p className="muted pflow-note">O saldo é estimado apenas para serviços com previsão cadastrada pela gestão. Valores pagos são registros financeiros; a confirmação do funcionário não cria pagamentos. Exibindo até 500 registros por categoria.</p>
    {error && <div className="sync-error" role="alert">{error}</div>}
    {notice && <div className="pflow-notice" role="status">{notice}</div>}
    {groups.length === 0 && !busy && <p className="muted">Nenhum serviço ou pagamento encontrado para os filtros selecionados.</p>}
    <div className="pflow-list">
      {groups.map(group => {
        const allConfirmed = group.items.length > 0 && group.confirmed.length === group.items.length;
        const badge = group.disputed ? "Em contestação" : group.items.length > group.confirmed.length ? "A confirmar" : group.overdue ? "Atrasado" : group.pending != null && group.pending > 0 ? "Pendente" : allConfirmed ? "Confirmado" : group.items.length > 0 ? "Registrado" : "Previsto";
        return <article key={group.date} className="pflow-service">
          <div className="pflow-service-head"><div><strong>Serviço de {dateBR(group.date)}</strong><small>{group.plan ? `Previsão: ${dateBR(group.plan.due_date)}` : "Previsão ainda não informada"}</small></div><span className="pflow-status">{badge}</span></div>
          <div className="pflow-service-values"><div><small>Valor previsto</small><strong>{group.expected == null ? "Não informado" : brl(group.expected)}</strong></div><div><small>Pago registrado</small><strong>{brl(group.paid)}</strong></div><div><small>Saldo previsto</small><strong>{group.pending == null ? "Não calculado" : brl(group.pending)}</strong></div></div>
          {group.items.length === 0 && <p className="muted">A gestão ainda não registrou pagamento para este serviço. O botão Receber será liberado quando houver pagamento.</p>}
          {group.items.map(p => {
            const answer = feedback.find(f => f.payment_id === p.id);
            return <div key={p.id} className="pflow-payment"><div><strong>{brl(Number(p.amount_cents))}</strong><small>Pagamento registrado em {dateBR(p.paid_at)}</small><small>{answer?.response === "received" ? "Recebimento confirmado por você" : answer?.response === "dispute" ? `Correção solicitada (${answer.review_status === "resolved" ? "analisada" : "em análise"})` : "Aguardando sua confirmação"}</small></div><div className="pflow-actions"><button type="button" className="primary-button" disabled={busy || answer?.response === "received"} onClick={() => void send("received", p.id)}>{answer?.response === "received" ? "Recebido ✓" : "Receber"}</button><button type="button" className="subtle-button" disabled={busy} onClick={() => openDispute(p.id, false, Number(p.amount_cents))}>Solicitar correção</button></div>{disputeEditor(p.id, false)}</div>;
          })}
          {group.plan && <div className="pflow-plan"><div><small>Previsão definida pela gestão</small>{group.plan.note && <small>{group.plan.note}</small>}</div><button type="button" className="subtle-button" disabled={busy} onClick={() => openDispute(group.plan!.id, true, group.expected)}>Contestar valor previsto</button>{disputeEditor(group.plan.id, true)}</div>}
        </article>;
      })}
    </div>
  </section>;
}