import type { Role } from "./types";

/** Todos os valores monetários do motor financeiro são CENTAVOS INTEIROS. */
export type Cents = number;

export type SaleStatus = "confirmed" | "estimated";

export interface FinanceSettings {
  /** Fixo por diária trabalhada (padrão: 10000 = R$ 100,00). */
  dailyFixedCents: Cents;
  /** Comissão coletiva em pontos-base (1000 = 10%). */
  commissionRateBps: number;
  /** A cada quantos centavos de venda o garçom ganha bônus (padrão: 100000 = R$ 1.000,00). */
  bonusStepCents: Cents;
  /** Bônus por faixa completa (padrão: 5000 = R$ 50,00). */
  bonusPerStepCents: Cents;
  /**
   * true: só quem está marcado como presente recebe fixo, bônus e comissão,
   * e a comissão coletiva é dividida apenas entre os presentes.
   * false: regra original da especificação (comissão dividida entre todos os
   * integrantes do fechamento, presentes ou não).
   */
  requirePresence: boolean;
}

export interface BonusAdjustment {
  /** Base original (as vendas reais do garçom). */
  originalBaseCents: Cents;
  /** Base autorizada para o cálculo do bônus. */
  adjustedBaseCents: Cents;
  reason: string;
  /** ISO 8601. */
  date: string;
  by?: string;
}

/** Linha de um integrante dentro de um fechamento (foto do momento). */
export interface ClosingMemberInput {
  memberId: string;
  name: string;
  role: Role;
  present: boolean;
  /** Vendas individuais (só relevante para Garçom). */
  salesCents: Cents;
  salesStatus: SaleStatus;
  bonusAdjustment?: BonusAdjustment;
  tipsCents: Cents;
}

export interface ClosingInput {
  /** YYYY-MM-DD */
  date: string;
  /**
   * Todos os integrantes elegíveis no momento do fechamento.
   * A comissão coletiva é dividida entre TODOS eles, presentes ou não.
   */
  members: ClosingMemberInput[];
  /**
   * Total de vendas da equipe, se informado separadamente.
   * Se omitido, usa a soma das vendas individuais.
   * NUNCA é somado às vendas individuais (evita duplicidade).
   */
  teamSalesCents?: Cents;
  teamSalesStatus?: SaleStatus;
  settings: FinanceSettings;
}

export interface MemberEarnings {
  memberId: string;
  name: string;
  role: Role;
  present: boolean;
  salesCents: Cents;
  fixedCents: Cents;
  bonusBaseCents: Cents;
  bonusCents: Cents;
  commissionCents: Cents;
  tipsCents: Cents;
  /** fixo + bônus + comissão + caixinhas (ganho conquistado). */
  totalCents: Cents;
}

export interface ClosingResult {
  date: string;
  settings: FinanceSettings;
  teamSalesCents: Cents;
  commissionTotalCents: Cents;
  eligibleCount: number;
  /** True se alguma base de venda usada no cálculo é estimada. */
  hasEstimates: boolean;
  members: MemberEarnings[];
  totals: {
    fixedCents: Cents;
    bonusCents: Cents;
    commissionCents: Cents;
    tipsCents: Cents;
    totalCents: Cents;
  };
  warnings: string[];
  /** Cópia da entrada: o fechamento não depende de mudanças futuras na equipe. */
  snapshot: ClosingInput;
}