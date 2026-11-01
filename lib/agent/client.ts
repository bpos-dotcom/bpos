"use client";
/**
 * B-POS 2.0 · Las pantallas (en la web) hablan con B-POS Agent a través de
 * la nube: dejan un trabajo en bpos_agent_jobs y el Agent de la sucursal lo
 * toma, lo hace (imprimir, guardar impresoras) y deja el resultado. Así
 * imprime igual una caja, una tablet o un celular.
 */
import { useEffect, useState } from "react";
import { loadCloudAccount, type ReadyAccount } from "@/lib/cloud/account";
import { getSupabase, isCloudConfigured } from "@/lib/supabase/client";

export type AgentPrinter = { name: string; displayName?: string; isDefault?: boolean };

export type AgentInfo = {
  id: string;
  name: string;
  version: string;
  printers: AgentPrinter[];
  /** Es el Agent de una pantalla de kiosco: imprime su ticket; las comandas solo si no hay otro Agent de caja en línea */
  kiosk_id: string | null;
  last_seen_at: string | null;
  created_at: string;
  online: boolean;
};

export type AgentJobKind = "print-tickets" | "print-original" | "station-printers" | "print";

/** El Agent avisa cada pocos segundos; más de esto sin aviso = desconectado */
const ONLINE_MS = 30_000;
const JOB_TIMEOUT_MS = 25_000;

let scope: Promise<ReadyAccount> | null = null;

/** Negocio y sucursal de este dispositivo. */
export function agentScope(): Promise<ReadyAccount> {
  if (!isCloudConfigured) return Promise.reject(new Error("B-POS no está conectado a la nube."));
  if (!scope) {
    scope = loadCloudAccount().then((account) => {
      if (account.status !== "ready") throw new Error("Inicia sesión con la cuenta del negocio.");
      return account;
    });
    scope.catch(() => {
      scope = null;
    });
  }
  return scope;
}

export async function listAgents(): Promise<AgentInfo[]> {
  const account = await agentScope();
  const { data, error } = await getSupabase()
    .from("bpos_agents")
    .select("id, name, version, printers, kiosk_id, last_seen_at, created_at")
    .eq("branch_id", account.branchId)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const now = Date.now();
  return (data ?? []).map((row) => ({
    ...(row as Omit<AgentInfo, "online">),
    printers: Array.isArray(row.printers) ? (row.printers as AgentPrinter[]) : [],
    kiosk_id: (row as { kiosk_id?: string | null }).kiosk_id || null,
    online: Boolean(row.last_seen_at && now - Date.parse(row.last_seen_at) < ONLINE_MS),
  }));
}

/** Código de 8 letras para vincular un Agent a esta sucursal (dura 15 minutos). */
export async function newPairingCode(): Promise<{ code: string; expires_at: string }> {
  const account = await agentScope();
  const { data, error } = await getSupabase().rpc("bpos_agent_new_code", { p_branch_id: account.branchId });
  if (error) throw new Error(error.message);
  return data as { code: string; expires_at: string };
}

export async function unlinkAgent(id: string) {
  const { error } = await getSupabase().from("bpos_agents").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Manda un trabajo al Agent de la sucursal y espera su resultado.
 * Lanza error si no hay Agent conectado o no contesta a tiempo.
 */
export async function runAgentJob<T = Record<string, unknown>>(kind: AgentJobKind, payload: unknown, timeoutMs = JOB_TIMEOUT_MS): Promise<T> {
  const account = await agentScope();
  const supabase = getSupabase();
  const { data: job, error } = await supabase
    .from("bpos_agent_jobs")
    .insert({ business_id: account.businessId, branch_id: account.branchId, kind, payload })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const until = Date.now() + timeoutMs;
  let delay = 600;
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay + 300, 1500);
    const { data: row } = await supabase.from("bpos_agent_jobs").select("status, result").eq("id", job.id).maybeSingle();
    if (row?.status === "done") return (row.result ?? {}) as T;
    if (row?.status === "error") {
      const message = (row.result as { error?: string } | null)?.error;
      throw new Error(message || "B-POS Agent no pudo hacerlo.");
    }
  }
  throw new Error("B-POS Agent no respondió. Revisa que la computadora de las impresoras esté prendida y con internet.");
}

/** Agents de la sucursal, revisados cada `intervalMs`. */
export function useAgents(intervalMs = 15_000) {
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isCloudConfigured) return;
    let alive = true;
    const load = () =>
      listAgents()
        .then((list) => {
          if (!alive) return;
          setAgents(list);
          setError("");
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : "No se pudo revisar el Agent."));
    void load();
    const timer = window.setInterval(load, intervalMs);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  const reload = () => listAgents().then(setAgents).catch(() => {});
  return { agents, error, reload, online: Boolean(agents?.some((a) => a.online)) };
}
