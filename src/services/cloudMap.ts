/**
 * Tradução entre o AppData do app e as tabelas do Supabase.
 * Código puro (sem rede) para poder ser testado: planChanges decide o que gravar.
 */
import type { AppData, Role, TeamHistoryEvent, TeamMember } from "../types";
import type { DayMemberEntry, DayRecord } from "../dayTypes";
import type { BonusAdjustment, ClosingResult, SaleStatus } from "../financeTypes";
import type { GoalSettings, PaymentRecord } from "../paymentTypes";

export interface MemberRow { id: string; name: string; role: string; active: boolean; created_at: string; updated_at: string | null; deactivated_at: string | null }
export interface DayRow { date: string; status: string; due_date: string | null; team_sales_cents: number | null; team_sales_status: string | null; closing: ClosingResult | null; closed_at: string | null }
export interface EntryRow { day_date: string; member_id: string; present: boolean; sales_cents: number; sales_status: string; tips_cents: number }
export interface BonusRow { day_date: string; member_id: string; original_base_cents: number; adjusted_base_cents: number; reason: string; created_at: string }
export interface PaymentRow { id: string; day_date: string; member_id: string; amount_cents: number; paid_at: string; note: string | null; created_at: string; voided_at: string | null; void_reason: string | null }
export interface GoalRow { month_key: string; amount_cents: number }
export interface HistoryRow { id: number; member_id: string; member_name: string; action: string; details: string | null; at: string }

export interface CloudRows {
  members: MemberRow[]; days: DayRow[]; entries: EntryRow[]; bonus: BonusRow[];
  payments: PaymentRow[]; goals: GoalRow[]; history: HistoryRow[];
}

export type Op =
  | { kind: "rpc"; fn: "ensure_day"; args: { d: string } }
  | { kind: "upsert"; table: string; rows: Record<string, unknown>[]; onConflict: string }
  | { kind: "insert"; table: string; rows: Record<string, unknown>[] }
  | { kind: "update"; table: string; patch: Record<string, unknown>; match: Record<string, unknown> }
  | { kind: "delete"; table: string; match: Record<string, unknown> };

const blankEntry = (): DayMemberEntry => ({ present: false, salesCents: 0, salesStatus: "confirmed", tipsCents: 0 });

export function buildAppData(rows: CloudRows): AppData {
  const members: TeamMember[] = rows.members.map((m) => ({
    id: m.id, name: m.name, role: m.role as Role, active: m.active, createdAt: m.created_at,
    ...(m.updated_at ? { updatedAt: m.updated_at } : {}),
    ...(m.deactivated_at ? { deactivatedAt: m.deactivated_at } : {}),
  }));

  const days = new Map<string, DayRecord>();
  for (const d of rows.days) {
    days.set(d.date, {
      date: d.date,
      entries: {},
      ...(d.due_date ? { dueDate: d.due_date } : {}),
      ...(d.team_sales_cents !== null ? { teamSalesCents: d.team_sales_cents } : {}),
      ...(d.team_sales_status ? { teamSalesStatus: d.team_sales_status as SaleStatus } : {}),
      ...(d.closing ? { closing: d.closing, ...(d.closed_at ? { closedAt: d.closed_at } : {}) } : {}),
    });
  }
  for (const e of rows.entries) {
    const day = days.get(e.day_date);
    if (!day) continue;
    day.entries[e.member_id] = {
      present: e.present, salesCents: e.sales_cents, salesStatus: e.sales_status as SaleStatus, tipsCents: e.tips_cents,
    };
  }
  for (const b of rows.bonus) {
    const day = days.get(b.day_date);
    if (!day) continue;
    const entry = day.entries[b.member_id] ?? (day.entries[b.member_id] = blankEntry());
    entry.bonusAdjustment = {
      originalBaseCents: b.original_base_cents, adjustedBaseCents: b.adjusted_base_cents, reason: b.reason, date: b.created_at,
    };
  }

  const payments: PaymentRecord[] = rows.payments.map((p) => ({
    id: p.id, date: p.day_date, memberId: p.member_id, amountCents: p.amount_cents, paidAt: p.paid_at, createdAt: p.created_at,
    ...(p.note ? { note: p.note } : {}),
    ...(p.voided_at ? { voidedAt: p.voided_at } : {}),
    ...(p.void_reason ? { voidReason: p.void_reason } : {}),
  }));

  const goals: GoalSettings = {};
  for (const g of rows.goals) {
    if (g.month_key === "default") goals.defaultCents = g.amount_cents;
    else (goals.byMonth ??= {})[g.month_key] = g.amount_cents;
  }

  const teamHistory: TeamHistoryEvent[] = rows.history.map((h) => ({
    id: String(h.id), memberId: h.member_id, memberName: h.member_name,
    action: h.action as TeamHistoryEvent["action"], details: h.details ?? "", createdAt: h.at,
  }));

  return {
    version: 1, members,
    teamHistory,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    payments, goals,
  };
}

const entryKey = (e?: DayMemberEntry) => (e ? `${e.present}|${e.salesCents}|${e.salesStatus}|${e.tipsCents}` : "");
const bonusKey = (b?: BonusAdjustment) => (b ? `${b.adjustedBaseCents}|${b.reason}` : "");

function dayPatch(before: DayRecord | undefined, day: DayRecord): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (before?.dueDate !== day.dueDate) patch.due_date = day.dueDate ?? null;
  if (before?.teamSalesCents !== day.teamSalesCents) patch.team_sales_cents = day.teamSalesCents ?? null;
  if (before?.teamSalesStatus !== day.teamSalesStatus) patch.team_sales_status = day.teamSalesStatus ?? null;
  const wasClosed = Boolean(before?.closing);
  const isClosed = Boolean(day.closing);
  if (wasClosed !== isClosed || (isClosed && JSON.stringify(before?.closing) !== JSON.stringify(day.closing))) {
    patch.status = isClosed ? "closed" : "open";
    patch.closing = day.closing ?? null;
  }
  return patch;
}

const goalMap = (g?: GoalSettings) => {
  const map = new Map<string, number>();
  if (g?.defaultCents !== undefined) map.set("default", g.defaultCents);
  for (const [month, cents] of Object.entries(g?.byMonth ?? {})) map.set(month, cents);
  return map;
};

/** Compara o que já está no servidor (prev) com o estado atual (next) e lista só as gravações necessárias, na ordem certa. */
export function planChanges(prev: AppData, next: AppData): Op[] {
  const ops: Op[] = [];

  // 1) Equipe (criar/editar)
  const prevMembers = new Map(prev.members.map((m) => [m.id, m]));
  const changedMembers = next.members.filter((m) => {
    const p = prevMembers.get(m.id);
    return !p || p.name !== m.name || p.role !== m.role || p.active !== m.active;
  });
  if (changedMembers.length) {
    ops.push({
      kind: "upsert", table: "members", onConflict: "id",
      rows: changedMembers.map((m) => ({ id: m.id, name: m.name, role: m.role, active: m.active, created_at: m.createdAt })),
    });
  }

  // 2) Dias: lançamentos, ajustes de bônus e fechamento
  const prevDays = new Map((prev.days ?? []).map((d) => [d.date, d]));
  for (const day of [...(next.days ?? [])].sort((a, b) => a.date.localeCompare(b.date))) {
    const before = prevDays.get(day.date);
    if (!before) ops.push({ kind: "rpc", fn: "ensure_day", args: { d: day.date } });

    const patch = dayPatch(before, day);
    const hasPatch = Object.keys(patch).length > 0;
    const reopening = Boolean(before?.closing) && !day.closing;
    const updateDay: Op = { kind: "update", table: "days", patch, match: { date: day.date } };
    if (hasPatch && reopening) ops.push(updateDay); // reabrir antes de mexer nos lançamentos

    const entryRows: Record<string, unknown>[] = [];
    for (const [memberId, entry] of Object.entries(day.entries)) {
      if (entryKey(before?.entries[memberId]) !== entryKey(entry)) {
        entryRows.push({
          day_date: day.date, member_id: memberId, present: entry.present,
          sales_cents: entry.salesCents, sales_status: entry.salesStatus, tips_cents: entry.tipsCents,
        });
      }
    }
    if (entryRows.length) ops.push({ kind: "upsert", table: "day_entries", onConflict: "day_date,member_id", rows: entryRows });

    const bonusRows: Record<string, unknown>[] = [];
    const memberIds = new Set([...Object.keys(day.entries), ...Object.keys(before?.entries ?? {})]);
    for (const memberId of memberIds) {
      const now = day.entries[memberId]?.bonusAdjustment;
      const was = before?.entries[memberId]?.bonusAdjustment;
      if (now && bonusKey(now) !== bonusKey(was)) {
        bonusRows.push({
          day_date: day.date, member_id: memberId, original_base_cents: now.originalBaseCents,
          adjusted_base_cents: now.adjustedBaseCents, reason: now.reason,
        });
      } else if (!now && was) {
        ops.push({ kind: "delete", table: "bonus_adjustments", match: { day_date: day.date, member_id: memberId } });
      }
    }
    if (bonusRows.length) ops.push({ kind: "upsert", table: "bonus_adjustments", onConflict: "day_date,member_id", rows: bonusRows });

    if (hasPatch && !reopening) ops.push(updateDay); // fechar depois de gravar os lançamentos
  }

  // 3) Pagamentos: só inserir e estornar (nunca editar/apagar)
  const prevPay = new Map((prev.payments ?? []).map((p) => [p.id, p]));
  const fresh = (next.payments ?? []).filter((p) => !prevPay.has(p.id));
  if (fresh.length) {
    ops.push({
      kind: "insert", table: "payments",
      rows: fresh.map((p) => ({
        id: p.id, day_date: p.date, member_id: p.memberId, amount_cents: p.amountCents,
        paid_at: p.paidAt, note: p.note ?? null, created_at: p.createdAt,
      })),
    });
  }
  for (const p of next.payments ?? []) {
    const wasVoided = Boolean(prevPay.get(p.id)?.voidedAt);
    if (!wasVoided && (p.voidedAt || p.voidReason)) {
      ops.push({ kind: "update", table: "payments", patch: { void_reason: p.voidReason ?? "Estornado" }, match: { id: p.id } });
    }
  }

  // 4) Metas
  const before = goalMap(prev.goals);
  const after = goalMap(next.goals);
  const goalRows = [...after].filter(([key, cents]) => before.get(key) !== cents).map(([key, cents]) => ({ month_key: key, amount_cents: cents }));
  if (goalRows.length) ops.push({ kind: "upsert", table: "goals", onConflict: "month_key", rows: goalRows });
  for (const key of before.keys()) {
    if (!after.has(key)) ops.push({ kind: "delete", table: "goals", match: { month_key: key } });
  }

  // 5) Exclusão de integrantes (por último)
  const nextIds = new Set(next.members.map((m) => m.id));
  for (const m of prev.members) {
    if (!nextIds.has(m.id)) ops.push({ kind: "delete", table: "members", match: { id: m.id } });
  }
  return ops;
}