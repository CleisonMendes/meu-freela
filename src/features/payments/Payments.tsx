import { canEditMember, isStaff, useMe } from "../../auth/access";
import { Fragment, useState, type Dispatch, type SetStateAction } from "react";
import type { AppData } from "../../types";
import MoneyInput from "../../components/MoneyInput";
import { formatCents } from "../../lib/money";
import { formatDate, todayKey } from "../../lib/dates";
import { STATUS_LABEL, paymentLines, summarizePayments, type PayLine, type PayStatus } from "../../lib/reports";
import "./payments.css";

interface Props {
  data: AppData;
  setData: Dispatch<SetStateAction<AppData>>;
}

type StatusFilter = "open" | "all" | PayStatus;
const keyOf = (l: PayLine) => `${l.date}|${l.memberId}`;

function PaymentForm({ line, onSave, onCancel }: { line: PayLine; onSave: (cents: number, paidAt: string, note: string) => void; onCancel: () => void }) {
  const [amount, setAmount] = useState(line.balanceCents);
  const [paidAt, setPaidAt] = useState(todayKey());
  const [note, setNote] = useState("");
  return (
    <div className="pay-form">
      <label>Valor recebido<MoneyInput label={`Valor recebido por ${line.name}`} valueCents={amount} onChange={setAmount} /></label>
      <label>Data do pagamento<input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></label>
      <label className="grow">Observação<input value={note} maxLength={120} placeholder="Opcional (ex.: PIX, divergência)" onChange={(e) => setNote(e.target.value)} /></label>
      <div className="form-actions">
        <button className="primary-button" onClick={() => onSave(amount, paidAt, note)}>Confirmar pagamento</button>
        <button className="subtle-button" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

export default function Payments({ data, setData }: Props) {
  const me = useMe();
  const staff = isStaff(me);
  const today = todayKey();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [memberId, setMemberId] = useState("");
  const [month, setMonth] = useState("");
  const [formKey, setFormKey] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  const all = paymentLines(data, today, month ? `${month}-01` : undefined, month ? `${month}-31` : undefined);
  const lines = all.filter((l) =>
    (status === "all" || (status === "open" ? l.status !== "pago" : l.status === status)) &&
    (!memberId || l.memberId === memberId));
  const summary = summarizePayments(lines);
  const people = [...new Map(all.map((l) => [l.memberId, l.name])).entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  const groups = [...new Set(lines.map((l) => l.date))];

  function savePayment(line: PayLine, amountCents: number, paidAt: string, note: string) {
    if (amountCents <= 0) { window.alert("Informe um valor maior que zero."); return; }
    if (!paidAt) { window.alert("Informe a data do pagamento."); return; }
    if (amountCents > line.balanceCents &&
      !window.confirm(`O valor (${formatCents(amountCents)}) é maior que o saldo (${formatCents(line.balanceCents)}). Registrar mesmo assim, como divergência?`)) return;
    setData((cur) => ({
      ...cur,
      payments: [...(cur.payments ?? []), {
        id: crypto.randomUUID(), date: line.date, memberId: line.memberId, amountCents, paidAt,
        note: note.trim() || undefined, createdAt: new Date().toISOString(),
      }],
    }));
    setFormKey(null);
  }

  function voidPayment(id: string) {
    const reason = window.prompt("Motivo do estorno (obrigatório). O pagamento continua no histórico, mas deixa de contar:")?.trim();
    if (!reason) return;
    setData((cur) => ({
      ...cur,
      payments: (cur.payments ?? []).map((p) => (p.id === id ? { ...p, voidedAt: new Date().toISOString(), voidReason: reason } : p)),
    }));
  }

  function setDueDate(date: string, value: string) {
    if (!value) return;
    setData((cur) => ({ ...cur, days: (cur.days ?? []).map((d) => (d.date === date ? { ...d, dueDate: value } : d)) }));
  }

  return (
    <section className="content-card">
      <div className="section-heading">
        <div><span className="eyebrow">CONTROLE DE RECEBIMENTOS</span><h3>Pagamentos</h3>
          <p className="muted">Cada dia fechado gera o que cada pessoa tem a receber. Os pagamentos são confirmados manualmente e podem ser parciais.</p></div>
      </div>

      <div className="daily-toolbar">
        <label>Situação
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="open">Em aberto</option><option value="all">Todos</option>
            <option value="pendente">Pendente</option><option value="parcial">Parcial</option>
            <option value="atrasado">Atrasado</option><option value="pago">Pago</option>
          </select>
        </label>
        <label>Integrante
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">Todos</option>
            {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label>Mês<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        {month && <button className="subtle-button" onClick={() => setMonth("")}>Todos os meses</button>}
      </div>

      <div className="stats-grid pay-summary">
        <div className="stat-card"><div className="stat-top"><span>Recebido</span></div><strong>{formatCents(summary.paidCents)}</strong><small>Confirmado</small></div>
        <div className="stat-card"><div className="stat-top"><span>Pendente</span></div><strong>{formatCents(summary.pendingCents)}</strong><small>Dentro do prazo</small></div>
        <div className="stat-card"><div className="stat-top"><span>Atrasado</span></div><strong>{formatCents(summary.overdueCents)}</strong><small>{summary.overdueCount} vencido(s)</small></div>
      </div>

      {groups.length === 0 ? (
        <div className="empty-state">
          <strong>Nenhum pagamento para mostrar</strong>
          <p>{all.length === 0 ? "Feche um dia em Lançamento diário para gerar os valores a receber." : "Altere os filtros para ver outros pagamentos."}</p>
        </div>
      ) : (
        <div className="daily-table-wrap">
          <table className="daily-table">
            <thead><tr><th>Integrante</th><th>Conquistado</th><th>Recebido</th><th>Saldo</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {groups.map((date) => {
                const group = lines.filter((l) => l.date === date);
                const due = group[0].dueDate;
                return (
                  <Fragment key={date}>
                    <tr className="pay-group-row">
                      <td colSpan={6}>
                        <strong>Serviço de {formatDate(date)}</strong>
                        {group[0].hasEstimates && <span className="estimate-badge">valores estimados</span>}
                        <label className="due-label">Vencimento
                          <input type="date" value={due} disabled={!staff} onChange={(e) => setDueDate(date, e.target.value)} />
                        </label>
                      </td>
                    </tr>
                    {group.map((l) => {
                      const k = keyOf(l);
                      return (
                        <Fragment key={k}>
                          <tr>
                            <td><strong>{l.name}</strong><span className="muted">{l.role}</span></td>
                            <td>{formatCents(l.earnedCents)}</td>
                            <td>{formatCents(l.paidCents)}{l.divergenceCents > 0 && <span className="adjust-tag" title="Pago acima do devido">+{formatCents(l.divergenceCents)}</span>}</td>
                            <td>{formatCents(l.balanceCents)}</td>
                            <td><span className={`pay-status ${l.status}`}>{STATUS_LABEL[l.status]}</span></td>
                            <td className="pay-actions">
                              {l.status !== "pago" && canEditMember(me, l.memberId) && <button className="primary-button small" onClick={() => setFormKey(formKey === k ? null : k)}>Receber</button>}
                              {l.payments.length > 0 && <button className="subtle-button" onClick={() => setHistoryKey(historyKey === k ? null : k)}>Histórico ({l.payments.length})</button>}
                            </td>
                          </tr>
                          {formKey === k && (
                            <tr><td colSpan={6}><PaymentForm line={l} onSave={(c, p, n) => savePayment(l, c, p, n)} onCancel={() => setFormKey(null)} /></td></tr>
                          )}
                          {historyKey === k && (
                            <tr><td colSpan={6}>
                              <div className="pay-history">
                                {l.payments.map((p) => (
                                  <div key={p.id} className={p.voidedAt ? "voided" : ""}>
                                    <span>{formatDate(p.paidAt)}</span>
                                    <strong>{formatCents(p.amountCents)}</strong>
                                    <span className="muted">{p.voidedAt ? `Estornado: ${p.voidReason}` : p.note ?? ""}</span>
                                    {!p.voidedAt && canEditMember(me, p.memberId) && <button className="danger-button" onClick={() => voidPayment(p.id)}>Estornar</button>}
                                  </div>
                                ))}
                              </div>
                            </td></tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}