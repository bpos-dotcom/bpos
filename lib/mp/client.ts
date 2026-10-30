"use client";
/**
 * Mercado Pago del negocio desde las pantallas: vincular la cuenta, elegir la
 * terminal Point de la sucursal y cobrar con ella desde el POS. Todo pasa por
 * el servidor de B-POS (/api/mp/...); las llaves nunca llegan aquí.
 */
import { aiFetch } from "@/lib/ai/client";
import { agentScope } from "@/lib/agent/client";

export type MpStatus = { linked: boolean; nickname: string; linkedAt: string | null; terminal: string | null; canLink: boolean };
export type MpTerminal = { id: string; operating_mode?: string; external_pos_id?: string };
export type ChargeStatus = { id: string; status: string; detail: string; amount: number };

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await aiFetch(path, init);
  const b = await r.json().catch(() => null);
  if (!r.ok || !b?.success) {
    const error = new Error(b?.error || "Mercado Pago no respondió.") as Error & { code?: string };
    error.code = b?.code;
    throw error;
  }
  return b as T;
}

export async function getMpStatus(): Promise<MpStatus> {
  const { branchId } = await agentScope();
  return call<MpStatus>(`/api/mp/link?branch=${branchId}`, { cache: "no-store" });
}

/** Lleva al dueño a Mercado Pago para autorizar a B-POS. */
export async function startMpLink() {
  const { url } = await call<{ url: string }>("/api/mp/link", { method: "POST", body: "{}" });
  window.location.href = url;
}

export function unlinkMp() {
  return call("/api/mp/link", { method: "DELETE", body: "{}" });
}

export async function listMpTerminals() {
  const { branchId } = await agentScope();
  return call<{ terminals: MpTerminal[]; selected: string | null }>(`/api/mp/point?branch=${branchId}`, { cache: "no-store" });
}

export async function selectMpTerminal(terminalId: string) {
  const { branchId } = await agentScope();
  return call<{ terminal: string; pdvChanged: boolean }>("/api/mp/point", { method: "POST", body: JSON.stringify({ branchId, terminalId }) });
}

export async function removeMpTerminal() {
  const { branchId } = await agentScope();
  return call("/api/mp/point", { method: "DELETE", body: JSON.stringify({ branchId }) });
}

/** "NEWLAND_N950__N950NCB801293324" → "Newland N950 · …3324" */
export function terminalLabel(id: string) {
  const [model, serial = ""] = id.split("__");
  return `${model.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}${serial ? ` · …${serial.slice(-4)}` : ""}`;
}

// ------------------------------------------------------------ cobro en terminal

export async function startTerminalCharge(amount: number, description: string) {
  const { branchId } = await agentScope();
  return call<{ id: string; status: string }>("/api/mp/point/charge", { method: "POST", body: JSON.stringify({ branchId, amount, description }) });
}

export function terminalChargeStatus(id: string) {
  return call<ChargeStatus>(`/api/mp/point/charge?id=${encodeURIComponent(id)}`, { cache: "no-store" });
}

export function cancelTerminalCharge(id: string) {
  return call<{ status: string }>(`/api/mp/point/charge?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** ¿Esta sucursal cobra con terminal? (se recuerda unos minutos para no preguntar en cada venta) */
let terminalCache: { at: number; value: boolean } | null = null;
export async function branchUsesTerminal(): Promise<boolean> {
  if (terminalCache && Date.now() - terminalCache.at < 5 * 60 * 1000) return terminalCache.value;
  try {
    const s = await getMpStatus();
    terminalCache = { at: Date.now(), value: s.linked && Boolean(s.terminal) };
  } catch {
    terminalCache = { at: Date.now(), value: false };
  }
  return terminalCache.value;
}
export function forgetTerminalCache() {
  terminalCache = null;
}
