import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from "@/lib/supabase/config";

// Next.js incrusta estas variables al compilar; deben leerse literalmente.
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL)
  .replace(/\/rest\/v1\/?$/, "")
  .replace(/\/$/, "");
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  DEFAULT_SUPABASE_PUBLISHABLE_KEY;

/** true cuando el proyecto tiene Supabase configurado (modo nube) */
export const isCloudConfigured = SUPABASE_URL !== "" && SUPABASE_KEY !== "";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isCloudConfigured) {
    throw new Error(
      "Supabase no está configurado. Agrega NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "sb-bpos-auth",
      },
    });
  }

  return client;
}

/** Traduce errores de Supabase/Postgres a mensajes para el usuario */
export function friendlyError(error: { message?: string; code?: string } | null | undefined): string {
  const message = error?.message ?? "Error desconocido.";

  if (error?.code === "42501" || message.includes("SIN_ACCESO")) {
    return "Tu cuenta no tiene acceso a esta sucursal.";
  }
  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return "Sin conexión a internet. Revisa la red e inténtalo de nuevo.";
  }
  if (message.includes("Invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  if (message.includes("Email not confirmed")) {
    return "Confirma tu correo antes de entrar (revisa tu bandeja de entrada).";
  }
  if (message.includes("User already registered")) {
    return "Ese correo ya tiene cuenta. Usa \"Entrar\".";
  }
  if (message.includes("duplicate key")) {
    return "Ese registro ya existe.";
  }

  return message;
}
