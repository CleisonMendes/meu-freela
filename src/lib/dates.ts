const parse = (date: string) => new Date(`${date}T12:00:00`);
const iso = (d: Date) => d.toLocaleDateString("sv-SE");

/** Hoje no fuso local, YYYY-MM-DD. */
export const todayKey = () => iso(new Date());

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setDate(d.getDate() + days);
  return iso(d);
}

export function addMonths(date: string, months: number): string {
  const d = parse(date);
  d.setMonth(d.getMonth() + months);
  return iso(d);
}

export const monthKey = (date: string) => date.slice(0, 7);
export const shiftMonth = (month: string, n: number) => monthKey(addMonths(`${month}-01`, n));
export const formatDate = (date: string) => parse(date).toLocaleDateString("pt-BR");
export const monthLabel = (month: string) =>
  parse(`${month}-01`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
export const monthName = (month: string) =>
  parse(`${month}-01`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

export type Period = "today" | "week" | "month" | "30d" | "3m" | "6m" | "12m" | "custom";

export const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Hoje" },
  { id: "week", label: "Semana" },
  { id: "month", label: "Mês" },
  { id: "30d", label: "Últimos 30 dias" },
  { id: "3m", label: "3 meses" },
  { id: "6m", label: "6 meses" },
  { id: "12m", label: "12 meses" },
  { id: "custom", label: "Personalizado" },
];

export function periodRange(period: Period, today: string, custom: { from: string; to: string }) {
  const months = (n: number) => ({ from: addDays(addMonths(today, -n), 1), to: today });
  switch (period) {
    case "today": return { from: today, to: today };
    case "week": return { from: addDays(today, -((parse(today).getDay() + 6) % 7)), to: today };
    case "month": return { from: `${monthKey(today)}-01`, to: today };
    case "30d": return { from: addDays(today, -29), to: today };
    case "3m": return months(3);
    case "6m": return months(6);
    case "12m": return months(12);
    default: return custom;
  }
}