import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import "./operation-audit.css";
type AuditRow = { id:string; at:string; actor:string|null; entity:string; action:string; details:Record<string,unknown>; member_id:string|null };
export default function OperationAudit() {
 const [rows,setRows]=useState<AuditRow[]>([]);
 const [error,setError]=useState("");
 const [filter,setFilter]=useState("all");
 const load=useCallback(async()=>{
   if(!supabase)return;
   const {data,error:e}=await supabase.from("operation_events").select("id,at,actor,member_id,entity,action,details").order("at",{ascending:false}).limit(200);
   if(e)setError(`${e.message} (${e.code})`);else {setRows((data??[]) as AuditRow[]);setError("");}
 },[]);
 useEffect(()=>{void load()},[load]);
 const visible=rows.filter(r=>filter==="all"||r.entity===filter);
 const changes=rows.filter(r=>r.entity==="shift_assignments").length;
 const finance=rows.filter(r=>["payments","payment_plans","payment_feedback"].includes(r.entity)).length;
 const recent=rows.filter(r=>Date.now()-new Date(r.at).getTime()<7*24*60*60*1000).length;
 return <section className="content-card mf22-audit mf-admin-audit"><div className="section-heading"><div><span className="eyebrow">RASTREABILIDADE</span><h3>Histórico de alterações</h3><p className="muted">Eventos novos registrados após a migração 005. Não altera registros financeiros.</p></div><button type="button" className="subtle-button" onClick={()=>void load()}>Atualizar</button></div>
  <div className="mf-audit-overview" aria-label="Resumo de auditoria">
   <div><small>Eventos carregados</small><strong>{rows.length}</strong><span>Últimos 200 registros</span></div>
   <div><small>Escalas</small><strong>{changes}</strong><span>Alterações rastreadas</span></div>
   <div><small>Financeiro</small><strong>{finance}</strong><span>Pagamentos e revisões</span></div>
   <div><small>Últimos 7 dias</small><strong>{recent}</strong><span>Eventos recentes</span></div>
  </div>
  {error&&<p role="alert" className="sync-error">{error}</p>}
  <label>Filtrar por tipo <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todos</option><option value="payments">Pagamentos</option><option value="payment_plans">Previsões</option><option value="payment_feedback">Contestações e confirmações</option><option value="shift_assignments">Escalas</option></select></label>
  <div className="mf22-audit-list">{visible.length===0?<div className="mf-audit-empty"><strong>Nenhum evento encontrado</strong><p className="muted">As alterações registradas aparecerão aqui. Experimente outro filtro ou atualize a página.</p></div>:visible.map(r=><article key={r.id}><strong>{r.entity} · {r.action}</strong><small>{new Date(r.at).toLocaleString("pt-BR")}</small><small>Responsável: {r.actor??"Sistema"} · Integrante: {r.member_id??"—"}</small><code>{JSON.stringify(r.details)}</code></article>)}</div>
 </section>;
}
