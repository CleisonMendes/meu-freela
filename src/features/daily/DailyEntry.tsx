import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Lock, Pencil, Unlock } from "lucide-react";
import type { AppData } from "../../types";
import type { SaleStatus } from "../../financeTypes";
import type { DayMemberEntry, DayRecord } from "../../dayTypes";
import { calcClosing } from "../../lib/finance";
import { formatCents, parseMoney } from "../../lib/money";
import MoneyInput from "../../components/MoneyInput";
import { buildClosingInput, emptyEntry, todayKey, type RosterMember } from "./dayModel";
import "./daily.css";
import ConfirmDialog from "../../components/ConfirmDialog";
import { canEditMember, isStaff, useMe } from "../../auth/access";

interface Props {
  data: AppData;
  setData: Dispatch<SetStateAction<AppData>>;
}

export default function DailyEntry({ data, setData }: Props) {
  const me = useMe();
  const staff = isStaff(me);
  const [date, setDate] = useState(todayKey());
  const [dialog, setDialog] = useState<"close" | "reopen" | "blocked" | null>(null);
  const record: DayRecord = data.days?.find((day) => day.date === date) ?? { date, entries: {} };
  const closing = record.closing;
  const closed = Boolean(closing);
  const prettyDate = new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR");

  // Dia aberto: só integrantes ATIVOS entram na divisão da comissão.
  // Dia fechado: usa a foto guardada no fechamento.
  const roster: RosterMember[] = useMemo(
    () =>
      closing
        ? closing.snapshot.members.map((m) => ({ id: m.memberId, name: m.name, role: m.role }))
        : data.members.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name, role: m.role })),
    [closing, data.members],
  );

  const live = (() => {
    if (closing) return { result: closing, error: "" };
    try {
      return { result: calcClosing(buildClosingInput(date, roster, record)), error: "" };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : "Erro no cálculo." };
    }
  })();

  function patchRecord(change: (current: DayRecord) => DayRecord) {
    setData((current) => {
      const days = current.days ?? [];
      const base = days.find((day) => day.date === date) ?? { date, entries: {} };
      return { ...current, days: [...days.filter((day) => day.date !== date), change(base)] };
    });
  }

  function patchEntry(memberId: string, change: Partial<DayMemberEntry>) {
    patchRecord((current) => ({
      ...current,
      entries: {
        ...current.entries,
        [memberId]: { ...emptyEntry(), ...current.entries[memberId], ...change },
      },
    }));
  }

  function adjustBonus(memberId: string, name: string, salesCents: number) {
    const raw = window.prompt(
      `Base autorizada para o bônus de ${name} (vendas reais: ${formatCents(salesCents)}).\nDeixe vazio para remover o ajuste.`,
    );
    if (raw === null) return;
    if (raw.trim() === "") {
      patchEntry(memberId, { bonusAdjustment: undefined });
      return;
    }
    const base = parseMoney(raw);
    if (base === null) {
      window.alert("Valor inválido.");
      return;
    }
    const reason = window.prompt("Motivo do ajuste (obrigatório):")?.trim();
    if (!reason) {
      window.alert("Informe o motivo para registrar o ajuste.");
      return;
    }
    patchEntry(memberId, {
      bonusAdjustment: {
        originalBaseCents: salesCents,
        adjustedBaseCents: base,
        reason,
        date: new Date().toISOString(),
      },
    });
  }

  function requestClose() {
    if (staff && live.result) setDialog("close");
  }

  function confirmClose() {
    setDialog(null);
    const result = live.result;
    if (!result || !staff) return;
    const at = new Date().toISOString();
    patchRecord((current) => ({
      ...current,
      closing: result,
      closedAt: at,
      audit: [...(current.audit ?? []), { at, action: "closed", note: `Fechamento com ${result.eligibleCount} integrante(s).` }],
    }));
  }

  function requestReopen() {
    const hasPayments = (data.payments ?? []).some((p) => p.date === date && !p.voidedAt);
    setDialog(hasPayments ? "blocked" : "reopen");
  }

  function confirmReopen() {
    setDialog(null);
    const at = new Date().toISOString();
    patchRecord((current) => ({
      ...current,
      closing: undefined,
      closedAt: undefined,
      audit: [...(current.audit ?? []), { at, action: "reopened", note: "Dia reaberto para correção." }],
    }));
  }

  const result = live.result;
  const presentCount = result ? result.members.filter((m) => m.present).length : 0;
  const autoTotalCents = result ? result.members.reduce((sum, m) => sum + m.salesCents, 0) : 0;
  const manualTotal = record.teamSalesCents !== undefined;

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">OPERAÇÃO DO DIA</span>
          <h3>
            Lançamento diário
            {result?.hasEstimates && <span className="estimate-badge">Valores parcialmente estimados</span>}
          </h3>
          <p className="muted">
            {closing && record.closedAt
              ? `Dia fechado em ${new Date(record.closedAt).toLocaleString("pt-BR")}`
              : `${presentCount} de ${roster.length} integrante(s) marcado(s) como presente(s)`}
          </p>
        </div>
        {!staff ? null : closed ? (
          <button className="subtle-button" onClick={requestReopen}><Unlock size={14} /> Reabrir dia</button>
        ) : (
          <button className="primary-button" onClick={requestClose} disabled={!result || roster.length === 0}>
            <Lock size={15} /> Fechar dia
          </button>
        )}
      </div>

      <div className="daily-toolbar">
        <label>
          Data do serviço
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <div className="team-total">
          <span>Total de vendas da equipe</span>
          {manualTotal && !closed && staff ? (
            <div className="team-total-manual">
              <MoneyInput
                label="Total de vendas da equipe"
                valueCents={record.teamSalesCents ?? 0}
                onChange={(cents) => patchRecord((r) => ({ ...r, teamSalesCents: cents }))}
              />
              <select
                aria-label="Situação do total"
                value={record.teamSalesStatus ?? "confirmed"}
                onChange={(e) => patchRecord((r) => ({ ...r, teamSalesStatus: e.target.value as SaleStatus }))}
              >
                <option value="confirmed">Confirmado</option>
                <option value="estimated">Estimado</option>
              </select>
              <button className="text-button" onClick={() => patchRecord((r) => ({ ...r, teamSalesCents: undefined, teamSalesStatus: undefined }))}>
                Usar soma automática
              </button>
            </div>
          ) : (
            <div className="team-total-auto">
              <strong>{formatCents(result?.teamSalesCents ?? autoTotalCents)}</strong>
              <small>{manualTotal ? "valor informado manualmente" : "soma automática das vendas dos garçons"}</small>
              {!closed && staff && (
                <button className="text-button" onClick={() => patchRecord((r) => ({ ...r, teamSalesCents: autoTotalCents }))}>
                  Informar manualmente
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="muted">Só quem estiver marcado como "Trabalhou" recebe fixo, bônus e comissão. A comissão coletiva é dividida entre os marcados.</p>

      {live.error && <div className="daily-warnings"><p>{live.error}</p></div>}
      {roster.length === 0 && !closed && (
        <div className="empty-state"><strong>Nenhum integrante ativo</strong><p>Cadastre ou reative integrantes na aba Equipe para lançar o dia.</p></div>
      )}

      {result && roster.length > 0 && (
        <>
          <div className="daily-table-wrap">
            <table className="daily-table">
              <thead>
                <tr>
                  <th>Integrante</th><th>Trabalhou</th><th>Vendas</th><th>Situação</th><th>Caixinha</th>
                  <th>Fixo</th><th>Bônus</th><th>Comissão</th><th>Total</th>
                </tr>
              </thead>
              <tbody>
                {result.members.map((row) => {
                  const entry = record.entries[row.memberId] ?? emptyEntry();
                  const waiter = row.role === "Garçom";
                  return (
                    <tr key={row.memberId}>
                      <td><strong>{row.name}</strong><span className="muted">{row.role}</span></td>
                      <td>
                        <input type="checkbox" checked={entry.present} disabled={closed || !canEditMember(me, row.memberId)}
                          aria-label={`${row.name} trabalhou`}
                          onChange={(e) => patchEntry(row.memberId, { present: e.target.checked })} />
                      </td>
                      <td>
                        {waiter ? (
                          <MoneyInput label={`Vendas de ${row.name}`} valueCents={entry.salesCents} disabled={closed || !canEditMember(me, row.memberId)}
                            onChange={(cents) => patchEntry(row.memberId, { salesCents: cents })} />
                        ) : "—"}
                      </td>
                      <td>
                        {waiter ? (
                          <select value={entry.salesStatus} disabled={closed || !canEditMember(me, row.memberId)}
                            aria-label={`Situação das vendas de ${row.name}`}
                            onChange={(e) => patchEntry(row.memberId, { salesStatus: e.target.value as SaleStatus })}>
                            <option value="confirmed">Confirmado</option>
                            <option value="estimated">Estimado</option>
                          </select>
                        ) : "—"}
                      </td>
                      <td>
                        <MoneyInput label={`Caixinha de ${row.name}`} valueCents={entry.tipsCents} disabled={closed || !canEditMember(me, row.memberId)}
                          onChange={(cents) => patchEntry(row.memberId, { tipsCents: cents })} />
                      </td>
                      <td>{row.present ? formatCents(row.fixedCents) : "—"}</td>
                      <td>
                        {waiter && row.present ? formatCents(row.bonusCents) : "—"}
                        {waiter && entry.bonusAdjustment && <span className="adjust-tag" title={entry.bonusAdjustment.reason}>ajustado</span>}
                        {staff && waiter && !closed && entry.salesCents > 0 && (
                          <button className="icon-button" title="Ajustar base do bônus" aria-label={`Ajustar bônus de ${row.name}`}
                            onClick={() => adjustBonus(row.memberId, row.name, entry.salesCents)}><Pencil size={13} /></button>
                        )}
                      </td>
                      <td>{row.present ? formatCents(row.commissionCents) : "—"}</td>
                      <td><strong>{row.totalCents > 0 ? formatCents(row.totalCents) : "—"}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Totais do dia</td>
                  <td>{formatCents(result.totals.fixedCents)}</td>
                  <td>{formatCents(result.totals.bonusCents)}</td>
                  <td>{formatCents(result.totals.commissionCents)}</td>
                  <td>{formatCents(result.totals.totalCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="stats-grid daily-summary">
            <div className="stat-card"><div className="stat-top"><span>Vendas da equipe</span></div><strong>{formatCents(result.teamSalesCents)}</strong><small>Base da comissão coletiva</small></div>
            <div className="stat-card"><div className="stat-top"><span>Comissão coletiva (10%)</span></div><strong>{formatCents(result.commissionTotalCents)}</strong><small>{result.eligibleCount > 0 ? `Dividida entre ${result.eligibleCount} integrante(s)` : "Marque quem trabalhou para dividir"}</small></div>
            <div className="stat-card"><div className="stat-top"><span>Caixinhas</span></div><strong>{formatCents(result.totals.tipsCents)}</strong><small>Informadas por cada pessoa</small></div>
            <div className="stat-card"><div className="stat-top"><span>Ganhos conquistados</span></div><strong>{formatCents(result.totals.totalCents)}</strong><small>Ainda não é dinheiro recebido</small></div>
          </div>

          {result.warnings.length > 0 && (
            <div className="daily-warnings">{[...new Set(result.warnings)].map((w) => <p key={w}>{w}</p>)}</div>
          )}
        </>
      )}

      <ConfirmDialog
        open={dialog === "close" && Boolean(result)}
        title={`Fechar o dia ${prettyDate}?`}
        confirmLabel="Confirmar fechamento"
        onConfirm={confirmClose}
        onCancel={() => setDialog(null)}
      >
        {result && (
          <>
            <p>Revise os números antes de fechar.</p>
            <div className="dialog-stats">
              <div className="dialog-stat"><span>Presentes</span><strong>{presentCount} de {roster.length}</strong></div>
              <div className="dialog-stat"><span>Vendas da equipe</span><strong>{formatCents(result.teamSalesCents)}</strong></div>
              <div className="dialog-stat"><span>Ganhos do dia</span><strong>{formatCents(result.totals.totalCents)}</strong></div>
            </div>
            {(result.hasEstimates || result.warnings.length > 0) && (
              <div className="dialog-alert">
                <strong>Atenção</strong>
                <ul>
                  {result.hasEstimates && <li>Há valores estimados neste dia.</li>}
                  {[...new Set(result.warnings)].map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            )}
            <p>Depois de fechado, o dia fica travado: ninguém altera vendas, caixinhas ou presença. Só dono e gerentes podem reabrir.</p>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "reopen"}
        title={`Reabrir o dia ${prettyDate}?`}
        confirmLabel="Reabrir dia"
        onConfirm={confirmReopen}
        onCancel={() => setDialog(null)}
      >
        <p>O fechamento atual será descartado e o dia voltará a ser calculado com a equipe ativa de hoje. A reabertura fica registrada.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "blocked"}
        title="Não é possível reabrir"
        confirmLabel="Entendi"
        hideCancel
        onConfirm={() => setDialog(null)}
        onCancel={() => setDialog(null)}
      >
        <p>Este dia já tem pagamentos registrados. Estorne os pagamentos na aba Pagamentos antes de reabrir.</p>
      </ConfirmDialog>
    </section>
  );
}