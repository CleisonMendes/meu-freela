import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, CalendarDays,
  ClipboardList, HardHat, LayoutDashboard, Plus, ShieldCheck, Users, Wallet,
  Pencil, Trash2, Search, History, X, UserRoundX, RotateCcw, LogOut, KeyRound,
} from "lucide-react";
import type { AppData, Role, TeamMember, TeamHistoryEvent } from "./types";
import { ROLES } from "./types";
import { exportBackup, loadAppData, saveAppData } from "./services/storage";
import DailyEntry from "./features/daily/DailyEntry";
import Dashboard from "./features/dashboard/Dashboard";
import Payments from "./features/payments/Payments";
import Reports from "./features/reports/Reports";
import { memberHasMovements } from "./lib/reports";
import { ACCESS_LABEL, AccessContext, isStaff, type Me } from "./auth/access";
import AuthGate from "./auth/AuthGate";
import { cloudEnabled } from "./lib/supabase";
import { describeError, loadCloudData, saveCloudChanges } from "./services/cloud";
import "./auth/auth.css";
import AccessManager from "./features/access/AccessManager";
import MustChangeGate from "./auth/MustChangeGate";

type Section = "dashboard" | "team" | "daily" | "payments" | "reports" | "access";
type TeamFilter = "active" | "inactive" | "all";

const navigation: { id: Section; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { id: "team", label: "Equipe", icon: Users },
  { id: "daily", label: "Lançamento diário", icon: CalendarDays },
  { id: "payments", label: "Pagamentos", icon: Wallet },
  { id: "reports", label: "Relatórios", icon: ClipboardList },
  { id: "access", label: "Acessos", icon: KeyRound },
];

const nowIso = () => new Date().toISOString();

function historyEvent(
  member: Pick<TeamMember, "id" | "name">,
  action: TeamHistoryEvent["action"],
  details: string,
): TeamHistoryEvent {
  return {
    id: crypto.randomUUID(),
    memberId: member.id,
    memberName: member.name,
    action,
    details,
    createdAt: nowIso(),
  };
}

const LOCAL_ME: Me = { access: "owner", memberId: null, email: "" };
const EMPTY_DATA: AppData = { version: 1, members: [] };
type SyncState = "saved" | "saving" | "error";

export default function App() {
  if (!cloudEnabled) return <Workspace me={LOCAL_ME} cloud={false} signOut={() => undefined} />;
  return <AuthGate>{(me, signOut) => <MustChangeGate signOut={signOut}><Workspace me={me} cloud signOut={signOut} /></MustChangeGate>}</AuthGate>;
}

function Workspace({ me, cloud, signOut }: { me: Me; cloud: boolean; signOut: () => void }) {
  const staff = isStaff(me);
  const [data, setData] = useState<AppData>(() => (cloud ? EMPTY_DATA : loadAppData()));
  const [ready, setReady] = useState(!cloud);
  const [loadError, setLoadError] = useState("");
  const [sync, setSync] = useState<SyncState>("saved");
  const [syncError, setSyncError] = useState("");
  const latest = useRef(data);
  const synced = useRef(data);
  const queue = useRef<Promise<void>>(Promise.resolve());
  latest.current = data;
  const [section, setSection] = useState<Section>("dashboard");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("Garçom");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TeamFilter>("active");
  const [search, setSearch] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  async function reload(silent = false) {
    const fresh = await loadCloudData();
    if (silent && JSON.stringify(fresh) === JSON.stringify(synced.current)) return;
    synced.current = fresh;
    latest.current = fresh;
    setData(fresh);
    setSync("saved");
  }

  // Carga inicial da nuvem
  useEffect(() => {
    if (!cloud) return;
    reload().then(() => setReady(true)).catch((error) => setLoadError(describeError(error)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud]);

  // Salvamento: local (navegador) ou nuvem (só as diferenças, em fila)
  useEffect(() => {
    if (!cloud) {
      saveAppData(data);
      return;
    }
    if (!ready || data === synced.current) return;
    setSync("saving");
    const timer = window.setTimeout(() => {
      queue.current = queue.current.then(async () => {
        const target = latest.current;
        if (target === synced.current) return;
        try {
          await saveCloudChanges(synced.current, target);
          synced.current = target;
          setSync(latest.current === target ? "saved" : "saving");
        } catch (error) {
          setSyncError(describeError(error));
          try { await reload(); } catch { setSync("error"); }
        }
      });
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ready, cloud]);

  // Atualiza sozinho (quando não há alterações pendentes) para ver o que os outros lançaram
  useEffect(() => {
    if (!cloud || !ready) return;
    const refresh = () => {
      if (document.visibilityState === "visible" && latest.current === synced.current) {
        reload(true).catch(() => undefined);
      }
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, ready]);

  const activeMembers = useMemo(
    () => data.members.filter((member) => member.active),
    [data.members],
  );

  const visibleMembers = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
    return data.members
      .filter((member) => {
        if (filter === "active") return member.active;
        if (filter === "inactive") return !member.active;
        return true;
      })
      .filter((member) => member.name.toLocaleLowerCase("pt-BR").includes(normalizedSearch))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [data.members, filter, search]);

  function resetForm() {
    setName("");
    setRole("Garçom");
    setEditingId(null);
    setShowForm(false);
  }

  function openNewForm() {
    setName("");
    setRole("Garçom");
    setEditingId(null);
    setShowForm(true);
  }

  function openEditForm(member: TeamMember) {
    setName(member.name);
    setRole(member.role);
    setEditingId(member.id);
    setShowForm(true);
    setShowHistory(false);
  }

  function submitMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;

    if (editingId) {
      setData((current) => {
        const previous = current.members.find((member) => member.id === editingId);
        if (!previous) return current;
        const updated: TeamMember = {
          ...previous,
          name: cleanName,
          role,
          updatedAt: nowIso(),
        };
        const events: TeamHistoryEvent[] = [];
        if (previous.name !== cleanName) {
          events.push(historyEvent(previous, "updated", `Nome alterado de "${previous.name}" para "${cleanName}".`));
        }
        if (previous.role !== role) {
          events.push(historyEvent({ ...previous, name: cleanName }, "role_changed", `Função alterada de ${previous.role} para ${role}.`));
        }
        return {
          ...current,
          members: current.members.map((member) => member.id === editingId ? updated : member),
          teamHistory: [...(current.teamHistory ?? []), ...events],
        };
      });
    } else {
      const member: TeamMember = {
        id: crypto.randomUUID(),
        name: cleanName,
        role,
        active: true,
        createdAt: nowIso(),
      };
      setData((current) => ({
        ...current,
        members: [...current.members, member],
        teamHistory: [...(current.teamHistory ?? []), historyEvent(member, "created", `Cadastro criado como ${role}.`)],
      }));
    }
    resetForm();
  }

  function toggleMember(member: TeamMember) {
    const nextActive = !member.active;
    const action = nextActive ? "reactivated" : "deactivated";
    const details = nextActive ? "Integrante reativado." : "Integrante desativado.";
    const verb = nextActive ? "Reativar" : "Desativar";
    if (!window.confirm(`${verb} ${member.name}? ${nextActive ? "Ele voltará a aparecer na equipe ativa." : "Ele deixará de aparecer na equipe ativa, mas continuará no histórico."}`)) return;

    setData((current) => ({
      ...current,
      members: current.members.map((item) =>
        item.id === member.id
          ? { ...item, active: nextActive, updatedAt: nowIso(), deactivatedAt: nextActive ? undefined : nowIso() }
          : item,
      ),
      teamHistory: [...(current.teamHistory ?? []), historyEvent(member, action, details)],
    }));
  }

  function deleteMember(member: TeamMember) {
    if (memberHasMovements(data, member.id)) {
      window.alert(`${member.name} já tem lançamentos, fechamentos ou pagamentos registrados e não pode ser excluído.\n\nUse "Desativar" para tirar da equipe ativa preservando o histórico financeiro.`);
      return;
    }
    const confirmed = window.confirm(
      `Excluir definitivamente ${member.name}?\n\nEssa ação remove o cadastro da lista. O histórico de auditoria da exclusão será mantido. Só exclua se a pessoa não tiver lançamentos ou pagamentos associados.`,
    );
    if (!confirmed) return;

    setData((current) => ({
      ...current,
      members: current.members.filter((item) => item.id !== member.id),
      teamHistory: [...(current.teamHistory ?? []), historyEvent(member, "deleted", "Cadastro excluído definitivamente. Antes da implantação dos lançamentos financeiros, não havia movimentações vinculadas neste módulo.")],
    }));
    if (editingId === member.id) resetForm();
  }

  if (!ready) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          {loadError ? (
            <>
              <h2>Não foi possível carregar</h2>
              <p>{loadError}</p>
              <button className="primary-button" onClick={() => window.location.reload()}>Tentar de novo</button>
            </>
          ) : <p>Carregando dados…</p>}
        </div>
      </div>
    );
  }

  return (
    <AccessContext.Provider value={me}>
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><HardHat size={22} /></div>
          <div><strong>Meu Freela</strong><span>Dia 2.0</span></div>
        </div>
        <div className="workspace-label">MENU PRINCIPAL</div>
        <nav>
          {navigation.filter((item) => item.id !== "access" || (cloud && me.access === "owner")).map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${section === id ? "active" : ""}`} onClick={() => setSection(id)}>
              <Icon size={18} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {cloud ? (
            <>
              <div className="local-status"><span className={`status-dot ${sync}`} /> {sync === "saving" ? "Salvando…" : sync === "error" ? "Erro ao sincronizar" : "Sincronizado na nuvem"}</div>
              <div className="user-chip"><strong>{me.email}</strong><span>{ACCESS_LABEL[me.access]}</span></div>
            </>
          ) : (
            <div className="local-status"><span className="status-dot" /> Dados salvos neste dispositivo</div>
          )}
          <button className="backup-button" onClick={() => exportBackup(data)}><ArrowDownToLine size={16} /> Exportar backup</button>
          {cloud && <button className="backup-button" onClick={signOut}><LogOut size={16} /> Sair</button>}
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div><span className="eyebrow">CONTROLE DE FREELAS</span><h1>{navigation.find((item) => item.id === section)?.label}</h1></div>
          <div className="topbar-right"><span className="date-chip"><CalendarDays size={15} /> {new Date().toLocaleDateString("pt-BR")}</span><div className="avatar" title={me.email}>{cloud && me.email ? me.email.slice(0, 2).toUpperCase() : "MF"}</div></div>
        </header>

        {syncError && (
          <div className="sync-error" role="alert">
            <span>{syncError}</span>
            <button className="icon-button" aria-label="Fechar aviso" onClick={() => setSyncError("")}><X size={16} /></button>
          </div>
        )}

        {section === "dashboard" && <Dashboard data={data} setData={setData} />}

        {section === "team" && (
          <section className="content-card">
            <div className="section-heading team-heading">
              <div><span className="eyebrow">CADASTRO E ORGANIZAÇÃO</span><h3>Equipe cadastrada</h3><p className="muted">{activeMembers.length} integrante(s) ativo(s) · {data.members.length} cadastro(s) no total</p></div>
              {staff && <button className="primary-button" onClick={openNewForm}><Plus size={17} /> Novo integrante</button>}
            </div>

            <div className="team-tools">
              <div className="search-box"><Search size={16} /><input aria-label="Pesquisar funcionário" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar funcionário pelo nome..." /></div>
              <div className="team-filters" role="group" aria-label="Filtrar equipe">
                <button className={filter === "active" ? "selected" : ""} onClick={() => setFilter("active")}>Ativos ({activeMembers.length})</button>
                <button className={filter === "inactive" ? "selected" : ""} onClick={() => setFilter("inactive")}>Inativos ({data.members.length - activeMembers.length})</button>
                <button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>Todos ({data.members.length})</button>
              </div>
            </div>

            {showForm && (
              <form className="member-form enhanced-form" onSubmit={submitMember}>
                <div className="form-title"><strong>{editingId ? "Editar integrante" : "Novo integrante"}</strong><button type="button" className="icon-button" aria-label="Fechar formulário" onClick={resetForm}><X size={17} /></button></div>
                <label>Nome completo<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: João Silva" required maxLength={80} /></label>
                <label>Função<select value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((item) => <option key={item}>{item}</option>)}</select></label>
                <div className="form-actions"><button className="primary-button" type="submit">{editingId ? "Salvar alterações" : "Cadastrar integrante"}</button><button className="subtle-button" type="button" onClick={resetForm}>Cancelar</button></div>
              </form>
            )}

            {visibleMembers.length === 0 ? (
              <div className="empty-state"><Users size={34} /><strong>Nenhum funcionário encontrado</strong><p>{search ? "Tente outro nome ou altere o filtro selecionado." : "Não há integrantes nesta categoria."}</p>{staff && !search && filter === "active" && <button className="text-button" onClick={openNewForm}>Adicionar integrante</button>}</div>
            ) : (
              <div className="member-list">
                {visibleMembers.map((member) => (
                  <div className={`member-row enhanced-member-row ${!member.active ? "inactive" : ""}`} key={member.id}>
                    <div className="member-avatar">{member.name.slice(0, 1).toUpperCase()}</div>
                    <div className="member-info"><strong>{member.name}</strong><span>{member.role} · {member.active ? "Ativo" : "Inativo"}</span></div>
                    {staff && (
                    <div className="member-actions">
                      <button className="subtle-button" onClick={() => openEditForm(member)} title="Editar funcionário"><Pencil size={13} /> Editar</button>
                      <button className="subtle-button" onClick={() => toggleMember(member)} title={member.active ? "Desativar funcionário" : "Reativar funcionário"}>{member.active ? <UserRoundX size={13} /> : <RotateCcw size={13} />}{member.active ? "Desativar" : "Reativar"}</button>
                      <button className="danger-button" onClick={() => deleteMember(member)} title="Excluir cadastro"><Trash2 size={13} /> Excluir</button>
                    </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="history-footer" style={staff ? undefined : { display: "none" }}>
              <button className="history-toggle" onClick={() => setShowHistory((value) => !value)}><History size={15} /> {showHistory ? "Ocultar histórico" : "Ver histórico de alterações"} <span>{(data.teamHistory ?? []).length}</span></button>
            </div>
            {staff && showHistory && (
              <div className="team-history">
                {(data.teamHistory ?? []).length === 0 ? <p className="muted">Nenhuma alteração registrada ainda. Novos cadastros e mudanças serão registrados aqui.</p> : [...(data.teamHistory ?? [])].reverse().map((event) => (
                  <div className="history-item" key={event.id}>
                    <div><strong>{event.memberName}</strong><span>{event.details}</span></div>
                    <time>{new Date(event.createdAt).toLocaleString("pt-BR")}</time>
                  </div>
                ))}
              </div>
            )}
            <p className="team-note"><ShieldCheck size={14} /> Cadastros inativos ficam preservados. Exclua definitivamente apenas pessoas sem lançamentos financeiros associados.</p>
          </section>
        )}

        {section === "daily" && <DailyEntry data={data} setData={setData} />}

        {section === "payments" && <Payments data={data} setData={setData} />}

        {section === "reports" && <Reports data={data} />}

        {section === "access" && cloud && me.access === "owner" && <AccessManager data={data} />}
        <footer>Meu Freela Dia 2.0 <span>•</span> Versão 0.5.0</footer>
      </main>
    </div>
    </AccessContext.Provider>
  );
}