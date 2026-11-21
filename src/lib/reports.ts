import type { AppData, Role } from "../types";
import type { DayRecord } from "../dayTypes";
import type { Cents } from "../financeTypes";
import type { PaymentRecord } from "../paymentTypes";
import { addDays, monthKey, shiftMonth } from "./dates";

export const DEFAULT_GOAL_CENTS: Cents = 400_000;

export interface Totals {
  salesCents: Cents; fixedCents: Cents; bonusCents: Cents;
  commissionCents: Cents; tipsCents: Cents; totalCents: Cents;
}
export interface MonthSummary extends Totals { month: string; days: number }
export interface EarningRow extends Totals { memberId: string; name: string; role: Role; days: number }

const zero = (): Totals => ({ salesCents: 0, fixedCents: 0, bonusCents: 0, commissionCents: 0, tipsCents: 0, totalCents: 0 });

/** Só dias FECHADOS entram em relatórios, dashboard e pagamentos. */
export function closedDays(data: AppData, from?: string, to?: string): DayRecord[] {
  return (data.days ?? [])
    .filter((d) => d.closing && (!from || d.date >= from) && (!to || d.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function addClosing(t: Totals, day: DayRecord) {
  const c = day.closing!;
  t.salesCents += c.teamSalesCents;
  t.fixedCents += c.totals.fixedCents;
  t.bonusCents += c.totals.bonusCents;
  t.commissionCents += c.totals.commissionCents;
  t.tipsCents += c.totals.tipsCents;
  t.totalCents += c.totals.totalCents;
}

export function sumTotals(days: DayRecord[]): Totals {
  const t = zero();
  days.forEach((d) => addClosing(t, d));
  return t;
}

export function groupByMonth(days: DayRecord[]): MonthSummary[] {
  const map = new Map<string, MonthSummary>();
  for (const day of days) {
    const key = monthKey(day.date);
    const cur = map.get(key) ?? { month: key, days: 0, ...zero() };
    cur.days += 1;
    addClosing(cur, day);
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function aggregateByMember(days: DayRecord[]): EarningRow[] {
  const map = new Map<string, EarningRow>();
  for (const day of days) {
    for (const m of day.closing!.members) {
      const row = map.get(m.memberId) ?? { memberId: m.memberId, name: m.name, role: m.role, days: 0, ...zero() };
      row.name = m.name;
      row.role = m.role;
      if (m.present) row.days += 1;
      row.salesCents += m.salesCents;
      row.fixedCents += m.fixedCents;
      row.bonusCents += m.bonusCents;
      row.commissionCents += m.commissionCents;
      row.tipsCents += m.tipsCents;
      row.totalCents += m.totalCents;
      map.set(m.memberId, row);
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// ---------- Pagamentos ----------

export type PayStatus = "pendente" | "parcial" | "pago" | "atrasado";
export const STATUS_LABEL: Record<PayStatus, string> = {
  pendente: "Pendente", parcial: "Parcial", pago: "Pago", atrasado: "Atrasado",
};

export interface PayLine {
  date: string;
  memberId: string;
  name: string;
  role: Role;
  earnedCents: Cents;
  paidCents: Cents;
  balanceCents: Cents;
  /** Valor pago acima do devido (divergência). */
  divergenceCents: Cents;
  dueDate: string;
  status: PayStatus;
  hasEstimates: boolean;
  /** Todos os recebimentos, inclusive estornados (histórico). */
  payments: PaymentRecord[];
}

export const dueDateOf = (day: DayRecord) => day.dueDate ?? addDays(day.date, 3);

export function paymentLines(data: AppData, today: string, from?: string, to?: string): PayLine[] {
  const lines: PayLine[] = [];
  for (const day of closedDays(data, from, to)) {
    const dueDate = dueDateOf(day);
    for (const m of day.closing!.members) {
      if (m.totalCents <= 0) continue;
      const payments = (data.payments ?? []).filter((p) => p.date === day.date && p.memberId === m.memberId);
      const paidCents = payments.filter((p) => !p.voidedAt).reduce((sum, p) => sum + p.amountCents, 0);
      const status: PayStatus =
        paidCents >= m.totalCents ? "pago" : today > dueDate ? "atrasado" : paidCents > 0 ? "parcial" : "pendente";
      lines.push({
        date: day.date, memberId: m.memberId, name: m.name, role: m.role,
        earnedCents: m.totalCents, paidCents,
        balanceCents: Math.max(m.totalCents - paidCents, 0),
        divergenceCents: Math.max(paidCents - m.totalCents, 0),
        dueDate, status, hasEstimates: day.closing!.hasEstimates, payments,
      });
    }
  }
  return lines.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, "pt-BR"));
}

export function summarizePayments(lines: PayLine[]) {
  const sum = (pick: (l: PayLine) => Cents, keep: (l: PayLine) => boolean) =>
    lines.filter(keep).reduce((acc, l) => acc + pick(l), 0);
  return {
    paidCents: sum((l) => l.paidCents, () => true),
    pendingCents: sum((l) => l.balanceCents, (l) => l.status === "pendente" || l.status === "parcial"),
    overdueCents: sum((l) => l.balanceCents, (l) => l.status === "atrasado"),
    openCount: lines.filter((l) => l.status !== "pago").length,
    overdueCount: lines.filter((l) => l.status === "atrasado").length,
  };
}

/** Pessoa com qualquer lançamento, fechamento ou pagamento não pode ser excluída (só desativada). */
export function memberHasMovements(data: AppData, memberId: string): boolean {
  for (const day of data.days ?? []) {
    if (day.closing?.snapshot.members.some((m) => m.memberId === memberId)) return true;
    const e = day.entries[memberId];
    if (e && (e.present || e.salesCents > 0 || e.tipsCents > 0)) return true;
  }
  return (data.payments ?? []).some((p) => p.memberId === memberId);
}

// ---------- Metas ----------

export const goalFor = (data: AppData, month: string): Cents =>
  data.goals?.byMonth?.[month] ?? data.goals?.defaultCents ?? DEFAULT_GOAL_CENTS;

/** Ganhos conquistados acumulados dia a dia no mês (evolução da meta). */
export function cumulativeByDay(data: AppData, month: string, memberId: string) {
  let running = 0;
  return closedDays(data, `${month}-01`, `${month}-31`).map((day) => {
    running += day.closing!.members.find((m) => m.memberId === memberId)?.totalCents ?? 0;
    return { label: day.date.slice(8), value: running };
  });
}

// ---------- Comparativos históricos ----------

export interface Comparison {
  current?: Cents; previous?: Cents; avg3?: Cents; avg6?: Cents;
  best?: { month: string; value: Cents }; worst?: { month: string; value: Cents };
  deltaCents?: Cents; deltaPct?: number;
}

/** Usa só meses com movimento real; sem dado, o campo fica undefined ("Sem dados"). */
export function compareMonths(data: AppData, currentMonth: string): Comparison {
  const byMonth = new Map(groupByMonth(closedDays(data)).map((m) => [m.month, m.totalCents]));
  const average = (n: number) => {
    const values = Array.from({ length: n }, (_, i) => byMonth.get(shiftMonth(currentMonth, -i)))
      .filter((v): v is number => v !== undefined);
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : undefined;
  };
  const entries = [...byMonth.entries()].map(([month, value]) => ({ month, value }));
  const current = byMonth.get(currentMonth);
  const previous = byMonth.get(shiftMonth(currentMonth, -1));
  const deltaCents = current !== undefined && previous !== undefined ? current - previous : undefined;
  return {
    current, previous, avg3: average(3), avg6: average(6),
    best: entries.length ? entries.reduce((a, b) => (b.value > a.value ? b : a)) : undefined,
    worst: entries.length ? entries.reduce((a, b) => (b.value < a.value ? b : a)) : undefined,
    deltaCents,
    deltaPct: deltaCents !== undefined && previous! > 0 ? (deltaCents / previous!) * 100 : undefined,
  };
}