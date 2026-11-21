import type { Cents } from "./financeTypes";

/** Um recebimento confirmado manualmente. Nunca é apagado: o estorno só o marca como anulado. */
export interface PaymentRecord {
  id: string;
  /** Data do serviço (dia fechado) a que o pagamento se refere, YYYY-MM-DD. */
  date: string;
  memberId: string;
  amountCents: Cents;
  /** Data em que o dinheiro foi efetivamente pago, YYYY-MM-DD. */
  paidAt: string;
  note?: string;
  createdAt: string;
  voidedAt?: string;
  voidReason?: string;
}

export interface GoalSettings {
  /** Meta padrão mensal (se ausente, R$ 4.000,00). */
  defaultCents?: Cents;
  /** Meta específica por mês, chave YYYY-MM. */
  byMonth?: Record<string, Cents>;
}