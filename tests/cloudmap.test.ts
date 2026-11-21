import assert from "node:assert/strict";
import { buildAppData, planChanges, type CloudRows } from "../src/services/cloudMap";
import type { AppData } from "../src/types";
import type { DayRecord } from "../src/dayTypes";

const rows: CloudRows = {
  members: [
    { id: "m1", name: "Cleison", role: "Garçom", active: true, created_at: "2026-11-01T10:00:00Z", updated_at: null, deactivated_at: null },
    { id: "m2", name: "Nayara", role: "Caixa", active: true, created_at: "2026-11-01T10:00:00Z", updated_at: null, deactivated_at: null },
  ],
  days: [{ date: "2026-11-15", status: "open", due_date: "2026-11-18", team_sales_cents: null, team_sales_status: null, closing: null, closed_at: null }],
  entries: [{ day_date: "2026-11-15", member_id: "m1", present: true, sales_cents: 222900, sales_status: "confirmed", tips_cents: 0 }],
  bonus: [], payments: [], goals: [{ month_key: "default", amount_cents: 400000 }], history: [],
};

const base = buildAppData(rows);
const clone = (d: AppData): AppData => structuredClone(d);

// ida e volta: nada mudou => nada a gravar
assert.equal(base.days?.[0].dueDate, "2026-11-18");
assert.equal(base.days?.[0].entries.m1.salesCents, 222900);
assert.equal(base.goals?.defaultCents, 400000);
assert.deepEqual(planChanges(base, clone(base)), []);

// novo integrante => upsert em members
let next = clone(base);
next.members.push({ id: "m3", name: "Gleyce", role: "Garçom", active: true, createdAt: "2026-11-16T10:00:00Z" });
let ops = planChanges(base, next);
assert.equal(ops.length, 1);
assert.equal(ops[0].kind, "upsert");

// editar só o lançamento de m1 => um upsert com 1 linha, sem tocar em m2
next = clone(base);
next.days![0].entries.m1.tipsCents = 5000;
ops = planChanges(base, next);
assert.equal(ops.length, 1);
assert.ok(ops[0].kind === "upsert" && ops[0].table === "day_entries" && ops[0].rows.length === 1);

// dia novo => ensure_day primeiro, depois o lançamento; sem mexer em due_date
next = clone(base);
const novoDia: DayRecord = { date: "2026-11-16", entries: { m2: { present: true, salesCents: 0, salesStatus: "confirmed", tipsCents: 3000 } } };
next.days!.push(novoDia);
ops = planChanges(base, next);
assert.deepEqual(ops.map((o) => o.kind), ["rpc", "upsert"]);

// fechar: lançamentos antes, update do dia por último; reabrir: update do dia primeiro
next = clone(base);
next.days![0].entries.m1.present = false;
next.days![0].closing = { date: "2026-11-15", ok: true } as never;
ops = planChanges(base, next);
assert.deepEqual(ops.map((o) => o.kind), ["upsert", "update"]);
const upd = ops[1];
assert.ok(upd.kind === "update" && upd.patch.status === "closed" && !("due_date" in upd.patch));
const closed = clone(next);
const reopened = clone(closed);
delete reopened.days![0].closing;
reopened.days![0].entries.m1.present = true;
ops = planChanges(closed, reopened);
assert.deepEqual(ops.map((o) => o.kind), ["update", "upsert"]);
assert.ok(ops[0].kind === "update" && ops[0].patch.status === "open" && ops[0].patch.closing === null);

// ajuste de bônus: cria e remove
next = clone(base);
next.days![0].entries.m1.bonusAdjustment = { originalBaseCents: 199000, adjustedBaseCents: 200000, reason: "autorizado", date: "x" };
ops = planChanges(base, next);
assert.ok(ops.some((o) => o.kind === "upsert" && o.table === "bonus_adjustments"));
const comBonus = clone(next);
delete comBonus.days![0].entries.m1.bonusAdjustment;
assert.ok(planChanges(next, comBonus).some((o) => o.kind === "delete" && o.table === "bonus_adjustments"));

// pagamentos: insere uma vez; estorno só atualiza o motivo
next = clone(base);
next.payments = [{ id: "p1", date: "2026-11-15", memberId: "m1", amountCents: 20000, paidAt: "2026-11-18", createdAt: "2026-11-18T12:00:00Z" }];
ops = planChanges(base, next);
assert.deepEqual(ops.map((o) => o.kind), ["insert"]);
assert.deepEqual(planChanges(next, clone(next)), []);
const voided = clone(next);
voided.payments![0].voidedAt = "2026-11-18T13:00:00Z";
voided.payments![0].voidReason = "valor errado";
ops = planChanges(next, voided);
assert.deepEqual(ops.map((o) => o.kind), ["update"]);
assert.equal(planChanges(voided, clone(voided)).length, 0);

// metas: altera padrão, cria mês, remove mês
next = clone(base);
next.goals = { defaultCents: 500000, byMonth: { "2026-11": 450000 } };
ops = planChanges(base, next);
assert.ok(ops[0].kind === "upsert" && ops[0].rows.length === 2);
const semMes = clone(next);
semMes.goals = { defaultCents: 500000 };
assert.ok(planChanges(next, semMes).some((o) => o.kind === "delete" && o.table === "goals"));

// excluir integrante => delete por último
next = clone(base);
next.members = next.members.filter((m) => m.id !== "m2");
ops = planChanges(base, next);
assert.ok(ops.length === 1 && ops[0].kind === "delete");

console.log("OK: testes da sincronização com o banco passaram.");