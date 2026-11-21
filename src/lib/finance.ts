import type {
  Cents, ClosingInput, ClosingResult, FinanceSettings, MemberEarnings,
} from "../financeTypes";
import { assertCents, splitEvenly } from "./money";

export const DEFAULT_SETTINGS: FinanceSettings = {
  dailyFixedCents: 10_000,
  commissionRateBps: 1_000,
  bonusStepCents: 100_000,
  bonusPerStepCents: 5_000,
  requirePresence: true,
};

/** Bônus = floor(base / 1000,00) × 50,00. Sem arredondamento automático. */
export function calcBonusCents(baseCents: Cents, s: FinanceSettings): Cents {
  assertCents(baseCents, "base do bônus");
  return Math.floor(baseCents / s.bonusStepCents) * s.bonusPerStepCents;
}

/** Comissão coletiva total (arredondada ao centavo, meio para cima). */
export function calcCommissionTotalCents(teamSalesCents: Cents, s: FinanceSettings): Cents {
  assertCents(teamSalesCents, "vendas da equipe");
  return Math.round((teamSalesCents * s.commissionRateBps) / 10_000);
}

export function calcClosing(input: ClosingInput): ClosingResult {
  const { settings, members } = input;
  const warnings: string[] = [];

  const ids = new Set<string>();
  for (const m of members) {
    if (ids.has(m.memberId)) throw new Error(`Integrante duplicado no fechamento: ${m.name}`);
    ids.add(m.memberId);
    assertCents(m.salesCents, `vendas de ${m.name}`);
    assertCents(m.tipsCents, `caixinha de ${m.name}`);
  }

  const individualSum = members.reduce((sum, m) => sum + m.salesCents, 0);
  const teamSalesCents = input.teamSalesCents ?? individualSum;
  if (input.teamSalesCents !== undefined && input.teamSalesCents < individualSum) {
    warnings.push("O total da equipe é menor que a soma das vendas individuais. Confira os valores.");
  }

  const commissionTotalCents = calcCommissionTotalCents(teamSalesCents, settings);

  // Ordem determinística para distribuir os centavos que sobram.
  const ordered = [...members].sort(
    (a, b) => a.name.localeCompare(b.name, "pt-BR") || a.memberId.localeCompare(b.memberId),
  );

  // Quem divide a comissão: só os presentes (regra atual) ou todos (regra original).
  const sharing = settings.requirePresence ? ordered.filter((m) => m.present) : ordered;
  const shares = splitEvenly(commissionTotalCents, sharing.length);
  const shareById = new Map<string, Cents>(sharing.map((m, i) => [m.memberId, shares[i]]));
  if (sharing.length === 0 && commissionTotalCents > 0) {
    warnings.push("Nenhum integrante marcado como presente: a comissão ainda não foi distribuída.");
  }

  const rows: MemberEarnings[] = ordered.map((m) => {
    const isWaiter = m.role === "Garçom";
    const earns = !settings.requirePresence || m.present;
    const fixedCents = m.present ? settings.dailyFixedCents : 0;
    const bonusBaseCents = isWaiter && earns ? (m.bonusAdjustment?.adjustedBaseCents ?? m.salesCents) : 0;
    const bonusCents = isWaiter && earns ? calcBonusCents(bonusBaseCents, settings) : 0;
    const commissionCents = shareById.get(m.memberId) ?? 0;
    if (!isWaiter && m.salesCents > 0) {
      warnings.push(`${m.name} (${m.role}) tem vendas lançadas, mas só garçons recebem bônus.`);
    }
    if (!m.present && m.salesCents > 0) {
      warnings.push(
        settings.requirePresence
          ? `${m.name} tem vendas, mas não está marcado como presente: não recebe fixo, bônus nem comissão.`
          : `${m.name} tem vendas, mas está marcado como ausente (sem fixo).`,
      );
    }
    return {
      memberId: m.memberId,
      name: m.name,
      role: m.role,
      present: m.present,
      salesCents: m.salesCents,
      fixedCents,
      bonusBaseCents,
      bonusCents,
      commissionCents,
      tipsCents: m.tipsCents,
      totalCents: fixedCents + bonusCents + commissionCents + m.tipsCents,
    };
  });

  const sum = (pick: (r: MemberEarnings) => Cents) => rows.reduce((acc, r) => acc + pick(r), 0);
  const hasEstimates =
    input.teamSalesStatus === "estimated" ||
    members.some((m) => m.salesStatus === "estimated" && m.salesCents > 0);

  return {
    date: input.date,
    settings: { ...settings },
    teamSalesCents,
    commissionTotalCents,
    eligibleCount: sharing.length,
    hasEstimates,
    members: rows,
    totals: {
      fixedCents: sum((r) => r.fixedCents),
      bonusCents: sum((r) => r.bonusCents),
      commissionCents: sum((r) => r.commissionCents),
      tipsCents: sum((r) => r.tipsCents),
      totalCents: sum((r) => r.totalCents),
    },
    warnings,
    snapshot: structuredClone(input),
  };
}