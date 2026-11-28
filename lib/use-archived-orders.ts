"use client";
/**
 * Ventas que ya no están en la memoria de la caja (de hace más de 10 días):
 * se piden a la nube solo cuando la pantalla consulta esas fechas. Se
 * guardan un rato en memoria para no volver a bajarlas a cada cambio.
 */
import { useEffect, useState } from "react";
import { archivedPart, localOrdersCutoff } from "@/lib/order-archive";
import { fetchCloudOrders } from "@/lib/cloud/sync";
import { isCloudConfigured } from "@/lib/supabase/client";

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; orders: unknown[] }>();

export type ArchivedOrders = { orders: unknown[]; loading: boolean; error: string; active: boolean };

const EMPTY: unknown[] = [];

function fresh(key: string) {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < CACHE_MS ? hit : null;
}

export function useArchivedOrders(from: Date | null | undefined, to?: Date | null): ArchivedOrders {
  const part = isCloudConfigured ? archivedPart(from, to ?? null, localOrdersCutoff()) : null;
  const key = part ? `${part.from.getTime()}-${part.to.getTime()}` : "";
  const [result, setResult] = useState<{ key: string; orders: unknown[]; error: string }>({ key: "", orders: EMPTY, error: "" });

  useEffect(() => {
    if (!key || !part || fresh(key)) return;
    let alive = true;
    fetchCloudOrders(part.from, part.to)
      .then((orders) => {
        cache.set(key, { at: Date.now(), orders });
        if (alive) setResult({ key, orders, error: "" });
      })
      .catch((e) => {
        if (alive) setResult({ key, orders: EMPTY, error: e instanceof Error ? e.message : "No se pudo consultar la nube." });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` resume el rango
  }, [key]);

  if (!key) return { orders: EMPTY, loading: false, error: "", active: false };
  const hit = fresh(key);
  if (hit) return { orders: hit.orders, loading: false, error: "", active: true };
  if (result.key === key) return { orders: result.orders, loading: false, error: result.error, active: true };
  return { orders: EMPTY, loading: true, error: "", active: true };
}

/** Aviso para mostrar arriba de la pantalla mientras se consulta o si falló */
export function archivedNotice(a: ArchivedOrders) {
  if (!a.active) return "";
  if (a.loading) return "☁️ Consultando en la nube las ventas de hace más de 10 días…";
  if (a.error) return `⚠️ No se pudieron traer de la nube las ventas de hace más de 10 días: ${a.error}`;
  return "";
}
