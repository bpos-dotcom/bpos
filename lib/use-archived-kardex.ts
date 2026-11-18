"use client";
/**
 * Kardex que ya no está en la memoria de la caja (más viejo que los últimos
 * días, ver lib/kardex-archive.ts): se pide a la nube solo cuando la
 * pantalla consulta esas fechas, y se guarda un rato para no volver a bajarlo.
 */
import { useEffect, useState } from "react";
import { archivedKardexPart, localKardexCutoff } from "@/lib/kardex-archive";
import { fetchCloudKardex } from "@/lib/cloud/sync";
import { isCloudConfigured } from "@/lib/supabase/client";

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; rows: unknown[] }>();
const EMPTY: unknown[] = [];

export type ArchivedKardex = { rows: unknown[]; loading: boolean; error: string; active: boolean };

function fresh(key: string) {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < CACHE_MS ? hit : null;
}

export function useArchivedKardex(from: Date | null | undefined, to?: Date | null): ArchivedKardex {
  const part = isCloudConfigured ? archivedKardexPart(from, to ?? null, localKardexCutoff()) : null;
  const key = part ? `${part.from.getTime()}-${part.to.getTime()}` : "";
  const [result, setResult] = useState<{ key: string; rows: unknown[]; error: string }>({ key: "", rows: EMPTY, error: "" });

  useEffect(() => {
    if (!key || !part || fresh(key)) return;
    let alive = true;
    fetchCloudKardex(part.from, part.to)
      .then((rows) => {
        cache.set(key, { at: Date.now(), rows });
        if (alive) setResult({ key, rows, error: "" });
      })
      .catch((e) => {
        if (alive) setResult({ key, rows: EMPTY, error: e instanceof Error ? e.message : "No se pudo consultar la nube." });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` resume el rango
  }, [key]);

  if (!key) return { rows: EMPTY, loading: false, error: "", active: false };
  const hit = fresh(key);
  if (hit) return { rows: hit.rows, loading: false, error: "", active: true };
  if (result.key === key) return { rows: result.rows, loading: false, error: result.error, active: true };
  return { rows: EMPTY, loading: true, error: "", active: true };
}

export function archivedKardexNotice(a: ArchivedKardex) {
  if (!a.active) return "";
  if (a.loading) return "☁️ Consultando en la nube los movimientos de inventario anteriores…";
  if (a.error) return `⚠️ No se pudieron traer de la nube los movimientos de inventario anteriores: ${a.error}`;
  return "";
}
