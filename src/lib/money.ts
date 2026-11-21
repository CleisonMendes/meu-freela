import type { Cents } from "../financeTypes";

export function assertCents(value: number, label = "valor"): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} deve ser um número inteiro de centavos (>= 0). Recebido: ${value}`);
  }
}

/** Converte texto digitado ("2.229,00", "R$ 1.000", "50,5", "50.50") em centavos. Retorna null se inválido. */
export function parseMoney(input: string): Cents | null {
  let text = input.replace(/R\$/gi, "").replace(/\s/g, "");
  if (!text) return null;
  if (text.includes(",")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, "");
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const reais = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0") || "0");
  const total = reais * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

export function formatCents(cents: Cents): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Divide `total` em `count` parcelas inteiras cuja soma é exatamente `total`.
 * Os centavos que sobram vão, um a um, para as primeiras parcelas.
 */
export function splitEvenly(total: Cents, count: number): Cents[] {
  assertCents(total, "total");
  if (!Number.isInteger(count) || count <= 0) return [];
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}