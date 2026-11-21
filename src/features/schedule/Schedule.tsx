import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { TeamMember, Role } from "../../types";
import type { Me } from "../../auth/access";
import { isStaff } from "../../auth/access";
import { supabase } from "../../lib/supabase";
import "./schedule.css";

type Template = { id: string; name: string; start_time: string; end_time: string; active: boolean };
type Availability = { id: string; member_id: string; work_date: string; start_time: string; end_time: string; note: string | null };
type Assignment = {
  id: string; member_id: string; work_date: string; start_time: string; end_time: string;
  status: "confirmed" | "cancelled"; reply_status: "pending" | "accepted" | "declined";
  reply_note: string | null; notes: string | null;
};
type Requirement = { id: string; work_date: string; role: Role; required_count: number };
const ROLES: Role[] = ["Garçom", "Caixa", "Bar", "Cozinha"];
const hhmm = (value: string) => value.slice(0, 5);
const fmt = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const parse = (day: string) => new Date(`${day}T12:00:00`);
const addDays = (day: string, count: number) => { const d = parse(day); d.setDate(d.getDate() + count); return fmt(d); };
const startOfWeek = (day: string) => addDays(day, -((parse(day).getDay() + 6) % 7));
const labelDay = (day: string) => parse(day).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const periodBounds = (day: string) => {
  const date = parse(day);
  const from = fmt(new Date(date.getFullYear(), date.getMonth(), 1));
  const to = fmt(new Date(date.getFullYear(), date.getMonth() + 1, 1));
  return { from: addDays(from, -7), to: addDays(to, 7) };
};
const asMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const covers = (available: Availability, start: string, end: string) => {
  const a = asMinutes(available.start_time), b = asMinutes(available.end_time);
  const s = asMinutes(start), e = asMinutes(end);
  return a <= s && (b <= a ? b + 1440 : b) >= (e <= s ? e + 1440 : e);
};

export default function Schedule({ me, members }: { me: Me; members: TeamMember[] }) {
  const staff = isStaff(me);
  const [day, setDay] = useState(() => fmt(new Date()));
  const [view, setView] = useState<"week" | "month">("week");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [availabilities, setAvailabilities] = useState<Availability[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [selectedMember, setSelectedMember] = useState("");
  const [chosenTemplate, setChosenTemplate] = useState("");
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("23:00");
  const [templateName, setTemplateName] = useState("");
  const [pickedDays, setPickedDays] = useState<string[]>([]);
  const [role, setRole] = useState<Role>("Garçom");
  const [needed, setNeeded] = useState(1);
  const [copyTarget, setCopyTarget] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [selectedShifts, setSelectedShifts] = useState<string[]>([]);
  const [bulkReason, setBulkReason] = useState("");
  const [replyNote, setReplyNote] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { from, to } = periodBounds(day);
    const [t, a, s, r] = await Promise.all([
      supabase.from("shift_templates").select("id,name,start_time,end_time,active").order("name"),
      supabase.from("member_availability").select("id,member_id,work_date,start_time,end_time,note").gte("work_date", from).lt("work_date", to),
      supabase.from("shift_assignments").select("id,member_id,work_date,start_time,end_time,status,reply_status,reply_note,notes").gte("work_date", from).lt("work_date", to).order("start_time"),
      supabase.from("shift_requirements").select("id,work_date,role,required_count").gte("work_date", from).lt("work_date", to),
    ]);
    setLoading(false);
    const error = t.error || a.error || s.error || r.error;
    if (error) { setMessage(`Erro ao carregar escalas: ${error.message}`); return; }
    setTemplates((t.data ?? []) as Template[]);
    setAvailabilities((a.data ?? []) as Availability[]);
    setAssignments((s.data ?? []) as Assignment[]);
    setRequirements((r.data ?? []) as Requirement[]);
    setMessage("");
  }, [day]);
  useEffect(() => { void refresh(); }, [refresh]);
  const validTime = start !== end && /^([01]\d|2[0-3]):[0-5]\d$/.test(start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(end);
  const nameFor = (id: string) => members.find(m => m.id === id)?.name ?? "Integrante";
  const days = useMemo(() => {
    if (view === "week") return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(day), i));
    const first = `${day.slice(0, 7)}-01`;
    return Array.from({ length: 42 }, (_, i) => addDays(startOfWeek(first), i));
  }, [day, view]);
  const dayAssignments = assignments.filter(a => a.work_date === day && a.status === "confirmed");
  const dayAvailabilities = availabilities.filter(a => a.work_date === day);
  const dayRequirements = requirements.filter(r => r.work_date === day);
  const calendarTotal = (date: string) => assignments.filter(a => a.work_date === date && a.status === "confirmed" && a.reply_status !== "declined").length;
  const vacancies = (date: string) => requirements.filter(r => r.work_date === date).reduce((total, r) => {
    const count = assignments.filter(a => a.work_date === date && a.status === "confirmed" && a.reply_status !== "declined" && members.find(m => m.id === a.member_id)?.role === r.role).length;
    return total + Math.max(0, r.required_count - count);
  }, 0);

  async function save(action: () => Promise<{ error: { message: string } | null }>, success = "Alteração salva com sucesso.") {
    setBusy(true); setMessage("");
    try {
      const result = await action();
      if (result.error) throw new Error(result.error.message);
      await refresh(); setMessage(success);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  async function saveTemplate(event: FormEvent) {
    event.preventDefault(); if (!supabase || !staff || !validTime || !templateName.trim()) return;
    await save(async () => supabase!.from("shift_templates").insert({ name: templateName.trim(), start_time: start, end_time: end }));
    setTemplateName("");
  }
  async function addAvailability(event: FormEvent) {
    event.preventDefault(); if (!supabase || !validTime) return;
    const memberId = staff ? selectedMember : me.memberId;
    if (!memberId) { setMessage("Selecione um integrante ou vincule o login a um cadastro da equipe."); return; }
    const targetDays = pickedDays.length ? pickedDays : [day];
    const rows = targetDays.map(work_date => ({ member_id: memberId, work_date, start_time: start, end_time: end }));
    await save(async () => supabase!.from("member_availability").upsert(rows, { onConflict: "member_id,work_date,start_time,end_time", ignoreDuplicates: true }), `${targetDays.length} dia(s) de disponibilidade registrados.`);
    setPickedDays([]);
  }
  async function confirmShift(event: FormEvent) {
    event.preventDefault(); if (!supabase || !staff || !selectedMember || !validTime) return;
    const available = dayAvailabilities.some(a => a.member_id === selectedMember && covers(a, start, end));
    if (!available && !window.confirm("A pessoa não informou disponibilidade para todo esse horário. Confirmar mesmo assim?")) return;
    await save(async () => supabase!.from("shift_assignments").insert({ member_id: selectedMember, work_date: day, start_time: start, end_time: end, template_id: chosenTemplate || null }));
  }
  async function setRequirement(event: FormEvent) {
    event.preventDefault(); if (!supabase || !staff) return;
    await save(async () => supabase!.from("shift_requirements").upsert({ work_date: day, role, required_count: needed }, { onConflict: "work_date,role" }));
  }
  async function reply(id: string, response: "accepted" | "declined") {
    if (!supabase || staff) return;
    const reason = (replyNote[id] ?? "").trim();
    if (response === "declined" && !reason) { setMessage("Informe o motivo pelo qual não poderá comparecer."); return; }
    await save(async () => supabase!.from("shift_assignments").update({ reply_status: response, reply_note: response === "declined" ? reason : null }).eq("id", id).eq("member_id", me.memberId!));
  }
  async function copyWeek() {
    if (!supabase || !staff || !copyTarget) return;
    const from = startOfWeek(day);
    const to = startOfWeek(copyTarget);
    if (from === to) { setMessage("Escolha outra semana."); return; }
    if (!window.confirm(`Copiar a escala da semana de ${labelDay(from)} para ${labelDay(to)}? Conflitos serão bloqueados pelo banco.`)) return;
    setBusy(true); setMessage("");
    try {
      const { data, error } = await supabase.rpc("copy_schedule_week", { p_source_monday: from, p_destination_monday: to });
      if (error) throw error;
      await refresh(); setMessage(`${data ?? 0} turno(s) copiado(s).`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Falha na cópia."); }
    finally { setBusy(false); }
  }
  async function bulkChangeHours() {
    if (!supabase || !staff || selectedShifts.length===0 || !validTime || bulkReason.trim().length<5) {
      setMessage("Selecione escalas, horários válidos e uma justificativa (mínimo 5 caracteres)."); return;
    }
    if (!window.confirm(`Alterar ${selectedShifts.length} escala(s) para ${start}–${end}? As respostas serão reiniciadas.`)) return;
    setBusy(true);setMessage("");
    try {
      const {data,error}=await supabase.rpc("reschedule_shifts",{p_ids:selectedShifts,p_start:start,p_end:end,p_reason:bulkReason.trim()});
      if(error)throw error;
      setSelectedShifts([]);setBulkReason("");await refresh();setMessage(`${data??0} escala(s) alterada(s).`);
    } catch(e){setMessage(e instanceof Error?e.message:"Falha ao alterar turnos.");}
    finally{setBusy(false);}
  }
  async function cancelDay() {
    if (!supabase || !staff || cancelReason.trim().length < 5) { setMessage("Informe o motivo (mínimo 5 caracteres)."); return; }
    if (!window.confirm(`Cancelar TODAS as escalas confirmadas de ${labelDay(day)}?`)) return;
    setBusy(true); setMessage("");
    try {
      const { data, error } = await supabase.rpc("cancel_schedule_day", { p_day: day, p_reason: cancelReason.trim() });
      if (error) throw error;
      setCancelReason(""); await refresh(); setMessage(`${data ?? 0} escala(s) cancelada(s).`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Falha ao cancelar."); }
    finally { setBusy(false); }
  }
  const pendingReplies = assignments.filter(a => a.status === "confirmed" && a.reply_status === "pending" && a.work_date >= fmt(new Date())).length;
  const move = (direction: number) => {
    if (view === "week") setDay(addDays(day, direction * 7));
    else { const d = parse(day); setDay(fmt(new Date(d.getFullYear(), d.getMonth() + direction, 1))); }
  };

  if (!supabase) return <section className="content-card"><h3>Escalas</h3><p>É necessário conectar ao Supabase para utilizar as escalas.</p></section>;
  return <section className="content-card schedule mf-admin-schedule">
    <div className="section-heading"><div><span className="eyebrow">MEU FREELA 2.1</span><h3>Escala de trabalho</h3><p className="muted">Calendário, disponibilidade e confirmação individual.</p></div>
      <button className="subtle-button" type="button" onClick={() => void refresh()}>Atualizar</button></div>
    {message && <p className="schedule-message" role="status">{message}</p>}
    <div className="schedule-toolbar">
      <div className="schedule-switch"><button className={view === "week" ? "active" : ""} onClick={() => setView("week")}>Semanal</button><button className={view === "month" ? "active" : ""} onClick={() => setView("month")}>Mensal</button></div>
      <div className="schedule-nav"><button type="button" onClick={() => move(-1)} aria-label="Período anterior">‹</button><strong>{parse(day).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</strong><button type="button" onClick={() => move(1)} aria-label="Próximo período">›</button></div>
      <label className="schedule-date">Dia selecionado <input type="date" value={day} onChange={e => setDay(e.target.value)} /></label>
    </div>
    <div className="schedule-calendar" role="group" aria-label="Calendário de escalas">
      {days.map(d => <button type="button" key={d} onClick={() => setDay(d)} className={`schedule-day ${day === d ? "selected" : ""} ${d.slice(0, 7) !== day.slice(0, 7) ? "outside" : ""}`}>
        <span>{parse(d).toLocaleDateString("pt-BR", { weekday: "short" })} {labelDay(d)}</span>
        <small>{calendarTotal(d)} escalado(s)</small>
        {staff && vacancies(d) > 0 && <small className="schedule-shortage">{vacancies(d)} vaga(s) em aberto</small>}
      </button>)}
    </div>
    {staff && <div className="schedule-panel mf22-schedule-tools">
      <h4>Gestão rápida de escalas</h4>
      <p className="muted">{pendingReplies} escala(s) aguardando resposta nos próximos dias.</p>
      <div className="mf22-tool-grid">
        <div><strong>Copiar semana selecionada</strong><label>Semana de destino<input type="date" value={copyTarget} onChange={e=>setCopyTarget(e.target.value)}/></label><button type="button" className="subtle-button" disabled={busy || !copyTarget} onClick={()=>void copyWeek()}>Copiar semana</button></div>
        <div><strong>Cancelar escalas do dia</strong><label>Motivo<input value={cancelReason} maxLength={300} onChange={e=>setCancelReason(e.target.value)} placeholder="Motivo da alteração"/></label><button type="button" className="subtle-button" disabled={busy || cancelReason.trim().length<5 || dayAssignments.length===0} onClick={()=>void cancelDay()}>Cancelar {dayAssignments.length} escala(s)</button></div>
      </div>
      <div className="mf22-bulk-edit"><strong>Editar horários dos turnos selecionados</strong><p className="muted">Selecione turnos abaixo e utilize os horários Entrada e Saída do formulário de disponibilidade.</p><label>Justificativa<input maxLength={300} value={bulkReason} onChange={e=>setBulkReason(e.target.value)} placeholder="Ex.: Alteração no funcionamento"/></label><button type="button" className="subtle-button" disabled={busy||selectedShifts.length===0||!validTime||bulkReason.trim().length<5} onClick={()=>void bulkChangeHours()}>Atualizar {selectedShifts.length} turno(s)</button></div>
      <p className="muted">A cópia é atômica e não cria turnos duplicados idênticos; outros conflitos impedem a operação inteira. Cancelamentos ficam no histórico.</p>
    </div>}
    {loading && <p className="muted">Carregando dados…</p>}
    {staff && <div className="schedule-panel"><h4>Necessidade por função — {labelDay(day)}</h4>
      <div className="schedule-roles">{ROLES.map(r => {
        const target = dayRequirements.find(x => x.role === r)?.required_count ?? 0;
        const filled = dayAssignments.filter(a => a.reply_status !== "declined" && members.find(m => m.id === a.member_id)?.role === r).length;
        return <div className="schedule-role" key={r}><strong>{r}</strong><span>{filled} / {target} escalados</span><small>{Math.max(0, target - filled)} vaga(s) faltando</small></div>;
      })}</div>
      <form className="schedule-requirement-form" onSubmit={setRequirement}><label>Função<select value={role} onChange={e => setRole(e.target.value as Role)}>{ROLES.map(r => <option key={r}>{r}</option>)}</select></label><label>Quantidade necessária<input type="number" min={0} max={100} required value={needed} onChange={e => setNeeded(Number(e.target.value))}/></label><button className="primary-button" disabled={busy || needed < 0 || needed > 100}>Salvar quantidade</button></form>
    </div>}
    <div className="schedule-columns">
      <div className="schedule-panel"><h4>Escala oficial — {labelDay(day)}</h4>{dayAssignments.length === 0 && <p className="muted">Nenhum turno confirmado neste dia.</p>}
        {dayAssignments.map(a => <div className="schedule-entry" key={a.id}>{staff && <input type="checkbox" aria-label={`Selecionar escala de ${nameFor(a.member_id)}`} checked={selectedShifts.includes(a.id)} onChange={e=>setSelectedShifts(old=>e.target.checked?[...old,a.id]:old.filter(x=>x!==a.id))}/>}<span><strong>{nameFor(a.member_id)}</strong><small>{hhmm(a.start_time)} às {hhmm(a.end_time)}{a.end_time <= a.start_time ? " (dia seguinte)" : ""}</small><small>{a.reply_status === "accepted" ? "Presença confirmada" : a.reply_status === "declined" ? "Não poderá comparecer" : "Aguardando resposta"}</small>{a.reply_note && <small>Motivo: {a.reply_note}</small>}</span>
          {staff ? <button type="button" className="subtle-button" disabled={busy} onClick={() => { if (window.confirm("Cancelar esta escala?")) void save(async () => supabase!.from("shift_assignments").update({ status: "cancelled" }).eq("id", a.id)); }}>Cancelar</button> : a.member_id === me.memberId ? <div className="schedule-reply"><input aria-label="Motivo para não comparecer" placeholder="Motivo (se não puder comparecer)" maxLength={300} value={replyNote[a.id] ?? a.reply_note ?? ""} onChange={e => setReplyNote(old => ({ ...old, [a.id]: e.target.value }))}/><button disabled={busy} type="button" onClick={() => void reply(a.id, "accepted")}>Confirmar presença</button><button disabled={busy} type="button" onClick={() => void reply(a.id, "declined")}>Não posso comparecer</button></div> : null}</div>)}
      </div>
      <div className="schedule-panel"><h4>Disponibilidade informada — {labelDay(day)}</h4>{dayAvailabilities.length === 0 && <p className="muted">Sem disponibilidade informada.</p>}
        {dayAvailabilities.map(a => <div className="schedule-entry" key={a.id}><span><strong>{nameFor(a.member_id)}</strong><small>{hhmm(a.start_time)} às {hhmm(a.end_time)}{a.end_time <= a.start_time ? " (dia seguinte)" : ""}</small></span>{(staff || a.member_id === me.memberId) && <button type="button" className="subtle-button" disabled={busy} onClick={() => void save(async () => supabase!.from("member_availability").delete().eq("id", a.id))}>Remover</button>}</div>)}
      </div>
    </div>
    <div className="schedule-columns">
      <form className="schedule-panel schedule-form" onSubmit={addAvailability}><h4>Disponibilidade para vários dias</h4>
        {staff ? <label>Integrante<select value={selectedMember} onChange={e => setSelectedMember(e.target.value)} required><option value="">Selecione</option>{members.filter(m => m.active).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label> : <p className="muted">Você informa apenas sua própria disponibilidade.</p>}
        <p className="muted">Marque os dias desejados (ou deixe sem marcar para usar somente o dia selecionado).</p>
        <div className="schedule-multi-days">{Array.from({ length: 14 }, (_, i) => addDays(day, i)).map(d => <label key={d}><input type="checkbox" checked={pickedDays.includes(d)} onChange={e => setPickedDays(old => e.target.checked ? [...old, d] : old.filter(x => x !== d))}/>{labelDay(d)}</label>)}</div>
        <div className="schedule-time"><label>Entrada<input type="time" required value={start} onChange={e => setStart(e.target.value)}/></label><label>Saída<input type="time" required value={end} onChange={e => setEnd(e.target.value)}/></label></div>
        <button className="primary-button" disabled={busy || !validTime || (staff ? !selectedMember : !me.memberId)}>Salvar disponibilidade</button>
      </form>
      {staff && <form className="schedule-panel schedule-form" onSubmit={confirmShift}><h4>Confirmar escala</h4>
        <label>Integrante<select value={selectedMember} onChange={e => setSelectedMember(e.target.value)} required><option value="">Selecione</option>{members.filter(m => m.active).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label>Modelo de turno<select value={chosenTemplate} onChange={e => { const id = e.target.value; setChosenTemplate(id); const t = templates.find(x => x.id === id); if (t) { setStart(hhmm(t.start_time)); setEnd(hhmm(t.end_time)); } }}><option value="">Horário personalizado</option>{templates.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.name} ({hhmm(t.start_time)}–{hhmm(t.end_time)})</option>)}</select></label>
        <p className="muted">Turno atual: {start} às {end}. Ajuste os horários na seção ao lado.</p>
        <button className="primary-button" disabled={busy || !selectedMember || !validTime}>Confirmar escala</button>
      </form>}
    </div>
    {staff && <form className="schedule-panel schedule-form" onSubmit={saveTemplate}><h4>Criar modelo reutilizável</h4><label>Nome<input required maxLength={80} value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Ex.: Turno noturno"/></label><div className="schedule-time"><label>Início<input type="time" required value={start} onChange={e => setStart(e.target.value)}/></label><label>Fim<input type="time" required value={end} onChange={e => setEnd(e.target.value)}/></label></div><button className="primary-button" disabled={busy || !validTime || !templateName.trim()}>Salvar modelo</button></form>}
  </section>;
}
