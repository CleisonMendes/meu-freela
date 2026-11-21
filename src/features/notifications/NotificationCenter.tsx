import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BellRing, Check, CheckCheck, Clock3, Inbox, RefreshCw, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useMe } from "../../auth/access";
import "./notification-center.css";

type Notification = {
  id: string;
  title: string;
  body: string;
  category: string;
  created_at: string;
  read_at: string | null;
};
type Filter = "all" | "unread" | "read";

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data indisponível" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function categoryLabel(category: string): string {
  const categoryNames: Record<string, string> = {
    schedule: "Escalas", shift: "Escalas", payment: "Pagamentos",
    payments: "Pagamentos", dispute: "Revisões", financial: "Financeiro",
  };
  return categoryNames[category.toLowerCase()] ?? "Atualização";
}

export default function NotificationCenter() {
  const me = useMe();
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const isMember = me.access === "member";

  const load = useCallback(async () => {
    if (!supabase) {
      setError("A conexão com o Supabase não está configurada.");
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: err } = await supabase.from("app_notifications")
      .select("id,title,body,category,created_at,read_at")
      .order("created_at", { ascending: false }).limit(60);
    if (err) setError(`${err.message} (${err.code})`);
    else {
      setItems((data ?? []) as Notification[]);
      setError("");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const unread = items.filter(item => !item.read_at).length;
  const read = items.length - unread;
  const visible = useMemo(() => items.filter(item =>
    filter === "all" || (filter === "unread" ? !item.read_at : Boolean(item.read_at))
  ), [items, filter]);

  async function markRead(ids: string[]) {
    if (!supabase || !ids.length || busy) return;
    setBusy(true);
    const { error: err } = await supabase.from("app_notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids);
    if (err) setError(`${err.message} (${err.code})`);
    else await load();
    setBusy(false);
  }

  return (
    <section className="mf-notify-page" aria-label="Central de avisos">
      <header className="mf-notify-hero">
        <div className="mf-notify-hero-main">
          <span className="mf-notify-kicker"><BellRing size={14} aria-hidden="true" /> CENTRAL DE NOTIFICAÇÕES</span>
          <h3>{isMember ? "Seus avisos, tudo em dia." : "Tudo sob controle."}</h3>
          <p>{isMember
            ? "Acompanhe informações sobre suas escalas, pagamentos e solicitações em um único lugar."
            : "Acompanhe as novidades da operação, confirmações e atualizações da equipe."}</p>
          <div className="mf-notify-hero-label"><ShieldCheck size={15} aria-hidden="true" /> Avisos exclusivos do seu acesso</div>
        </div>
        <div className="mf-notify-hero-total" aria-label={`${unread} avisos não lidos`}>
          <span>AINDA NÃO LIDOS</span>
          <strong>{unread}</strong>
          <small>{unread === 1 ? "aviso para conferir" : "avisos para conferir"}</small>
        </div>
      </header>

      <div className="mf-notify-summary" aria-label="Resumo dos avisos">
        <div className="mf-notify-stat"><span className="mf-notify-stat-icon blue"><Inbox size={19}/></span><div><small>Total carregado</small><strong>{items.length}</strong><span>Últimos 60 avisos</span></div></div>
        <div className="mf-notify-stat"><span className="mf-notify-stat-icon gold"><Bell size={19}/></span><div><small>Não lidos</small><strong>{unread}</strong><span>Pendentes de leitura</span></div></div>
        <div className="mf-notify-stat"><span className="mf-notify-stat-icon green"><CheckCheck size={19}/></span><div><small>Lidos</small><strong>{read}</strong><span>Já conferidos</span></div></div>
      </div>

      <div className="mf-notify-content">
        <div className="mf-notify-toolbar">
          <div><span className="mf-notify-overline">ATUALIZAÇÕES</span><h4>Caixa de entrada</h4><p>Informações mais recentes do seu perfil</p></div>
          <div className="mf-notify-actions">
            {unread > 0 && <button type="button" className="mf-notify-button mf-notify-button-secondary" disabled={busy || loading} onClick={() => void markRead(items.filter(item => !item.read_at).map(item => item.id))}><CheckCheck size={16}/> Marcar todos como lidos</button>}
            <button type="button" className="mf-notify-button mf-notify-button-ghost" onClick={() => void load()} disabled={loading || busy}><RefreshCw size={16} className={loading ? "mf-notify-spinning" : ""}/> Atualizar</button>
          </div>
        </div>

        <div className="mf-notify-filters" role="group" aria-label="Filtrar avisos">
          {([ ["all", "Todos"], ["unread", "Não lidos"], ["read", "Lidos"] ] as const).map(([value,label]) =>
            <button key={value} type="button" className={filter === value ? "mf-notify-filter active" : "mf-notify-filter"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label} <span>{value === "all" ? items.length : value === "unread" ? unread : read}</span></button>
          )}
        </div>

        {error && <p role="alert" className="mf-notify-error">{error}</p>}
        {loading && items.length === 0 ? <p className="mf-notify-loading" role="status">Carregando avisos...</p> : null}
        {!loading && visible.length === 0 && <div className="mf-notify-empty"><div className="mf-notify-empty-icon"><Bell size={27}/></div><h5>{filter === "unread" ? "Tudo em dia!" : filter === "read" ? "Nenhum aviso lido" : "Nenhum aviso por enquanto"}</h5><p>{filter === "unread" ? "Você não possui avisos pendentes de leitura." : filter === "read" ? "Os avisos que você marcar como lidos aparecerão aqui." : "Quando houver novidades sobre escalas, pagamentos ou sua operação, elas aparecerão aqui."}</p></div>}
        <div className="mf-notify-list">
          {visible.map(item => <article key={item.id} className={`mf-notify-item ${item.read_at ? "is-read" : "is-unread"}`}>
            <span className="mf-notify-item-icon" aria-hidden="true">{item.read_at ? <Check size={18}/> : <BellRing size={18}/>}</span>
            <div className="mf-notify-item-main"><div className="mf-notify-item-heading"><strong>{item.title}</strong><span className="mf-notify-category">{categoryLabel(item.category)}</span>{!item.read_at && <span className="mf-notify-new">Novo</span>}</div><p>{item.body}</p><small><Clock3 size={13} aria-hidden="true"/> {formatWhen(item.created_at)}</small></div>
            {!item.read_at && <button type="button" className="mf-notify-button mf-notify-button-primary" disabled={busy} onClick={() => void markRead([item.id])}><Check size={15}/> Marcar como lido</button>}
          </article>)}
        </div>
      </div>
    </section>
  );
}
