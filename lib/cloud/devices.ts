"use client";
/**
 * Dispositivos conectados (28 nov). Cada equipo con B-POS abierto avisa a la
 * nube que sigue vivo (al abrir, cada 2 minutos y al volver a la ventana):
 *  - Así el dueño ve en Configuración → Sistema → Dispositivos cuáles están
 *    conectados, desde cuándo, la última vez que se usaron y dónde (aprox.).
 *  - La nube le contesta si su sesión se cerró desde esa lista (entonces sube
 *    lo pendiente y se sale) y si es la caja principal de su sucursal (la
 *    caja principal ya no se decide solo en cada equipo: se elige en la lista).
 * Cuando el dueño cambia algo, la nube da un toque por tiempo real
 * ("devices-<negocio>") y cada equipo vuelve a preguntar al momento.
 */
import type { ReadyAccount } from "@/lib/cloud/account";
import { getSupabase } from "@/lib/supabase/client";

export const PRIMARY_EVENT = "bpos:primary-device-updated";
export const DEVICES_EVENT = "bpos:devices-updated";
export const PING_EVERY_MS = 2 * 60 * 1000;
/** Se muestra al volver a la pantalla de entrar (solo en esta pestaña) */
export const CLOSED_NOTICE_KEY = "bpos_session_closed_notice";

export type DeviceKind = "navegador" | "app-dueno" | "caja-local" | "cocina" | "mesero";
export type DeviceRow = {
  device_id: string;
  branch_id: string | null;
  branch_name: string | null;
  email: string | null;
  name: string;
  label: string;
  kind: DeviceKind | string;
  first_seen_at: string;
  last_seen_at: string;
  ip: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  revoked_at: string | null;
  is_primary: boolean;
};
export type PingResult = { revoked: boolean; primary: boolean; name?: string };

/** Nombre automático del equipo: navegador y sistema (o la app), y para qué se usa */
export function deviceLabel(input: { ua: string; platform?: string | null; cajaKind?: string | null; path?: string; brave?: boolean }): { label: string; kind: DeviceKind } {
  const ua = input.ua || "";
  const platform = (input.platform || "").toLowerCase();
  const os =
    platform === "android" || /Android/i.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/i.test(ua)
        ? "iPhone"
        : platform === "windows" || /Windows/i.test(ua)
          ? "Windows"
          : platform === "macos" || /Macintosh|Mac OS X/i.test(ua)
            ? "Mac"
            : platform === "chrome os" || /CrOS/i.test(ua)
              ? "Chromebook"
              : /Linux/i.test(ua)
                ? "Linux"
                : "";
  if (input.cajaKind === "android" || /BPOSDueno\//.test(ua)) return { label: `App Dueño${os ? ` (${os})` : ""}`, kind: "app-dueno" };
  if (input.cajaKind) return { label: `Caja local B-POS Agent${os ? ` (${os})` : ""}`, kind: "caja-local" };
  const browser = /SamsungBrowser/i.test(ua)
    ? "Samsung Internet"
    : /Edg\//.test(ua)
      ? "Edge"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Firefox\/|FxiOS/.test(ua)
          ? "Firefox"
          : input.brave
            ? "Brave"
            : /Chrome\/|CriOS/.test(ua)
              ? "Chrome"
              : /Safari\//.test(ua)
                ? "Safari"
                : "Navegador";
  const base = `${browser}${os ? ` en ${os}` : ""}`;
  const path = input.path || "";
  if (path.startsWith("/kds")) return { label: `Pantalla de cocina · ${base}`, kind: "cocina" };
  if (path.startsWith("/meseros")) return { label: `Mesero · ${base}`, kind: "mesero" };
  return { label: base, kind: "navegador" };
}

/** session_id de la sesión (va dentro del token): con él la nube cierra esa sesión */
export function sessionIdOf(token: string | null | undefined): string | null {
  const part = (token || "").split(".")[1];
  if (!part) return null;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4))) as { session_id?: unknown };
    return typeof json.session_id === "string" ? json.session_id : null;
  } catch {
    return null;
  }
}

/** "Monterrey, Nuevo León · MX" (lo que se sepa) */
export function placeOf(d: Pick<DeviceRow, "city" | "region" | "country">) {
  const parts = [d.city, d.region && d.region !== d.city ? d.region : null].filter(Boolean).join(", ");
  return [parts, d.country].filter(Boolean).join(" · ");
}

/** "hace 3 min", "hace 2 h", "hace 4 días" */
export function agoText(iso: string | null | undefined, now = Date.now()) {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return "—";
  const min = Math.max(0, Math.round((now - at) / 60000));
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

/** ¿Está en uso? (avisa cada 2 min con B-POS abierto; los navegadores frenan las pestañas escondidas) */
export const isOnline = (iso: string | null | undefined, now = Date.now()) => Boolean(iso) && now - Date.parse(iso!) < 6 * 60 * 1000;

type Hooks = {
  deviceId: () => string;
  isPrimary: () => boolean;
  setPrimary: (primary: boolean) => void;
  /** Sube lo pendiente, cierra la sesión de este equipo y vuelve a la pantalla de entrar */
  logout: () => Promise<void>;
};

let started = false;
let pingNow: (() => Promise<PingResult | null>) | null = null;
let active: { businessId: string; branchId: string; deviceId: () => string } | null = null;

/** Negocio, sucursal y número de este equipo (null si no está conectado a la nube) */
export function deviceAccount() {
  return active ? { businessId: active.businessId, branchId: active.branchId, deviceId: active.deviceId() } : null;
}

/** Pregunta ya (después de cambiar la caja principal desde este equipo) */
export function pingDeviceNow() {
  return pingNow ? pingNow() : Promise.resolve(null);
}

export function startDevicePing(acc: ReadyAccount, hooks: Hooks) {
  if (started || typeof window === "undefined") return;
  started = true;
  active = { businessId: acc.businessId, branchId: acc.branchId, deviceId: hooks.deviceId };
  const supabase = getSupabase();
  let busy: Promise<PingResult | null> | null = null;
  let leaving = false;

  const ping = async (): Promise<PingResult | null> => {
    if (leaving || !navigator.onLine) return null;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const nav = navigator as Navigator & { userAgentData?: { platform?: string }; brave?: unknown };
    const caja = (window as unknown as { bposCajaLocal?: { kind?: string } }).bposCajaLocal;
    const { label, kind } = deviceLabel({
      ua: navigator.userAgent,
      platform: nav.userAgentData?.platform,
      cajaKind: caja ? caja.kind || "agent" : null,
      path: window.location.pathname,
      brave: Boolean(nav.brave),
    });
    const { data: res, error } = await supabase.rpc("bpos_device_ping", {
      p_business_id: acc.businessId,
      p_branch_id: acc.branchId,
      p_device_id: hooks.deviceId(),
      p_label: label,
      p_kind: kind,
      p_session_id: sessionIdOf(token),
      p_role: hooks.isPrimary() ? "primary" : "secondary",
    });
    if (error || !res) return null;
    const result = res as PingResult;
    if (result.revoked) {
      leaving = true;
      try {
        window.sessionStorage.setItem(CLOSED_NOTICE_KEY, "1");
      } catch {
        // sin sessionStorage: solo no sale el aviso
      }
      await hooks.logout();
      return result;
    }
    if (result.primary !== hooks.isPrimary()) {
      hooks.setPrimary(result.primary);
      window.dispatchEvent(new Event(PRIMARY_EVENT));
    }
    return result;
  };
  pingNow = () => {
    if (!busy) busy = ping().catch(() => null).finally(() => (busy = null));
    return busy;
  };

  void pingNow();
  setInterval(() => void pingNow?.(), PING_EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void pingNow?.();
  });
  window.addEventListener("online", () => void pingNow?.());
  // El dueño cambió algo en la lista: preguntar al momento
  supabase
    .channel(`devices-${acc.businessId}`)
    .on("broadcast", { event: "check" }, () => {
      void pingNow?.();
      window.dispatchEvent(new Event(DEVICES_EVENT));
    })
    .subscribe();
}

// ------------------------------------------------------------ lo que usa la pantalla Dispositivos

const rpcError = (e: { message?: string } | null) => new Error(e?.message || "No se pudo hablar con la nube.");

export async function listDevices(businessId: string): Promise<DeviceRow[]> {
  const { data, error } = await getSupabase().rpc("bpos_devices_list", { p_business_id: businessId });
  if (error) throw rpcError(error);
  return (data as DeviceRow[]) || [];
}

/** deviceId null = ninguna caja principal en esa sucursal */
export async function setCloudPrimary(businessId: string, branchId: string, deviceId: string | null) {
  const { error } = await getSupabase().rpc("bpos_device_set_primary", { p_business_id: businessId, p_branch_id: branchId, p_device_id: deviceId });
  if (error) throw rpcError(error);
}

export async function renameDevice(businessId: string, deviceId: string, name: string) {
  const { error } = await getSupabase().rpc("bpos_device_rename", { p_business_id: businessId, p_device_id: deviceId, p_name: name });
  if (error) throw rpcError(error);
}

export async function closeDevice(businessId: string, deviceId: string) {
  const { data, error } = await getSupabase().rpc("bpos_device_close", { p_business_id: businessId, p_device_id: deviceId });
  if (error) throw rpcError(error);
  return Number((data as { closed?: number })?.closed) || 0;
}

export async function closeOtherDevices(businessId: string, myDeviceId: string) {
  const { data, error } = await getSupabase().rpc("bpos_device_close", { p_business_id: businessId, p_except_device_id: myDeviceId });
  if (error) throw rpcError(error);
  return Number((data as { closed?: number })?.closed) || 0;
}
