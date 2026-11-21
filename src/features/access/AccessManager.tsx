import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Copy, Eye, EyeOff, KeyRound, RefreshCw, Trash2, UserPlus } from "lucide-react";
import type { AppData } from "../../types";
import { ACCESS_LABEL, useMe } from "../../auth/access";
import {
  createAccess, listAccess, removeAccess, setAccessPassword,
  type AccessResult, type AccessRow,
} from "../../services/accessAdmin";
import "./access.css";

type NewKind = "manager" | "member";

const message = (error: unknown) => (error instanceof Error ? error.message : "Algo deu errado. Tente de novo.");

function mailNote(email: string, result: AccessResult, wanted: boolean): string {
  if (!wanted) return "E-mail não enviado, como você escolheu. Passe os dados à pessoa.";
  if (result.emailSent) return `E-mail enviado para ${email}. No primeiro acesso a pessoa cria uma senha nova.`;
  return `Não foi possível enviar o e-mail: ${result.emailError ?? "motivo desconhecido"} Passe os dados à pessoa por outro canal.`;
}

/** Senha provisória fácil de ditar: sem letras e números que se confundem (0/O, 1/l/I). */
function generatePassword(length = 10): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (n) => chars[n % chars.length]).join("");
}

export default function AccessManager({ data }: { data: AppData }) {
  const me = useMe();
  const [rows, setRows] = useState<AccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<NewKind>("member");
  const [memberId, setMemberId] = useState("");
  const [password, setPassword] = useState(() => generatePassword());
  const [showPassword, setShowPassword] = useState(true);
  const [sendEmail, setSendEmail] = useState(true);
  const [created, setCreated] = useState<{ email: string; password: string; title: string; mail: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await listAccess());
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Quem ainda pode receber login: Garçom, Caixa ou Bar, ativos e sem acesso.
  const available = useMemo(() => {
    const linked = new Set(rows.map((row) => row.memberId).filter(Boolean));
    return data.members
      .filter((member) => member.active && member.role !== "Cozinha" && !linked.has(member.id))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [data.members, rows]);

  if (me.access !== "owner") {
    return (
      <section className="content-card">
        <div className="empty-state">
          <KeyRound size={34} />
          <strong>Só o dono gerencia acessos</strong>
          <p>Peça ao dono para criar ou alterar logins.</p>
        </div>
      </section>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCreated(null);
    setCopied(false);
    if (kind === "member" && !memberId) {
      setError("Escolha a pessoa da equipe que vai usar este login.");
      return;
    }
    if (password.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const person = data.members.find((member) => member.id === memberId);
    setBusy(true);
    try {
      const result = await createAccess({
        email: cleanEmail,
        password,
        access: kind,
        memberId: kind === "member" ? memberId : null,
        sendEmail,
      });
      setCreated({
        email: cleanEmail,
        password,
        title: kind === "manager" ? "Gerente" : person ? `${person.name} (${person.role})` : "Integrante",
        mail: mailNote(cleanEmail, result, sendEmail),
      });
      setEmail("");
      setMemberId("");
      setPassword(generatePassword());
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyAccess() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(`E-mail: ${created.email}\nSenha provisória: ${created.password}`);
      setCopied(true);
    } catch {
      setError("Não foi possível copiar. Selecione o texto e copie à mão.");
    }
  }

  async function resetPassword(row: AccessRow) {
    const suggestion = generatePassword();
    const typed = window.prompt(`Nova senha provisória para ${row.email}\n(mínimo 8 caracteres). Você pode usar a sugestão:`, suggestion);
    if (typed === null) return;
    const next = typed.trim();
    if (next.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    const wantsMail = window.confirm(`Enviar a nova senha por e-mail para ${row.email}?\n\nOK = enviar por e-mail\nCancelar = só mostrar na tela`);
    setBusy(true);
    setError("");
    try {
      const result = await setAccessPassword(row.userId, next, wantsMail);
      setCopied(false);
      setCreated({
        email: row.email, password: next, title: "Nova senha provisória",
        mail: mailNote(row.email, result, wantsMail),
      });
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: AccessRow) {
    const ok = window.confirm(
      `Revogar o acesso de ${row.email}?\n\nO login deixa de existir e a pessoa não consegue mais ver nem lançar nada. Lançamentos e pagamentos já feitos continuam no histórico.`,
    );
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await removeAccess(row.userId);
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">LOGINS DO SISTEMA</span>
          <h3>Acessos</h3>
          <p className="muted">Crie logins para gerentes e para quem lança o próprio dia. A Cozinha não tem login.</p>
        </div>
      </div>

      {error && (
        <div className="sync-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      <form className="member-form enhanced-form access-form" onSubmit={submit}>
        <div className="form-title"><strong>Novo acesso</strong></div>
        <div className="access-row">
          <label>
            E-mail
            <input
              type="email" value={email} required autoComplete="off"
              onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@exemplo.com"
            />
          </label>
          <label>
            Perfil
            <select value={kind} onChange={(e) => { setKind(e.target.value as NewKind); setMemberId(""); }}>
              <option value="member">Integrante (lança o próprio dia)</option>
              <option value="manager">Gerente (fecha o dia e edita tudo)</option>
            </select>
          </label>
        </div>

        {kind === "member" && (
          <label>
            Pessoa da equipe
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)} required>
              <option value="">Escolha…</option>
              {available.map((member) => (
                <option key={member.id} value={member.id}>{member.name} — {member.role}</option>
              ))}
            </select>
            {available.length === 0 && (
              <p className="access-hint">
                Ninguém disponível. Cadastre a pessoa na aba Equipe (Garçom, Caixa ou Bar) e espere o aviso “Sincronizado na nuvem”.
              </p>
            )}
          </label>
        )}

        <div className="access-pass">
          <label>
            Senha provisória
            <input
              type={showPassword ? "text" : "password"} value={password} minLength={8} required
              autoComplete="new-password" onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="button" className="subtle-button" onClick={() => setShowPassword((v) => !v)} title={showPassword ? "Ocultar senha" : "Mostrar senha"}>
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button type="button" className="subtle-button" onClick={() => setPassword(generatePassword())} title="Gerar outra senha">
            <RefreshCw size={14} /> Gerar
          </button>
        </div>

        <label className="access-check">
          <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
          Enviar a senha provisória por e-mail. No primeiro acesso a pessoa define a própria senha.
        </label>

        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={busy}>
            <UserPlus size={16} /> {busy ? "Criando…" : "Criar acesso"}
          </button>
        </div>
      </form>

      {created && (
        <div className="access-secret" role="status">
          <strong>{created.title}</strong>
          <p className="access-mail">{created.mail}</p>
          <span>E-mail: <code>{created.email}</code></span>
          <span>Senha provisória: <code>{created.password}</code></span>
          <p className="access-hint">Esta senha não aparece de novo depois que você sair desta tela.</p>
          <div className="access-secret-actions">
            <button className="subtle-button" onClick={copyAccess}><Copy size={13} /> {copied ? "Copiado" : "Copiar dados"}</button>
            <button className="subtle-button" onClick={() => setCreated(null)}>Fechar</button>
          </div>
        </div>
      )}

      <div className="access-list">
        {loading ? (
          <p className="muted">Carregando acessos…</p>
        ) : rows.length === 0 ? (
          <div className="empty-state"><KeyRound size={34} /><strong>Nenhum acesso ainda</strong></div>
        ) : (
          rows.map((row) => (
            <div className="access-item" key={row.userId}>
              <div className="access-item-info">
                <strong>{row.email || "(sem e-mail)"}</strong>
                <span>
                  {ACCESS_LABEL[row.access]}
                  {row.memberName ? ` · ${row.memberName}` : ""}
                  {row.mustChange && <span className="access-pending"> · ainda não trocou a senha provisória</span>}
                </span>
              </div>
              <div className="access-item-actions">
                {row.access !== "owner" && (
                  <>
                    <button className="subtle-button" disabled={busy} onClick={() => resetPassword(row)}>
                      <KeyRound size={13} /> Nova senha provisória
                    </button>
                    <button className="danger-button" disabled={busy} onClick={() => remove(row)}>
                      <Trash2 size={13} /> Revogar acesso
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}