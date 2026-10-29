"use client";

import type { KitchenStation } from "@/data/products";

export const KDS_STATION_CONFIG_KEY = "bpos_kds_station_config";

export type KdsStationConfig = {
  id: KitchenStation;
  name: string;
  enabled: boolean;
};

export const DEFAULT_KDS_STATIONS: KdsStationConfig[] = [
  { id: "Parrilla", name: "Parrilla", enabled: true },
  { id: "Freidora", name: "Freidora", enabled: true },
  { id: "Barra", name: "Barra", enabled: true },
  { id: "Cocina", name: "Cocina", enabled: true },
];

export function readKdsStationConfig(): KdsStationConfig[] {
  if (typeof window === "undefined") return DEFAULT_KDS_STATIONS;

  try {
    const raw = localStorage.getItem(KDS_STATION_CONFIG_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return DEFAULT_KDS_STATIONS;

    return DEFAULT_KDS_STATIONS.map((fallback) => {
      const current = parsed.find((item) => item?.id === fallback.id);
      return {
        id: fallback.id,
        name: String(current?.name || fallback.name).trim() || fallback.name,
        enabled: current?.enabled !== false,
      };
    });
  } catch {
    return DEFAULT_KDS_STATIONS;
  }
}

export function saveKdsStationConfig(config: KdsStationConfig[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KDS_STATION_CONFIG_KEY, JSON.stringify(config));
  window.dispatchEvent(new Event("bpos:kds-config-updated"));
}

/** Nombre que el negocio le puso a la estación (Cocina KDS → configurar estaciones). */
export function stationLabel(id: KitchenStation) {
  return readKdsStationConfig().find((s) => s.id === id)?.name || id;
}
