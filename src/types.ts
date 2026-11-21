import type { DayRecord } from "./dayTypes";
import type { GoalSettings, PaymentRecord } from "./paymentTypes";

export type Role = "Garçom" | "Caixa" | "Bar" | "Cozinha";

export interface TeamMember {
  id: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
  deactivatedAt?: string;
}

export interface TeamHistoryEvent {
  id: string;
  memberId: string;
  memberName: string;
  action: "created" | "updated" | "role_changed" | "deactivated" | "reactivated" | "deleted";
  details: string;
  createdAt: string;
}

export interface AppData {
  version: 1;
  members: TeamMember[];
  teamHistory?: TeamHistoryEvent[];
  /** Lançamentos e fechamentos diários (opcional: dados antigos continuam válidos). */
  days?: DayRecord[];
  /** Recebimentos confirmados (parciais ou totais). */
  payments?: PaymentRecord[];
  goals?: GoalSettings;
}

export const ROLES: Role[] = ["Garçom", "Caixa", "Bar", "Cozinha"];