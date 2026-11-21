import type { ClosingInput, ClosingMemberInput } from "../../financeTypes";
import type { DayMemberEntry, DayRecord } from "../../dayTypes";
import type { Role } from "../../types";
import { DEFAULT_SETTINGS } from "../../lib/finance";

export interface RosterMember {
  id: string;
  name: string;
  role: Role;
}

/** Data de hoje no fuso local, no formato YYYY-MM-DD. */
export const todayKey = () => new Date().toLocaleDateString("sv-SE");

export const emptyEntry = (): DayMemberEntry => ({
  present: false,
  salesCents: 0,
  salesStatus: "confirmed",
  tipsCents: 0,
});

export function buildClosingInput(
  date: string,
  roster: RosterMember[],
  record: DayRecord,
): ClosingInput {
  const members: ClosingMemberInput[] = roster.map((member) => {
    const entry = record.entries[member.id] ?? emptyEntry();
    const isWaiter = member.role === "Garçom";
    const salesCents = isWaiter ? entry.salesCents : 0;
    return {
      memberId: member.id,
      name: member.name,
      role: member.role,
      present: entry.present,
      salesCents,
      salesStatus: entry.salesStatus,
      tipsCents: entry.tipsCents,
      bonusAdjustment: isWaiter && entry.bonusAdjustment
        ? { ...entry.bonusAdjustment, originalBaseCents: salesCents }
        : undefined,
    };
  });
  return {
    date,
    members,
    teamSalesCents: record.teamSalesCents,
    teamSalesStatus: record.teamSalesStatus,
    settings: DEFAULT_SETTINGS,
  };
}