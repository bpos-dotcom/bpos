"use client";
import { getSupabase, isCloudConfigured } from "@/lib/supabase/client";

/** fetch para /api/bridge/*: agrega la sesión de la cuenta del negocio (ver lib/bridge/api-guard.ts). */
export async function bridgeFetch(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (isCloudConfigured) {
    const branch = localStorage.getItem("bpos_branch_id");
    if (branch) headers.set("x-bpos-branch", branch);
    try {
      const { data } = await getSupabase().auth.getSession();
      if (data.session?.access_token) headers.set("Authorization", `Bearer ${data.session.access_token}`);
    } catch {
      // sin sesión: la API contestará 401
    }
  }
  return fetch(url, { ...init, headers });
}

let versionCache: { at: number; promise: Promise<string> } | null = null;

/**
 * Huella del Bridge (unos bytes): si no cambió, no hay que bajar pedidos ni
 * equivalencias. El menú lateral, el procesador en segundo plano y la página
 * del Bridge la piden seguido; dentro de 1.5 s comparten la misma respuesta.
 * "" si no se pudo consultar.
 */
export function bridgeVersion(): Promise<string> {
  if (versionCache && Date.now() - versionCache.at < 1500) return versionCache.promise;
  const promise = bridgeFetch("/api/bridge/version", { cache: "no-store" })
    .then(async (r) => (r.ok ? String(((await r.json().catch(() => ({}))) as { version?: string }).version || "") : ""))
    .catch(() => "");
  versionCache = { at: Date.now(), promise };
  return promise;
}
