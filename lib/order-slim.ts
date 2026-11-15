/**
 * Las ventas guardaban en cada renglón una copia COMPLETA del producto (sus
 * grupos de opciones, foto, descripción, horario...). Con semanas de ventas
 * eso llenaba la memoria del navegador (~5 MB) y la caja dejaba de cerrar
 * ventas e iniciar sesión ("exceeded the quota").
 *
 * En una venta ya cobrada o cancelada esos datos no se usan (lo vendido queda
 * en `parts` y `modifiers`), así que se quitan. Las cuentas abiertas (mesas,
 * en espera) se quedan completas porque se pueden seguir editando.
 */

/** Datos del catálogo que no hacen falta en una venta ya cerrada */
export const HEAVY_ITEM_FIELDS = ["modifierGroups", "description", "image", "saleSchedule", "components", "fromBridge"] as const;

type AnyOrder = { pendingPayment?: boolean; items?: unknown } & Record<string, unknown>;

function slimItem(item: unknown): { item: unknown; changed: boolean } {
  if (!item || typeof item !== "object" || Array.isArray(item)) return { item, changed: false };
  const src = item as Record<string, unknown>;
  if (!HEAVY_ITEM_FIELDS.some((f) => f in src)) return { item, changed: false };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) if (!(HEAVY_ITEM_FIELDS as readonly string[]).includes(k)) out[k] = v;
  return { item: out, changed: true };
}

/** Quita lo pesado de los renglones de las ventas cerradas. Regresa null si no hubo nada que quitar. */
export function slimOrders(list: unknown): unknown[] | null {
  if (!Array.isArray(list)) return null;
  let changed = false;
  const out = list.map((order) => {
    if (!order || typeof order !== "object") return order;
    const o = order as AnyOrder;
    if (o.pendingPayment || !Array.isArray(o.items)) return order;
    let itemsChanged = false;
    const items = o.items.map((it) => {
      const r = slimItem(it);
      if (r.changed) itemsChanged = true;
      return r.item;
    });
    if (!itemsChanged) return order;
    changed = true;
    return { ...o, items };
  });
  return changed ? out : null;
}

/** Igual que slimOrders pero con el texto guardado; regresa el mismo texto si no cambió */
export function slimOrdersText(raw: string): string {
  if (!raw || raw.length < 2 || raw[0] !== "[") return raw;
  try {
    const slim = slimOrders(JSON.parse(raw));
    return slim ? JSON.stringify(slim) : raw;
  } catch {
    return raw;
  }
}

export function isQuotaError(e: unknown) {
  return e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22 || /quota/i.test(e.message));
}
