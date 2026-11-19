"use client";
/**
 * Tipo de negocio: restaurante, tienda (abarrotes, minisúper) o ferretería.
 * Se elige al crear la cuenta y se cambia en Configuración → Empresa.
 *
 * La tienda y la ferretería usan lo mismo que el restaurante (POS, caja,
 * inventario, compras, productividad, menú digital, club) pero sin lo de
 * cocina: mesas, meseros, comandas, recetas, food cost, opciones de los
 * productos. Sus artículos llevan código de barras, se venden por pieza o a
 * granel y cada uno es su propio inventario (lib/retail.ts).
 */
import { useEffect, useState } from "react";

export type BusinessType = "restaurante" | "tienda" | "ferreteria";

export const BUSINESS_TYPES: { id: BusinessType; label: string; icon: string; description: string }[] = [
  { id: "restaurante", label: "Restaurante", icon: "🍔", description: "Comida, cocina, mesas, comandas y repartos." },
  { id: "tienda", label: "Tienda", icon: "🛒", description: "Abarrotes, minisúper, carnicería, papelería: artículos con código de barras." },
  { id: "ferreteria", label: "Ferretería", icon: "🔩", description: "Tornillería, material y herramienta: por pieza, metro, kilo o litro." },
];

const SETTINGS_KEY = "bpos_business_settings";

export function normalizeBusinessType(value: unknown): BusinessType {
  return value === "tienda" || value === "ferreteria" ? value : "restaurante";
}

/** El tipo de este negocio (sin dato = restaurante, como todos los que ya existían) */
export function getBusinessType(): BusinessType {
  if (typeof window === "undefined") return "restaurante";
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return normalizeBusinessType(raw ? (JSON.parse(raw) as { businessType?: unknown }).businessType : undefined);
  } catch {
    return "restaurante";
  }
}

/** Tienda o ferretería: artículos con código de barras e inventario propio */
export const isRetailType = (type: BusinessType) => type !== "restaurante";
export const isRetail = () => isRetailType(getBusinessType());

/** Pantallas que solo tienen sentido en un restaurante */
const RESTAURANT_ONLY = [
  "/cocina",
  "/kds",
  "/personal",
  "/meseros",
  "/bridge",
  "/impresiones",
  "/configuracion/mesas",
  "/configuracion/meseros",
  "/configuracion/personal",
  "/configuracion/kds",
  "/configuracion/recetas",
  "/configuracion/packaging",
  "/configuracion/ingredientes",
  "/configuracion/delivery-equivalencias",
  "/configuracion/menu-ia",
  "/configuracion/pos",
];

/** Pantallas que solo tienen sentido en una tienda o ferretería */
const RETAIL_ONLY = ["/caja/fiado", "/inventario/pedido"];

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** ¿Esta pantalla se esconde para este tipo de negocio? */
export function hiddenForType(path: string, type: BusinessType = getBusinessType()) {
  if (!isRetailType(type)) return RETAIL_ONLY.some((base) => under(path, base));
  return RESTAURANT_ONLY.some((base) => under(path, base));
}

export const BUSINESS_TYPE_EVENT = "bpos:business-settings-updated";

/** El tipo de negocio, al día cuando se cambia aquí o en otro equipo */
export function useBusinessType(): BusinessType {
  const [type, setType] = useState<BusinessType>("restaurante");
  useEffect(() => {
    const sync = () => setType(getBusinessType());
    sync();
    window.addEventListener(BUSINESS_TYPE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(BUSINESS_TYPE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return type;
}

/** Palabras que cambian según el giro */
export function wordsFor(type: BusinessType) {
  const retail = isRetailType(type);
  return {
    product: retail ? "artículo" : "producto",
    products: retail ? "Artículos" : "Productos",
    productsIcon: type === "ferreteria" ? "🔩" : retail ? "🏷️" : "🍔",
  };
}
