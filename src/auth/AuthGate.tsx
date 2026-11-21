import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { AccessLevel, Me } from "./access";

type Phase =
  | { name: "loading" }
  | { name: "login" }
  | { name: "denied"; email: string }
  | { name: "ready"; me: Me };

interface Props {
  children: (me: Me, signOut: () => void) => ReactNode;
}

export default function AuthGate({ children }: Props) {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;

    async function resolve(session: Session | null) {
      if (!client) return;
      if (!session) {
        if (active) setPhase({ name: "login" });
        return;
      }
      const { data, error: queryError } = await client
        .from("app_users")
        .select("access, member_id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (!active) return;
      if (queryError || !data) {
        setPhase({ name: "denied", email: session.user.email ?? "" });
        return;
      }
      setPhase({
        name: "ready",
        me: {
          access: data.access as AccessLevel,
          memberId: (data.member_id as string | null) ?? null,
          email: session.user.email ?? "",
        },
      });
    }

    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED") return;
      // setTimeout evita deadlock ao consultar o banco dentro do callback de autenticação.
      window.setTimeout(() => void resolve(session), 0);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (signInError) setError("E-mail ou senha incorretos.");
    else setPassword("");
  }

  const signOut = () => {
    void supabase?.auth.signOut();
  };

  if (phase.name === "loading") {
    return <div className="auth-screen"><div className="auth-card"><p>Carregando…</p></div></div>;
  }

  if (phase.name === "denied") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h2>Acesso ainda não liberado</h2>
          <p>O usuário <strong>{phase.email}</strong> entrou, mas ainda não foi cadastrado no sistema. Peça ao dono para liberar o seu acesso.</p>
          <button className="primary-button" onClick={signOut}>Sair</button>
        </div>
      </div>
    );
  }

  if (phase.name === "login") {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={signIn}>
          <h2>Meu Freela Dia 2.0</h2>
          <p>Entre com o e-mail e a senha que o dono criou para você.</p>
          <label>E-mail<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Senha<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
        </form>
      </div>
    );
  }

  return <>{children(phase.me, signOut)}</>;
}