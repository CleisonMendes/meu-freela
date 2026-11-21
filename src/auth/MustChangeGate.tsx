import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "../lib/supabase";
import { changeOwnPassword } from "../services/accessAdmin";
import "./mustchange.css";

type GateState = "checking" | "change" | "ok";

/**
 * Fica entre o login e o app. Se o dono criou o acesso (ou redefiniu a senha),
 * a pessoa só entra depois de escolher uma senha nova.
 */
export default function MustChangeGate({ signOut, children }: { signOut: () => void; children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    if (!supabase) {
      setState("ok");
      return;
    }
    supabase.auth.getUser()
      .then(({ data }) => {
        if (!alive) return;
        setEmail(data.user?.email ?? "");
        setState(data.user?.app_metadata?.must_change_password === true ? "change" : "ok");
      })
      .catch(() => alive && setState("ok"));
    return () => { alive = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password.length < 8) { setError("A senha precisa ter pelo menos 8 caracteres."); return; }
    if (password !== confirm) { setError("As duas senhas não são iguais."); return; }
    if (!supabase) return;
    setBusy(true);
    try {
      await changeOwnPassword(password);
      // Atualiza a sessão para refletir que a troca foi feita; se não der, entra de novo com a senha nova.
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error && email) {
        const signed = await supabase.auth.signInWithPassword({ email, password });
        if (signed.error) throw new Error("Senha salva, mas não foi possível entrar. Faça login com a senha nova.");
      }
      setState("ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar a senha.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "ok") return <>{children}</>;

  if (state === "checking") {
    return (
      <div className="auth-screen"><div className="auth-card"><p>Carregando…</p></div></div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h2>Crie a sua senha</h2>
        <p>
          Você entrou com uma senha provisória{email ? ` (${email})` : ""}. Escolha uma senha nova, só sua, para continuar.
        </p>
        <form className="mc-form" onSubmit={submit}>
          <label>
            Nova senha
            <input
              type={show ? "text" : "password"} value={password} minLength={8} required
              autoComplete="new-password" onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            Repita a nova senha
            <input
              type={show ? "text" : "password"} value={confirm} minLength={8} required
              autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <button type="button" className="subtle-button mc-toggle" onClick={() => setShow((v) => !v)}>
            {show ? <EyeOff size={14} /> : <Eye size={14} />} {show ? "Ocultar senhas" : "Mostrar senhas"}
          </button>
          {error && <p className="mc-error" role="alert">{error}</p>}
          <div className="mc-actions">
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Salvando…" : "Salvar nova senha"}
            </button>
            <button className="subtle-button" type="button" onClick={signOut} disabled={busy}>Sair</button>
          </div>
        </form>
      </div>
    </div>
  );
}