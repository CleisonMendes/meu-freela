export interface ReportTable {
  title: string;
  subtitle: string;
  headers: string[];
  rows: string[][];
  footer?: string[];
}

/** CSV para Excel brasileiro: separador ";", BOM UTF-8 e valores sem "R$". */
export function toCsv(table: ReportTable): string {
  const clean = (cell: string) => cell.replace(/^R\$[\s\u00a0]*/, "").replace(/\u00a0/g, " ");
  const escape = (cell: string) => (/[;"\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  const line = (cells: string[]) => cells.map((c) => escape(clean(c))).join(";");
  const out = [table.title, table.subtitle, "", line(table.headers), ...table.rows.map(line)];
  if (table.footer) out.push(line(table.footer));
  return `\uFEFF${out.join("\r\n")}`;
}

export function downloadCsv(filename: string, table: ReportTable): void {
  const blob = new Blob([toCsv(table)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}