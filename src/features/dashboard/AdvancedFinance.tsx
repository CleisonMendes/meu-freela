import { useMemo, useState } from "react";
import type { AppData, Role } from "../../types";
import { aggregateByMember, closedDays, paymentLines } from "../../lib/reports";
import { formatCents } from "../../lib/money";
import { addDays } from "../../lib/dates";
import "./advanced-finance.css";

type Props = { data: AppData; from: string; to: string; today: string };
type MemberRow = { id: string; name: string; role: Role; days: number; earned: number; paid: number; balance: number; overdue: number };
const currency = (n: number) => formatCents(Math.round(n));
const escapeCsv = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

function downloadCsv(rows: MemberRow[], from: string, to: string) {
  const header = ["Integrante", "Função", "Dias com presença", "Ganhos (R$)", "Pagamentos (R$)", "A receber (R$)", "Atrasado (R$)"];
  const centsToBRL = (n: number) => (n / 100).toFixed(2).replace(".", ",");
  const contents = [header, ...rows.map((r) => [r.name, r.role, r.days, centsToBRL(r.earned), centsToBRL(r.paid), centsToBRL(r.balance), centsToBRL(r.overdue)])]
    .map((r) => r.map(escapeCsv).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", contents], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `meu-freela-financeiro-${from}-a-${to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AdvancedFinance({ data, from, to, today }: Props) {
  const [role, setRole] = useState("all");
  const model = useMemo(() => {
    // Ganhos vêm de fechamentos; pagamentos ficam atribuídos à data do serviço,
    // não à data da transferência bancária. Estornos são desconsiderados.
    const days = closedDays(data, from, to);
    const earned = aggregateByMember(days);
    const lines = paymentLines(data, today, from, to);
    const byId = new Map<string, MemberRow>();
    for (const person of earned) {
      byId.set(person.memberId, { id: person.memberId, name: person.name, role: person.role, days: person.days, earned: person.totalCents, paid: 0, balance: 0, overdue: 0 });
    }
    for (const line of lines) {
      const row = byId.get(line.memberId);
      if (!row) continue;
      row.paid += line.paidCents;
      row.balance += line.balanceCents;
      if (line.status === "atrasado") row.overdue += line.balanceCents;
    }
    const rows = [...byId.values()].sort((a, b) => b.earned - a.earned || a.name.localeCompare(b.name, "pt-BR"));
    const groups = new Map<Role, { role: Role; earned: number; paid: number; balance: number; count: number }>();
    for (const row of rows) {
      const group = groups.get(row.role) ?? { role: row.role, earned: 0, paid: 0, balance: 0, count: 0 };
      group.earned += row.earned; group.paid += row.paid; group.balance += row.balance; group.count++;
      groups.set(row.role, group);
    }
    const weekly = new Map<string, { from: string; to: string; earned: number; paid: number }>();
    // Sem depender de fuso: chaves ISO YYYY-MM-DD são comparadas como datas civis.
    function mondayOf(iso: string) {
      const d = new Date(`${iso}T12:00:00Z`);
      const weekday = d.getUTCDay();
      d.setUTCDate(d.getUTCDate() - ((weekday + 6) % 7));
      return d.toISOString().slice(0, 10);
    }
    for (const day of days) {
      const key = mondayOf(day.date);
      const w = weekly.get(key) ?? { from: key, to: addDays(key, 6), earned: 0, paid: 0 };
      w.earned += day.closing?.totals.totalCents ?? 0;
      weekly.set(key, w);
    }
    for (const line of lines) {
      const key = mondayOf(line.date);
      const w = weekly.get(key) ?? { from: key, to: addDays(key, 6), earned: 0, paid: 0 };
      w.paid += line.paidCents;
      weekly.set(key, w);
    }
    return { rows, groups: [...groups.values()].sort((a, b) => b.earned - a.earned), weekly: [...weekly.values()].sort((a, b) => a.from.localeCompare(b.from)) };
  }, [data, from, to, today]);
  const filtered = role === "all" ? model.rows : model.rows.filter((r) => r.role === role);
  const earned = filtered.reduce((s, r) => s + r.earned, 0);
  const paid = filtered.reduce((s, r) => s + r.paid, 0);
  const balance = filtered.reduce((s, r) => s + r.balance, 0);
  const overdue = filtered.reduce((s, r) => s + r.overdue, 0);
  const maxWeek = Math.max(1, ...model.weekly.map((w) => Math.max(w.earned, w.paid)));
  return (
    <section className="content-card af-root" aria-label="Análise financeira avançada">
      <div className="section-heading">
        <div><span className="eyebrow">ANÁLISE GERENCIAL</span><h3>Dashboard financeiro avançado</h3>
          <p className="muted">De {from.split("-").reverse().join("/")} até {to.split("-").reverse().join("/")} · valores de dias fechados, agrupados pela data do serviço.</p>
        </div>
      </div>
      <div className="af-toolbar">
        <label htmlFor="af-role">Filtrar função</label>
        <select id="af-role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="all">Todas as funções</option>
          {["Garçom", "Caixa", "Bar", "Cozinha"].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="button" className="subtle-button" onClick={() => downloadCsv(filtered, from, to)} disabled={filtered.length === 0}>Exportar CSV</button>
      </div>
      <div className="af-stats">
        <div><span>Ganhos da equipe</span><strong>{currency(earned)}</strong><small>Valor conquistado nos fechamentos</small></div>
        <div><span>Pago</span><strong>{currency(paid)}</strong><small>Pagamentos não estornados</small></div>
        <div><span>A receber</span><strong>{currency(balance)}</strong><small>Saldo dos serviços selecionados</small></div>
        <div><span>Atrasado</span><strong>{currency(overdue)}</strong><small>Parte vencida do saldo</small></div>
      </div>
      <p className="af-disclaimer">Os pagamentos são atribuídos ao dia trabalhado, mesmo quando pagos em outra data. Este painel não calcula lucro líquido, impostos nem despesas gerais. Pagamentos acima do devido não são tratados como saldo negativo.</p>
      <div className="af-sections">
        <div>
          <h4>Remuneração por função</h4>
          {model.groups.filter((g) => role === "all" || g.role === role).length === 0 ? <p className="muted">Sem fechamentos no período.</p> :
            <div className="af-roles">{model.groups.filter((g) => role === "all" || g.role === role).map((g) => (
              <div className="af-role" key={g.role}>
                <div><strong>{g.role}</strong><small>{g.count} integrante(s)</small><span>{currency(g.earned)}</span></div>
                <div className="af-track"><div style={{ width: `${earned > 0 ? (g.earned / earned) * 100 : 0}%` }} /></div>
              </div>
            ))}</div>}
        </div>
        <div>
          <h4>Ganhos x pagamentos por semana</h4>
          {model.weekly.length === 0 ? <p className="muted">Sem fechamentos no período.</p> :
            <div className="af-weeks">{model.weekly.map((w) => (
              <div className="af-week" key={w.from}>
                <span>{w.from.slice(8)}/{w.from.slice(5, 7)} a {w.to.slice(8)}/{w.to.slice(5, 7)}</span>
                <div className="af-weekbars">
                  <div title={`Ganhos: ${currency(w.earned)}`} style={{ width: `${100 * w.earned / maxWeek}%` }} />
                  <div title={`Pago: ${currency(w.paid)}`} style={{ width: `${100 * w.paid / maxWeek}%` }} />
                </div>
                <small>{currency(w.earned)} / {currency(w.paid)}</small>
              </div>
            ))}</div>}
          <div className="af-legend"><span>■ Ganhos</span><span>■ Pago</span></div>
        </div>
      </div>
      <h4>Detalhamento por integrante</h4>
      {filtered.length === 0 ? <p className="muted">Nenhum integrante com fechamento neste período.</p> :
        <div className="af-table-wrap"><table className="af-table"><thead><tr>
          <th>Integrante</th><th>Função</th><th>Dias</th><th>Ganhos</th><th>Pago</th><th>A receber</th><th>Atrasado</th>
        </tr></thead><tbody>{filtered.map((r) => <tr key={r.id}>
          <td>{r.name}</td><td>{r.role}</td><td>{r.days}</td><td>{currency(r.earned)}</td><td>{currency(r.paid)}</td><td>{currency(r.balance)}</td><td>{currency(r.overdue)}</td>
        </tr>)}</tbody></table></div>}
    </section>
  );
}
