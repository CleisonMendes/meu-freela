import { supabase } from "../lib/supabase";
import type { AccessLevel } from "../auth/access";

export interface AccessRow {
  userId: string;
  email: string;
  access: AccessLevel;
  memberId: string | null;
  memberName: string | null;
  /** true enquanto a pessoa ainda não trocou a senha provisória. */
  mustChange: boolean;
  createdAt: string;
}

export interface NewAccess {
  email: string;
  password: string;
  access: "manager" | "member";
  memberId: string | null;
  sendEmail: boolean;
}

export interface AccessResult {
  ok: true;
  userId?: string;
  emailSent: boolean;
  emailError?: string;
}

const NOT_PUBLISHED = "A função manage-access ainda não foi publicada no Supabase (confira o nome exato).";

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error("A nuvem não está configurada.");
  const { data, error } = await supabase.functions.invoke("manage-access", {
    body: { action, ...payload },
  });
  if (error) {
    // Erros HTTP da função trazem a resposta em error.context
    const response = (error as { context?: Response }).context;
    let message = "";
    if (response && typeof response.json === "function") {
      try {
        const body = await response.json();
        if (response.status === 404 && body?.code === "NOT_FOUND") {
          // Resposta do próprio Supabase quando a função não existe
          message = NOT_PUBLISHED;
        } else if (body && typeof body.error === "string") {
          // Mensagem da nossa função (inclui os 404 de "acesso não encontrado")
          message = body.error;
        } else if (body && typeof body.message === "string") {
          message = `O servidor respondeu ${response.status}: ${body.message}`;
        }
      } catch {
        /* resposta sem corpo legível */
      }
      if (!message) message = `O servidor respondeu com erro ${response.status}.`;
    }
    throw new Error(message || `Não foi possível falar com a função manage-access (${error.message}). ${NOT_PUBLISHED}`);
  }
  if (data && typeof data.error === "string") throw new Error(data.error);
  return data as T;
}

export async function listAccess(): Promise<AccessRow[]> {
  const result = await call<{ rows: AccessRow[] }>("list");
  return result.rows;
}

export const createAccess = (input: NewAccess) => call<AccessResult>("create", { ...input });

export const removeAccess = (userId: string) => call<{ ok: true }>("remove", { userId });

/** Nova senha provisória: a pessoa será obrigada a trocá-la no próximo acesso. */
export const setAccessPassword = (userId: string, password: string, sendEmail: boolean) =>
  call<AccessResult>("set_password", { userId, password, sendEmail });

/** A própria pessoa define a senha definitiva (primeiro acesso). */
export const changeOwnPassword = (password: string) => call<{ ok: true }>("change_own_password", { password });