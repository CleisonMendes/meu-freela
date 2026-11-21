import assert from "node:assert/strict";
import { calcBonusCents, calcClosing, DEFAULT_SETTINGS } from "../src/lib/finance";
import { parseMoney, splitEvenly } from "../src/lib/money";
import type { ClosingMemberInput } from "../src/financeTypes";

// Regra original da especificação (comissão entre todos os integrantes do fechamento)
const S = { ...DEFAULT_SETTINGS, requirePresence: false };

// Tabela de bônus da especificação (seção 3)
const table: [string, number][] = [
  ["500", 0], ["990", 0], ["1000", 50], ["1500", 50],
  ["1990", 50], ["2000", 100], ["2990", 100], ["3000", 150],
];
for (const [vendas, bonus] of table) {
  assert.equal(calcBonusCents(parseMoney(vendas)!, S), bonus * 100, `bônus de ${vendas}`);
}

// Parser pt-BR
assert.equal(parseMoney("R$ 2.229,00"), 222_900);
assert.equal(parseMoney("1.000"), 100_000);
assert.equal(parseMoney("50,5"), 5_050);
assert.equal(parseMoney("50.50"), 5_050);
assert.equal(parseMoney("abc"), null);

// Seção 4: R$ 1.200,00 ÷ 7 soma exatamente R$ 1.200,00
const parts = splitEvenly(120_000, 7);
assert.equal(parts.reduce((a, b) => a + b, 0), 120_000);
assert.equal(Math.max(...parts), 17_143);

// Seção 14: fechamento demonstrativo de 15/11/2026
const mk = (id: string, name: string, role: ClosingMemberInput["role"], sales = 0, present = false): ClosingMemberInput =>
  ({ memberId: id, name, role, present, salesCents: sales, salesStatus: "confirmed", tipsCents: 0 });

const members: ClosingMemberInput[] = [
  { ...mk("1", "Cleison", "Garçom", 222_900, true) },
  { ...mk("2", "Garçom 2", "Garçom", 210_000), salesStatus: "estimated" },
  { ...mk("3", "Garçom 3", "Garçom", 205_000), salesStatus: "estimated" },
  mk("4", "Caixa 1", "Caixa"),
  mk("5", "Bar 1", "Bar"),
  mk("6", "Cozinha 1", "Cozinha"),
  mk("7", "Cozinha 2", "Cozinha"),
];
const r = calcClosing({ date: "2026-11-15", members, settings: S });

assert.equal(r.teamSalesCents, 637_900);
assert.equal(r.commissionTotalCents, 63_790);
assert.equal(r.eligibleCount, 7);
assert.equal(r.totals.commissionCents, 63_790); // soma exata
assert.equal(r.hasEstimates, true);
const cleison = r.members.find((m) => m.name === "Cleison")!;
assert.equal(cleison.fixedCents, 10_000);
assert.equal(cleison.bonusCents, 10_000);
assert.equal(cleison.commissionCents, 9_113);
assert.equal(cleison.totalCents, 29_113); // R$ 291,13
assert.equal(r.members.find((m) => m.name === "Caixa 1")!.bonusCents, 0);
assert.equal(r.members.find((m) => m.name === "Garçom 2")!.fixedCents, 0); // ausente

// Exceção de bônus: base ajustada não altera vendas nem comissão
const adj = members.map((m) =>
  m.memberId === "2"
    ? { ...m, salesCents: 199_000, bonusAdjustment: { originalBaseCents: 199_000, adjustedBaseCents: 200_000, reason: "autorizado", date: "2026-11-15T22:00:00Z" } }
    : m);
const r2 = calcClosing({ date: "2026-11-15", members: adj, settings: S });
assert.equal(r2.members.find((m) => m.memberId === "2")!.bonusCents, 10_000);
assert.equal(r2.members.find((m) => m.memberId === "2")!.salesCents, 199_000);
assert.equal(r2.teamSalesCents, 222_900 + 199_000 + 205_000);

// Snapshot imutável: mudar a entrada depois não altera o fechamento
members[0].name = "Outro";
assert.equal(r.snapshot.members[0].name, "Cleison");

// Regra atual do app: só quem está marcado como presente recebe e divide a comissão
const P = DEFAULT_SETTINGS;
assert.equal(P.requirePresence, true);
const day = [
  mk("1", "Cleison", "Garçom", 222_900, true),
  mk("2", "Garçom 2", "Garçom", 210_000, true),
  mk("3", "Garçom 3", "Garçom", 205_000, false),
  mk("4", "Caixa 1", "Caixa", 0, true),
  mk("5", "Bar 1", "Bar"),
];
const rp = calcClosing({ date: "2026-11-15", members: day, settings: P });
assert.equal(rp.teamSalesCents, 637_900); // total soma todas as vendas lançadas
assert.equal(rp.eligibleCount, 3);
assert.equal(rp.totals.commissionCents, 63_790); // soma exata entre os 3 presentes
const ausente = rp.members.find((m) => m.name === "Garçom 3")!;
assert.deepEqual([ausente.fixedCents, ausente.bonusCents, ausente.commissionCents, ausente.totalCents], [0, 0, 0, 0]);
assert.equal(rp.members.find((m) => m.name === "Cleison")!.bonusCents, 10_000);
assert.equal(rp.members.find((m) => m.name === "Bar 1")!.commissionCents, 0);
assert.ok(rp.warnings.some((w) => w.includes("Garçom 3")));

// Ninguém marcado: nada é distribuído e aparece aviso
const none = calcClosing({ date: "2026-11-15", members: day.map((m) => ({ ...m, present: false })), settings: P });
assert.equal(none.totals.commissionCents, 0);
assert.equal(none.totals.bonusCents, 0);
assert.ok(none.warnings.some((w) => w.includes("Nenhum integrante")));

console.log("OK: todos os testes do motor financeiro passaram.");