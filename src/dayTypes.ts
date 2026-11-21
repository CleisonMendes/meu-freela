import type { BonusAdjustment, Cents, ClosingResult, SaleStatus } from "./financeTypes";

export interface DayMemberEntry {
  present: boolean;
  salesCents: Cents;
  salesStatus: SaleStatus;
  tipsCents: Cents;
  bonusAdjustment?: BonusAdjustment;
}

export interface DayAuditEvent {
  at: string;
  action: "closed" | "reopened";
  note: string;
}

export interface DayRecord {
  /** YYYY-MM-DD */
  date: string;
  /** Lançamentos por memberId. */
  entries: Record<string, DayMemberEntry>;
  /** Total da equipe, se diferente da soma dos garçons. */
  teamSalesCents?: Cents;
  teamSalesStatus?: SaleStatus;
  /** Fechamento congelado (foto dos integrantes e valores). */
  closing?: ClosingResult;
  closedAt?: string;
  audit?: DayAuditEvent[];
  /** Data prevista de pagamento (YYYY-MM-DD). Se ausente, serviço + 3 dias. */
  dueDate?: string;
}