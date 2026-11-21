import { useState } from "react";
import { FileSpreadsheet, Printer } from "lucide-react";
import type { AppData } from "../../types";
import { downloadCsv, type ReportTable } from "../../lib/exportFiles";
import { formatCents } from "../../lib/money";
import { formatDate, monthKey, monthName, todayKey } from "../../lib/dates";
import {
  STATUS_LABEL, aggregateByMember, closedDays, paymentLines, summarizePayments, sumTotals,
} from "../../lib/reports";
import "./reports.css";

type Kind = "monthly" | "payments" | "days";
const KINDS: { id: Kind; label: string }[] = [
  { id: "monthly", label: "Fechamento mensal" },
  { id: "payments", label: "Pagamentos do mês" },
  { id: "days", label: "Dias fechados" },
];

function buildTable(kind: Kind, data: AppData, month: string, today: string): ReportTable {
  const from = `${month}-01`;
  const to = `${month}-31`;
  const days = closedDays(data, from, to);
  const lines = paymentLines(data, today, from, to);
  const fc = formatCents;
  const subtitle = `${monthName(month)} · gerado em ${formatDate(today)} · somente dias fechados`;

  if (kind === "payments") {
    return {
      title: "Pagamentos do mês", subtitle,
      headers: ["Serviço", "Integrante", "Função", "Conquistado", "Recebido", "Saldo", "Vencimento", "Situação"],
      rows: lines.map((l) => [formatDate(l.date), l.name, l.role, fc(l.earnedCents), fc(l.paidCents), fc(l.balanceCents), formatDate(l.dueDate), STATUS_LABEL[l.status]]),
      footer: ["Total", "", "", fc(lines.reduce((s, l) => s + l.earnedCents, 0)), fc(lines.reduce((s, l) => s + l.paidCents, 0)), fc(lines.reduce((s, l) => s + l.balanceCents, 0)), "", ""],
    };
  }
  if (kind === "days") {
    const t = sumTotals(days);
    return {
      title: "Dias fechados", subtitle,
      headers: ["Data", "Trabalharam", "Vendas da equipe", "Fixo", "Bônus", "Comissão", "Caixinhas", "Ganhos", "Valores"],
      rows: days.map((d) => {
        const c = d.closing!;
        return [formatDate(d.date), String(c.members.filter((m) => m.present).length), fc(c.teamSalesCents), fc(c.totals.fixedCents), fc(c.totals.bonusCents), fc(c.totals.commissionCents), fc(c.totals.tipsCents), fc(c.totals.totalCents), c.hasEstimates ? "Estimados" : "Confirmados"];
      }),
      footer: ["Total", String(days.length) + " dia(s)", fc(t.salesCents), fc(t.fixedCents), fc(t.bonusCents), fc(t.commissionCents), fc(t.tipsCents), fc(t.totalCents), ""],
    };
  }
  const rows = aggregateByMember(days);
  const paid = new Map<string, number>();
  const open = new Map<string, number>();
  for (const l of lines) {
    paid.set(l.memberId, (paid.get(l.memberId) ?? 0) + l.paidCents);
    open.set(l.memberId, (open.get(l.memberId) ?? 0) + l.balanceCents);
  }
  const t = sumTotals(days);
  return {
    title: "Fechamento mensal", subtitle,
    headers: ["Integrante", "Função", "Dias", "Vendas", "Fixo", "Bônus", "Comissão", "Caixinhas", "Conquistado", "Recebido", "A receber"],
    rows: rows.map((r) => [r.name, r.role, String(r.days), r.role === "Garçom" ? fc(r.salesCents) : "—", fc(r.fixedCents), fc(r.bonusCents), fc(r.commissionCents), fc(r.tipsCents), fc(r.totalCents), fc(paid.get(r.memberId) ?? 0), fc(open.get(r.memberId) ?? 0)]),
    footer: ["Total", "", `${days.length} dia(s)`, fc(t.salesCents), fc(t.fixedCents), fc(t.bonusCents), fc(t.commissionCents), fc(t.tipsCents), fc(t.totalCents), fc(summarizePayments(lines).paidCents), fc(lines.reduce((s, l) => s + l.balanceCents, 0))],
  };
}

export default function Reports({ data }: { data: AppData }) {
  const today = todayKey();
  const [kind, setKind] = useState<Kind>("monthly");
  const [month, setMonth] = useState(monthKey(today));
  const table = buildTable(kind, data, month, today);

  return (
    <section className="content-card">
      <div className="section-heading no-print">
        <div><span className="eyebrow">RELATÓRIOS</span><h3>{table.title}</h3>
          <p className="muted">Baseado nos fechamentos preservados de cada dia. Nenhum valor é estimado ou inventado.</p></div>
        <div className="report-actions">
          <button className="subtle-button" onClick={() => downloadCsv(`relatorio-${kind}-${month}.csv`, table)}><FileSpreadsheet size={14} /> Exportar Excel (CSV)</button>
          <button className="primary-button" onClick={() => window.print()}><Printer size={15} /> Exportar PDF</button>
        </div>
      </div>

      <div className="daily-toolbar no-print">
        <label>Relatório
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
        <label>Mês<input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
      </div>

      <div className="print-only"><h2>Meu Freela Dia 2.0 · {table.title}</h2><p>{table.subtitle}</p></div>

      {table.rows.length === 0 ? (
        <div className="empty-state"><strong>Sem dados</strong><p>Não há dias fechados em {monthName(month)}. Feche o dia em Lançamento diário para gerar relatórios.</p></div>
      ) : (
        <div className="daily-table-wrap">
          <table className="daily-table report-table">
            <thead><tr>{table.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
            {table.footer && <tfoot><tr>{table.footer.map((cell, j) => <td key={j}>{cell}</td>)}</tr></tfoot>}
          </table>
        </div>
      )}
      <p className="muted no-print">O arquivo CSV abre direto no Excel. Para PDF, escolha "Salvar como PDF" na janela de impressão.</p>
    </section>
  );
}