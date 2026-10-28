"use client";
import { getSupabase, isCloudConfigured } from "@/lib/supabase/client";

/** fetch para /api/bridge/*: agrega la sesión de la cuenta del negocio (ver lib/bridge/api-guard.ts). */
export async function bridgeFetch(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (isCloudConfigured) {
    try {
      const { data } = await getSupabase().auth.getSession();
      if (data.session?.access_token) headers.set("Authorization", `Bearer ${data.session.access_token}`);
    } catch {
      // sin sesión: la API contestará 401
    }
  }
  return fetch(url, { ...init, headers });
}
