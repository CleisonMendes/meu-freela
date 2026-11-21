// Edge Function "manage-access": cria, lista, troca senha e remove logins.
// Roda no servidor do Supabase, onde a chave service_role fica guardada (nunca vai para o app).
//   - list / create / set_password / remove: só o DONO.
//   - change_own_password: qualquer pessoa com acesso (usada no primeiro login).
// E-mail (opcional): configure os segredos BREVO_API_KEY e MAIL_FROM (e, se quiser, MAIL_FROM_NAME e APP_URL).
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type MailResult = { sent: boolean; error?: string };

/** Envia a senha provisória por e-mail (Brevo). Nunca derruba a criação do acesso: devolve o motivo da falha. */
async function sendPasswordEmail(to: string, password: string, kind: "created" | "reset"): Promise<MailResult> {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  const from = Deno.env.get("MAIL_FROM");
  if (!apiKey || !from) {
    return { sent: false, error: "o envio de e-mail ainda não foi configurado no Supabase." };
  }
  const appUrl = Deno.env.get("APP_URL");
  const intro = kind === "created"
    ? "O dono do Meu Freela criou um acesso para você."
    : "O dono do Meu Freela redefiniu a sua senha. Use a senha provisória abaixo para entrar.";
  const link = appUrl ? `<p>Acesse: <a href="${esc(appUrl)}">${esc(appUrl)}</a></p>` : "";
  const html =
    `<p>Olá!</p><p>${intro}</p>` +
    `<p><strong>E-mail:</strong> ${esc(to)}<br><strong>Senha provisória:</strong> <code>${esc(password)}</code></p>` +
    link +
    `<p>No primeiro acesso o app pede que você crie uma nova senha. Não compartilhe esta mensagem.</p>`;
  const text =
    `Olá!\n\n${intro}\n\nE-mail: ${to}\nSenha provisória: ${password}\n` +
    (appUrl ? `Acesse: ${appUrl}\n` : "") +
    `\nNo primeiro acesso o app pede que você crie uma nova senha. Não compartilhe esta mensagem.`;
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: Deno.env.get("MAIL_FROM_NAME") ?? "Meu Freela", email: from },
        to: [{ email: to }],
        subject: kind === "created" ? "Seu acesso ao Meu Freela" : "Nova senha provisória do Meu Freela",
        htmlContent: html,
        textContent: text,
      }),
    });
    if (!res.ok) {
      console.error("Brevo recusou o envio:", res.status, await res.text());
      return { sent: false, error: `o serviço de e-mail recusou o envio (erro ${res.status}). Veja os Logs da função.` };
    }
    return { sent: true };
  } catch (error) {
    console.error("Falha ao contatar o serviço de e-mail:", error);
    return { sent: false, error: "não foi possível contatar o serviço de e-mail." };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Quem está chamando? A sessão é validada aqui, no servidor.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Entre de novo no app." }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: "Sessão inválida. Entre de novo no app." }, 401);
  const caller = auth.user;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Pedido inválido." }, 400); }

  const audit = async (action: string, key: string, details: Record<string, unknown>) => {
    await admin.from("audit_log").insert({
      actor: caller.id, action, entity: "app_user", entity_key: key, details,
    });
  };

  try {
    // ---------- a própria pessoa troca a senha (primeiro acesso) ----------
    if (body.action === "change_own_password") {
      const password = String(body.password ?? "");
      if (password.length < 8) return json({ error: "A senha precisa ter pelo menos 8 caracteres." }, 400);
      const { data: mine } = await admin
        .from("app_users").select("user_id").eq("user_id", caller.id).maybeSingle();
      if (!mine) return json({ error: "Este login não tem acesso ao sistema." }, 403);

      // A nova senha não pode ser igual à atual (a provisória).
      if (caller.email) {
        const probe = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { error: sameError } = await probe.auth.signInWithPassword({ email: caller.email, password });
        if (!sameError) return json({ error: "Escolha uma senha diferente da provisória." }, 400);
      }

      const { error } = await admin.auth.admin.updateUserById(caller.id, {
        password, app_metadata: { must_change_password: false },
      });
      if (error) return json({ error: "Não foi possível salvar a nova senha: " + error.message }, 400);
      await audit("password_changed", caller.id, {});
      return json({ ok: true });
    }

    // 2) Daqui para baixo, só o dono.
    const { data: me } = await admin
      .from("app_users").select("access").eq("user_id", caller.id).maybeSingle();
    if (me?.access !== "owner") return json({ error: "Só o dono pode gerenciar acessos." }, 403);

    // ---------- listar ----------
    if (body.action === "list") {
      const [{ data: rows, error: e1 }, { data: members, error: e2 }, listed] = await Promise.all([
        admin.from("app_users").select("user_id, access, member_id, created_at").order("created_at"),
        admin.from("members").select("id, name"),
        admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      ]);
      if (e1 || e2 || listed.error) return json({ error: "Não foi possível listar os acessos." }, 500);
      const users = new Map(listed.data.users.map((u) => [u.id, u]));
      const names = new Map((members ?? []).map((m) => [m.id, m.name]));
      return json({
        rows: (rows ?? []).map((r) => {
          const u = users.get(r.user_id);
          return {
            userId: r.user_id,
            email: u?.email ?? "",
            access: r.access,
            memberId: r.member_id,
            memberName: r.member_id ? names.get(r.member_id) ?? null : null,
            mustChange: u?.app_metadata?.must_change_password === true,
            createdAt: r.created_at,
          };
        }),
      });
    }

    // ---------- criar ----------
    if (body.action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const access = String(body.access ?? "");
      const memberId = body.memberId ? String(body.memberId) : null;
      const sendEmail = body.sendEmail !== false;

      if (!EMAIL_RE.test(email)) return json({ error: "E-mail inválido." }, 400);
      if (password.length < 8) return json({ error: "A senha precisa ter pelo menos 8 caracteres." }, 400);
      if (access !== "manager" && access !== "member") return json({ error: "Perfil inválido." }, 400);

      if (access === "member") {
        if (!memberId) return json({ error: "Escolha a pessoa da equipe." }, 400);
        const { data: m } = await admin
          .from("members").select("id, role, active").eq("id", memberId).maybeSingle();
        if (!m) return json({ error: "Pessoa não encontrada. Aguarde o app mostrar \"Sincronizado na nuvem\" e tente de novo." }, 400);
        if (m.role === "Cozinha") return json({ error: "Integrantes da Cozinha não têm login." }, 400);
        const { data: taken } = await admin
          .from("app_users").select("user_id").eq("member_id", memberId).maybeSingle();
        if (taken) return json({ error: "Essa pessoa já tem um acesso." }, 400);
      }

      const created = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        app_metadata: { must_change_password: true }, // exige trocar a senha no primeiro acesso
      });
      if (created.error || !created.data.user) {
        const msg = created.error?.message ?? "";
        return json({
          error: /already|registered|exists/i.test(msg)
            ? "Já existe um login com esse e-mail."
            : "Não foi possível criar o login: " + msg,
        }, 400);
      }
      const userId = created.data.user.id;

      const { error: linkError } = await admin.from("app_users").insert({
        user_id: userId, access, member_id: access === "member" ? memberId : null,
      });
      if (linkError) {
        await admin.auth.admin.deleteUser(userId); // desfaz: não deixa login sem acesso
        return json({ error: "Não foi possível liberar o acesso: " + linkError.message }, 400);
      }

      const mail: MailResult = sendEmail ? await sendPasswordEmail(email, password, "created") : { sent: false };
      await audit("access_created", userId, { email, access, member_id: memberId, email_sent: mail.sent });
      return json({ ok: true, userId, emailSent: mail.sent, emailError: mail.error });
    }

    // ---------- nova senha provisória ----------
    if (body.action === "set_password") {
      const userId = String(body.userId ?? "");
      const password = String(body.password ?? "");
      const sendEmail = body.sendEmail !== false;
      if (password.length < 8) return json({ error: "A senha precisa ter pelo menos 8 caracteres." }, 400);
      const { data: row } = await admin.from("app_users").select("user_id").eq("user_id", userId).maybeSingle();
      if (!row) return json({ error: "Acesso não encontrado." }, 404);
      const { data: target } = await admin.auth.admin.getUserById(userId);
      if (!target?.user) return json({ error: "Login não encontrado." }, 404);

      const { error } = await admin.auth.admin.updateUserById(userId, {
        password, app_metadata: { must_change_password: true },
      });
      if (error) return json({ error: "Não foi possível trocar a senha: " + error.message }, 400);

      const to = target.user.email;
      const mail: MailResult = sendEmail && to ? await sendPasswordEmail(to, password, "reset") : { sent: false };
      await audit("access_password_reset", userId, { email_sent: mail.sent });
      return json({ ok: true, emailSent: mail.sent, emailError: mail.error });
    }

    // ---------- revogar (remover) ----------
    if (body.action === "remove") {
      const userId = String(body.userId ?? "");
      if (userId === caller.id) return json({ error: "Você não pode remover o seu próprio acesso." }, 400);
      const { data: row } = await admin
        .from("app_users").select("access").eq("user_id", userId).maybeSingle();
      if (!row) return json({ error: "Acesso não encontrado." }, 404);
      if (row.access === "owner") return json({ error: "O acesso de dono não pode ser removido." }, 400);
      const { error } = await admin.auth.admin.deleteUser(userId); // apaga o login e, em cascata, o acesso
      if (error) return json({ error: "Não foi possível remover: " + error.message }, 400);
      await audit("access_removed", userId, {});
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return json({ error: "Erro inesperado: " + (error instanceof Error ? error.message : String(error)) }, 500);
  }
});