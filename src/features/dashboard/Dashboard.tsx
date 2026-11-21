import { isStaff, useMe } from "../../auth/access";
import { useState, type Dispatch, type SetStateAction } from "react";
import type { AppData } from "../../types";
import { BarList, ColumnChart, StackBar } from "../../components/Charts";
import MoneyInput from "../../components/MoneyInput";
import { formatCents } from "../../lib/money";
import {
  PERIODS, formatDate, monthKey, monthLabel, monthName, periodRange, todayKey, type Period,
} from "../../lib/dates";
import {
  aggregateByMember, closedDays, compareMonths, cumulativeByDay, goalFor, groupByMonth,
  paymentLines, summarizePayments, sumTotals,
} from "../../lib/reports";
import "./dashboard.css";
import "./admin-premium.css";
import AdvancedFinance from "./AdvancedFinance";

interface Props {
  data: AppData;
  setData: Dispatch<SetStateAction<AppData>>;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="stat-card">
      <div className="stat-top"><span>{label}</span></div>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

const orNoData = (cents?: number) => (cents === undefined ? "Sem dados" : formatCents(cents));

export default function Dashboard({ data, setData }: Props) {
  const staff = isStaff(useMe());
  const today = todayKey();
  const [period, setPeriod] = useState<Period>("month");
  const [custom, setCustom] = useState({ from: `${monthKey(today)}-01`, to: today });
  const [goalMonth, setGoalMonth] = useState(monthKey(today));
  const [evolutionId, setEvolutionId] = useState("");

  const range = periodRange(period, today, custom);
  const days = closedDays(data, range.from, range.to);
  const totals = sumTotals(days);
  const pay = summarizePayments(paymentLines(data, today, range.from, range.to));
  const waiters = aggregateByMember(days)
    .filter((r) => r.role === "Garçom" && r.salesCents > 0)
    .sort((a, b) => b.salesCents - a.salesCents);
  const dailySales = days.map((d) => ({ label: `${d.date.slice(8)}/${d.date.slice(5, 7)}`, value: d.closing!.teamSalesCents }));
  const monthly = groupByMonth(closedDays(data)).slice(-12).map((m) => ({ label: monthLabel(m.month), value: m.totalCents }));
  const cmp = compareMonths(data, monthKey(today));
  const pct = cmp.deltaPct === undefined ? "Sem dados" : `${cmp.deltaPct >= 0 ? "+" : ""}${cmp.deltaPct.toFixed(1).replace(".", ",")}%`;

  // ---- Metas ----
  const goal = goalFor(data, goalMonth);
  const from = `${goalMonth}-01`;
  const to = `${goalMonth}-31`;
  const earnedByMember = new Map(aggregateByMember(closedDays(data, from, to)).map((r) => [r.memberId, r]));
  const receivedByMember = new Map<string, number>();
  for (const l of paymentLines(data, today, from, to)) {
    receivedByMember.set(l.memberId, (receivedByMember.get(l.memberId) ?? 0) + l.paidCents);
  }
  const people = new Map<string, { id: string; name: string; role: string }>();
  data.members.filter((m) => m.active).forEach((m) => people.set(m.id, { id: m.id, name: m.name, role: m.role }));
  earnedByMember.forEach((r) => { if (!people.has(r.memberId)) people.set(r.memberId, { id: r.memberId, name: r.name, role: r.role }); });
  const goalRows = [...people.values()]
    .map((p) => ({ ...p, earned: earnedByMember.get(p.id)?.totalCents ?? 0, received: receivedByMember.get(p.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const selectedId = goalRows.some((r) => r.id === evolutionId) ? evolutionId : goalRows[0]?.id ?? "";
  const evolution = selectedId ? cumulativeByDay(data, goalMonth, selectedId) : [];
  const goalHistory = groupByMonth(closedDays(data)).map((m) => {
    const g = goalFor(data, m.month);
    const rows = aggregateByMember(closedDays(data, `${m.month}-01`, `${m.month}-31`));
    return { month: m.month, goal: g, reached: g > 0 ? rows.filter((r) => r.totalCents >= g).length : 0, total: rows.length };
  }).reverse();

  function setGoal(cents: number) {
    setData((cur) => ({ ...cur, goals: { ...cur.goals, byMonth: { ...cur.goals?.byMonth, [goalMonth]: cents } } }));
  }
  function resetGoal() {
    setData((cur) => {
      const byMonth = { ...cur.goals?.byMonth };
      delete byMonth[goalMonth];
      return { ...cur, goals: { ...cur.goals, byMonth } };
    });
  }

  return (
    <>
      <section className="admin-hero" aria-label="Resumo da operação">
        <div className="admin-hero-copy">
          <span className="admin-hero-kicker">VISÃO DA GESTÃO · MEU FREELA</span>
          <h2>Seu estabelecimento, sob controle<span aria-hidden="true"> ✦</span></h2>
          <p>Acompanhe o movimento da equipe, os ganhos e os pagamentos no período selecionado.</p>
          <div className="admin-hero-chips">
            <span>{days.length} dia(s) fechado(s)</span>
            <span>{formatDate(range.from)} — {formatDate(range.to)}</span>
          </div>
        </div>
        <div className="admin-hero-side" aria-label="Resumo financeiro do período">
          <span>VENDAS NO PERÍODO</span>
          <strong>{formatCents(totals.salesCents)}</strong>
          <small>Equipe: {formatCents(totals.totalCents)} em ganhos</small>
        </div>
      </section>
      <div className="admin-section-label"><span>OPERAÇÃO</span><h3>Indicadores e desempenho</h3></div>
      <section className="content-card admin-period-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">PAINEL</span>
            <h3>Visão geral da operação</h3>
            <p className="muted">
              {formatDate(range.from)} a {formatDate(range.to)} · considera apenas dias fechados ({days.length} no período)
            </p>
          </div>
        </div>
        <div className="period-bar" role="group" aria-label="Período">
          {PERIODS.map((p) => (
            <button key={p.id} className={period === p.id ? "selected" : ""} onClick={() => setPeriod(p.id)}>{p.label}</button>
          ))}
          {period === "custom" && (
            <span className="period-custom">
              <input type="date" aria-label="Início" value={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} />
              até
              <input type="date" aria-label="Fim" value={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} />
            </span>
          )}
        </div>
        {days.length === 0 && (
          <div className="daily-warnings"><p>Nenhum dia fechado neste período. Feche o dia em "Lançamento diário" para alimentar o painel.</p></div>
        )}
      </section>

      <section className="stats-grid dashboard-stats admin-stat-grid">
        <StatCard label="Total vendido" value={formatCents(totals.salesCents)} hint="Vendas da equipe" />
        <StatCard label="Ganhos totais da equipe" value={formatCents(totals.totalCents)} hint="Conquistado, não necessariamente pago" />
        <StatCard label="Valores fixos" value={formatCents(totals.fixedCents)} hint="Diárias de quem trabalhou" />
        <StatCard label="Bônus de garçons" value={formatCents(totals.bonusCents)} hint="Pagos ou devidos" />
        <StatCard label="Comissão coletiva" value={formatCents(totals.commissionCents)} hint="10% das vendas" />
        <StatCard label="Caixinhas" value={formatCents(totals.tipsCents)} hint="Informadas por cada pessoa" />
        <StatCard label="Dias trabalhados" value={String(days.length)} hint="Dias fechados no período" />
        <StatCard label="Pagamentos realizados" value={formatCents(pay.paidCents)} hint="Confirmados manualmente" />
        <StatCard label="Pagamentos pendentes" value={formatCents(pay.pendingCents)} hint="Dentro do prazo" />
        <StatCard label="Pagamentos atrasados" value={formatCents(pay.overdueCents)} hint={`${pay.overdueCount} pagamento(s) vencido(s)`} />
      </section>

      <div className="admin-section-label admin-charts-heading"><span>ANÁLISE</span><h3>Evolução e composição</h3></div>
      <section className="chart-grid admin-chart-grid">
        <div className="content-card"><h4>Evolução diária das vendas</h4><ColumnChart items={dailySales} format={formatCents} /></div>
        <div className="content-card"><h4>Evolução mensal dos ganhos</h4><ColumnChart items={monthly} format={formatCents} /></div>
        <div className="content-card">
          <h4>Composição da remuneração</h4>
          <StackBar format={formatCents} segments={[
            { label: "Fixo", value: totals.fixedCents, color: "#4b8cff" },
            { label: "Bônus", value: totals.bonusCents, color: "#35c98a" },
            { label: "Comissão", value: totals.commissionCents, color: "#e5a00d" },
            { label: "Caixinhas", value: totals.tipsCents, color: "#a78bfa" },
          ]} />
        </div>
        <div className="content-card">
          <h4>Recebido x pendente</h4>
          <StackBar format={formatCents} segments={[
            { label: "Recebido", value: pay.paidCents, color: "#35c98a" },
            { label: "Pendente", value: pay.pendingCents, color: "#e5a00d" },
            { label: "Atrasado", value: pay.overdueCents, color: "#e5484d" },
          ]} />
        </div>
        <div className="content-card wide">
          <h4>Ranking de vendas dos garçons</h4>
          <BarList items={waiters.map((w) => ({ label: w.name, value: w.salesCents }))} format={formatCents} />
        </div>
      </section>

      {staff && <AdvancedFinance data={data} from={range.from} to={range.to} today={today} />}

      <section className="content-card">
        <div className="section-heading"><div><span className="eyebrow">COMPARATIVOS</span><h3>Ganhos mês a mês</h3>
          <p className="muted">Usa só meses com movimento registrado. Meses sem dados não entram nas médias.</p></div></div>
        <div className="compare-grid">
          <div><span>Mês atual</span><strong>{orNoData(cmp.current)}</strong></div>
          <div><span>Mês anterior</span><strong>{orNoData(cmp.previous)}</strong></div>
          <div><span>Variação em R$</span><strong>{orNoData(cmp.deltaCents)}</strong></div>
          <div><span>Variação %</span><strong>{pct}</strong></div>
          <div><span>Média 3 meses</span><strong>{orNoData(cmp.avg3)}</strong></div>
          <div><span>Média 6 meses</span><strong>{orNoData(cmp.avg6)}</strong></div>
          <div><span>Melhor mês</span><strong>{cmp.best ? `${formatCents(cmp.best.value)} · ${monthLabel(cmp.best.month)}` : "Sem dados"}</strong></div>
          <div><span>Pior mês</span><strong>{cmp.worst ? `${formatCents(cmp.worst.value)} · ${monthLabel(cmp.worst.month)}` : "Sem dados"}</strong></div>
        </div>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div><span className="eyebrow">METAS INDIVIDUAIS</span><h3>Meta de {monthName(goalMonth)}</h3>
            <p className="muted">A meta conta o que foi conquistado, mesmo que ainda não tenha sido pago. O dinheiro recebido aparece à parte.</p></div>
        </div>
        <div className="daily-toolbar">
          <label>Mês<input type="month" value={goalMonth} onChange={(e) => e.target.value && setGoalMonth(e.target.value)} /></label>
          <label>Meta do mês (R$)<MoneyInput label="Meta mensal" valueCents={goal} disabled={!staff} onChange={setGoal} /></label>
          <button className="subtle-button" onClick={resetGoal} disabled={!staff}>Restaurar padrão</button>
        </div>
        {goalRows.length === 0 ? (
          <div className="empty-state"><strong>Nenhum integrante</strong><p>Cadastre a equipe para acompanhar as metas.</p></div>
        ) : (
          <div className="daily-table-wrap">
            <table className="daily-table">
              <thead><tr><th>Integrante</th><th>Conquistado</th><th>Progresso</th><th>Falta</th><th>Recebido</th></tr></thead>
              <tbody>
                {goalRows.map((r) => {
                  const percent = goal > 0 ? Math.round((r.earned / goal) * 100) : 0;
                  return (
                    <tr key={r.id}>
                      <td><strong>{r.name}</strong><span className="muted">{r.role}</span></td>
                      <td>{formatCents(r.earned)}</td>
                      <td>
                        <div className="goal-track"><div className="goal-fill" style={{ width: `${Math.min(percent, 100)}%` }} /></div>
                        <small>{goal > 0 ? `${percent}%` : "—"}</small>
                      </td>
                      <td>{goal > 0 ? (r.earned >= goal ? "Meta atingida" : formatCents(goal - r.earned)) : "—"}</td>
                      <td>{formatCents(r.received)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {goalRows.length > 0 && (
          <div className="goal-evolution">
            <label>Evolução no mês
              <select value={selectedId} onChange={(e) => setEvolutionId(e.target.value)}>
                {goalRows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <ColumnChart items={evolution} format={formatCents} />
          </div>
        )}
        {goalHistory.length > 0 && (
          <div className="daily-table-wrap">
            <h4 className="goal-history-title">Histórico das metas</h4>
            <table className="daily-table">
              <thead><tr><th>Mês</th><th>Meta</th><th>Atingiram</th></tr></thead>
              <tbody>
                {goalHistory.map((h) => (
                  <tr key={h.month}><td>{monthName(h.month)}</td><td>{formatCents(h.goal)}</td><td>{h.reached} de {h.total}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}