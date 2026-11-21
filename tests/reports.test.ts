import assert from "node:assert/strict";
import { calcClosing, DEFAULT_SETTINGS } from "../src/lib/finance";
import {
  aggregateByMember, closedDays, compareMonths, goalFor, memberHasMovements,
  paymentLines, summarizePayments,
} from "../src/lib/reports";
import { toCsv } from "../src/lib/exportFiles";
import { formatCents } from "../src/lib/money";
import type { AppData } from "../src/types";
import type { DayRecord } from "../src/dayTypes";
import type { PaymentRecord } from "../src/paymentTypes";

function makeDay(date: string, sales: number): DayRecord {
  const closing = calcClosing({
    date, settings: DEFAULT_SETTINGS,
    members: [
      { memberId: "1", name: "Cleison", role: "Garçom", present: true, salesCents: sales, salesStatus: "confirmed", tipsCents: 0 },
      { memberId: "2", name: "Caixa 1", role: "Caixa", present: true, salesCents: 0, salesStatus: "confirmed", tipsCents: 0 },
    ],
  });
  return { date, entries: {}, closing, closedAt: `${date}T23:00:00Z` };
}
let n = 0;
const pay = (date: string, memberId: string, amountCents: number, extra: Partial<PaymentRecord> = {}): PaymentRecord =>
  ({ id: `p${n++}`, date, memberId, amountCents, paidAt: date, createdAt: date, ...extra });

const d1 = makeDay("2026-10-10", 100_000);
const d2 = makeDay("2026-11-15", 222_900);
const base: AppData = { version: 1, members: [], days: [d1, d2] };
const D = "2026-11-15";
const of = (data: AppData, today: string, memberId = "1") =>
  paymentLines(data, today, D, D).find((l) => l.memberId === memberId)!;

// Ganhos conquistados do dia (confere com o motor)
assert.equal(of(base, "2026-11-16").earnedCents, 31_145); // 100 fixo + 100 bônus + 111,45 comissão
assert.equal(of(base, "2026-11-16", "2").earnedCents, 21_145);

// Vencimento padrão: serviço + 3 dias
assert.equal(of(base, "2026-11-16").dueDate, "2026-11-18");
assert.equal(of(base, "2026-11-16").status, "pendente");

// Pagamento parcial: saldo restante e status Parcial
const partial = { ...base, payments: [pay(D, "1", 20_000)] };
assert.equal(of(partial, "2026-11-16").status, "parcial");
assert.equal(of(partial, "2026-11-16").balanceCents, 11_145);

// Só vira Pago com o valor total
const full = { ...base, payments: [pay(D, "1", 20_000), pay(D, "1", 11_145)] };
assert.equal(of(full, "2026-11-16").status, "pago");
assert.equal(of(full, "2026-11-16").balanceCents, 0);

// Estorno: pagamento anulado não conta, mas continua no histórico
const voided = { ...base, payments: [pay(D, "1", 31_145, { voidedAt: "2026-11-16T10:00:00Z", voidReason: "erro" })] };
assert.equal(of(voided, "2026-11-16").status, "pendente");
assert.equal(of(voided, "2026-11-16").payments.length, 1);

// Atrasado: venceu sem quitar (parcial ou não)
assert.equal(of(partial, "2026-11-19").status, "atrasado");
assert.equal(of(base, "2026-11-19").status, "atrasado");
assert.equal(of(base, "2026-11-18").status, "pendente"); // no dia do vencimento ainda não está atrasado

// Vencimento editado
const moved: AppData = { ...base, days: [d1, { ...d2, dueDate: "2026-11-25" }] };
assert.equal(of(moved, "2026-11-19").status, "pendente");

// Divergência: pago a mais
assert.equal(of({ ...base, payments: [pay(D, "1", 40_000)] }, "2026-11-16").divergenceCents, 8_855);

// Resumo
const sum = summarizePayments(paymentLines(partial, "2026-11-16", D, D));
assert.equal(sum.paidCents, 20_000);
assert.equal(sum.pendingCents, 11_145 + 21_145);
assert.equal(sum.overdueCents, 0);

// Agregação por integrante
const agg = aggregateByMember(closedDays(base));
assert.equal(agg.find((r) => r.memberId === "1")!.totalCents, 20_000 + 31_145);
assert.equal(agg.find((r) => r.memberId === "1")!.days, 2);

// Metas: padrão R$ 4.000 e ajuste por mês
assert.equal(goalFor(base, "2026-11"), 400_000);
assert.equal(goalFor({ ...base, goals: { byMonth: { "2026-11": 500_000 } } }, "2026-11"), 500_000);
assert.equal(goalFor({ ...base, goals: { byMonth: { "2026-11": 500_000 } } }, "2026-10"), 400_000);

// Comparativos: só meses com movimento
const cmp = compareMonths(base, "2026-11");
assert.equal(cmp.current, 52_290);
assert.equal(cmp.previous, 35_000);
assert.equal(cmp.deltaCents, 17_290);
assert.equal(Math.round(cmp.deltaPct! * 10) / 10, 49.4);
assert.equal(cmp.avg3, 43_645); // média dos 2 meses com movimento, set/2026 não conta
assert.equal(cmp.best!.month, "2026-11");
assert.equal(cmp.worst!.month, "2026-10");
const empty = compareMonths(base, "2026-12");
assert.equal(empty.current, undefined);
assert.equal(empty.deltaCents, undefined);

// Exclusão de integrante com movimentação deve ser bloqueada
assert.equal(memberHasMovements(base, "1"), true);
assert.equal(memberHasMovements(base, "99"), false);
assert.equal(memberHasMovements({ ...base, payments: [pay(D, "3", 100)] }, "3"), true);

// CSV para Excel brasileiro
const csv = toCsv({ title: "T", subtitle: "S", headers: ["A", "B"], rows: [["x;y", formatCents(120_800)]], footer: ["Total", formatCents(120_800)] });
assert.ok(csv.startsWith("\uFEFF"));
assert.ok(csv.includes('"x;y";1.208,00'));
assert.ok(csv.includes("Total;1.208,00"));

console.log("OK: testes de pagamentos, metas e relatórios passaram.");