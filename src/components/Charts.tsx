interface Item { label: string; value: number }

const compact = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);

/** Colunas verticais (evolução no tempo). Valores em centavos. */
export function ColumnChart({ items, format }: { items: Item[]; format: (v: number) => string }) {
  if (items.length === 0) return <p className="muted">Sem dados</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  const slot = 48;
  const h = 150;
  const width = Math.max(items.length * slot, 300);
  return (
    <div className="chart-scroll">
      <svg width={width} height={h + 44} role="img" aria-label="Gráfico de colunas">
        {items.map((item, i) => {
          const barH = Math.round((item.value / max) * h);
          const x = i * slot + 8;
          const cx = x + (slot - 16) / 2;
          return (
            <g key={`${item.label}-${i}`}>
              <rect x={x} y={h - barH + 18} width={slot - 16} height={barH} rx={4} fill="#4b8cff">
                <title>{`${item.label}: ${format(item.value)}`}</title>
              </rect>
              <text x={cx} y={h - barH + 12} textAnchor="middle" fontSize="9" fill="#a9bad1">{compact(item.value)}</text>
              <text x={cx} y={h + 34} textAnchor="middle" fontSize="10" fill="#8192aa">{item.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Barras horizontais (rankings). */
export function BarList({ items, format }: { items: Item[]; format: (v: number) => string }) {
  if (items.length === 0) return <p className="muted">Sem dados</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="bar-list">
      {items.map((item, i) => (
        <div className="bar-row" key={item.label}>
          <span className="bar-rank">{i + 1}º</span>
          <span className="bar-label">{item.label}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(item.value / max) * 100}%` }} /></div>
          <strong>{format(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}

/** Barra empilhada com legenda (composição / recebido x pendente). */
export function StackBar({ segments, format }: { segments: { label: string; value: number; color: string }[]; format: (v: number) => string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return <p className="muted">Sem dados</p>;
  return (
    <div>
      <div className="stack-bar">
        {segments.filter((s) => s.value > 0).map((s) => (
          <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${format(s.value)}`} />
        ))}
      </div>
      <ul className="stack-legend">
        {segments.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.color }} />{s.label}
            <strong>{format(s.value)}</strong>
            <span>{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}