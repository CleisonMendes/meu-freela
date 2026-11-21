import type { AppData } from "../types";
import { supabase } from "../lib/supabase";
import {
  buildAppData, planChanges,
  type BonusRow, type DayRow, type EntryRow, type GoalRow, type HistoryRow, type MemberRow, type Op, type PaymentRow,
} from "./cloudMap";

function client() {
  if (!supabase) throw new Error("Supabase não configurado (.env.local ausente).");
  return supabase;
}

/** Lê todas as linhas de uma tabela, em páginas de 1000. */
async function fetchAll<T>(table: string, order: string[]): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    let query = client().from(table).select("*");
    for (const column of order) query = query.order(column);
    const { data, error } = await query.range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export async function loadCloudData(): Promise<AppData> {
  const [members, days, entries, bonus, payments, goals, history] = await Promise.all([
    fetchAll<MemberRow>("members", ["id"]),
    fetchAll<DayRow>("days", ["date"]),
    fetchAll<EntryRow>("day_entries", ["day_date", "member_id"]),
    fetchAll<BonusRow>("bonus_adjustments", ["day_date", "member_id"]),
    fetchAll<PaymentRow>("payments", ["id"]),
    fetchAll<GoalRow>("goals", ["month_key"]),
    fetchAll<HistoryRow>("member_history", ["id"]),
  ]);
  return buildAppData({ members, days, entries, bonus, payments, goals, history });
}

async function run(op: Op): Promise<void> {
  const db = client();
  switch (op.kind) {
    case "rpc": {
      const { error } = await db.rpc(op.fn, op.args);
      if (error) throw error;
      return;
    }
    case "upsert": {
      const { error } = await db.from(op.table).upsert(op.rows, { onConflict: op.onConflict });
      if (error) throw error;
      return;
    }
    case "insert": {
      const { error } = await db.from(op.table).insert(op.rows);
      if (error) throw error;
      return;
    }
    case "update": {
      const { data, error } = await db.from(op.table).update(op.patch).match(op.match).select();
      if (error) throw error;
      if (!data?.length) throw new Error("Sem permissão para essa alteração (ou o registro não existe mais).");
      return;
    }
    case "delete": {
      const { data, error } = await db.from(op.table).delete().match(op.match).select();
      if (error) throw error;
      if (!data?.length) throw new Error("Sem permissão para excluir (ou o registro não existe mais).");
      return;
    }
  }
}

/** Grava no servidor apenas o que mudou entre `prev` (já salvo) e `next`. */
export async function saveCloudChanges(prev: AppData, next: AppData): Promise<void> {
  for (const op of planChanges(prev, next)) await run(op);
}

export function describeError(error: unknown): string {
  const message =
    error instanceof Error ? error.message
    : typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message)
    : "Erro desconhecido.";
  const detail = /row-level security|permission denied/i.test(message)
    ? "Você não tem permissão para fazer essa alteração."
    : message;
  return `${detail} A tela foi atualizada com os dados do servidor.`;
}