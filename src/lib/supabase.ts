import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Sem .env.local o app continua no modo antigo (dados no navegador). */
export const cloudEnabled = Boolean(url && key);
export const supabase = cloudEnabled ? createClient(url as string, key as string) : null;