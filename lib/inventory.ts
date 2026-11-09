"use client";

import { type Ingredient } from "@/data/inventory";
import { getAdminIngredients, getAdminProducts, getAdminRecipes, saveAdminIngredients } from "@/lib/admin";
import { itemConsumption, type SoldModifier, type SoldPart } from "@/lib/compound";
import { getCurrentUser } from "@/lib/auth";

const KARDEX_KEY = "bpos_inventory_kardex";
const APPLIED_KEY = "bpos_inventory_applied_sales";
const LOW_STOCK_KEY = "bpos_low_stock_pending";
const SHOPPING_SENT_KEY = "bpos_shopping_list_sent";
const CRITICAL_KEY = "bpos_critical_errors";

export type InventoryMovement = {
  id: string;
  ingredientId: number;
  ingredientName: string;
  unit: Ingredient["unit"];
  /** "Sin registro": no se guarda; lo arma kardexWithGaps donde la existencia cambió sin movimiento */
  type: "Venta POS" | "Venta plataforma" | "Ajuste positivo" | "Ajuste negativo" | "Merma" | "Sin registro";
  quantity: number;
  previousStock: number;
  finalStock: number;
  orderId?: number | string;
  externalOrderKey?: string;
  platform?: string;
  reason?: string;
  /** Merma: lo que costó lo que se tiró (último costo de compra × cantidad), si se conoce */
  cost?: number;
  /** Devolución de lo que se descontó por esa venta (cancelación o corrección de equivalencia) */
  revertOf?: string;
  /** Quién hizo el ajuste a mano (o la compra) */
  userName?: string;
  /** "Sin registro": desde cuándo pudo pasar (el movimiento anterior del insumo) */
  gapSince?: string;
  createdAt: string;
};

export type AdjustmentType = "Ajuste positivo" | "Ajuste negativo" | "Merma";
/** Motivos comunes de merma (se eligen con un toque en Inventario) */
export const MERMA_REASONS = ["Caducó", "Se cayó o derramó", "Error de cocina", "Cortesía", "Mal estado al recibir"];

export type InventoryOrderLike = {
  id: number | string;
  createdAt?: string;
  items: Array<{ id: number; name?: string; quantity: number; parts?: SoldPart[]; modifiers?: SoldModifier[] }>;
  source?: string;
  externalOrderKey?: string;
  externalPlatform?: string;
  bridgeActions?: {
    inventoryAdjustments?: Array<{
      ingredientId: string | number;
      name?: string;
      quantity: number;
      unit?: string;
      sourceType?: string;
      externalName?: string;
    }>;
  };
};

export type InventoryApplicationResult = {
  success: boolean;
  duplicate: boolean;
  movements: InventoryMovement[];
  lowStock: Ingredient[];
  error?: string;
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getInventory(): Ingredient[] {
  return getAdminIngredients();
}

export function getKardex(): InventoryMovement[] {
  return readJson<InventoryMovement[]>(KARDEX_KEY, []);
}

export type CriticalInventoryError = {
  id: string;
  message: string;
  createdAt: string;
  acknowledged: boolean;
  resolved?: boolean;
  code?: "NEGATIVE_STOCK" | "MISSING_INGREDIENT" | "INVENTORY_ERROR" | "TEST";
  ingredientId?: number;
  ingredientName?: string;
  orderId?: number | string;
  externalOrderKey?: string;
  platform?: string;
  previousStock?: number;
  quantity?: number;
  finalStock?: number;
};

export function getCriticalErrors() {
  return readJson<CriticalInventoryError[]>(CRITICAL_KEY, []);
}

export function acknowledgeCriticalErrors() {
  const next = getCriticalErrors().map((item) => ({ ...item, acknowledged: true }));
  writeJson(CRITICAL_KEY, next);
  window.dispatchEvent(new Event("bpos:critical-errors-updated"));
}

export function addCriticalError(
  message: string,
  metadata: Omit<Partial<CriticalInventoryError>, "id" | "message" | "createdAt" | "acknowledged"> = {}
) {
  const errors = getCriticalErrors();
  errors.unshift({
    id: `critical-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    message,
    createdAt: new Date().toISOString(),
    acknowledged: false,
    resolved: false,
    code: metadata.code || "INVENTORY_ERROR",
    ...metadata,
  });
  writeJson(CRITICAL_KEY, errors.slice(0, 100));
  window.dispatchEvent(new Event("bpos:critical-errors-updated"));
}

export function createCriticalErrorTest() {
  addCriticalError(
    "Prueba controlada: el Centro de Operaciones recibió una incidencia crítica.",
    { code: "TEST" }
  );
}

/**
 * Clave para no descontar dos veces la misma venta. Los pedidos de delivery
 * llevan también el id de la venta: DiDi reinicia sus números cada día y con
 * solo "didi:16" el DiDi #16 de hoy se tomaba como el de ayer (no descontaba).
 */
function applicationKey(order: InventoryOrderLike) {
  return order.externalOrderKey ? `${order.externalOrderKey}@${order.id}` : `order:${order.id}`;
}

/** Hasta aquí los pedidos de delivery se marcaban solo con "plataforma:número" */
const LEGACY_KEY_UNTIL = Date.parse("2026-11-05T11:30:00.000Z");

function isApplied(applied: Set<string>, order: InventoryOrderLike) {
  if (applied.has(applicationKey(order))) return true;
  if (!order.externalOrderKey || !applied.has(order.externalOrderKey)) return false;
  const at = Date.parse(order.createdAt || "");
  if (!Number.isFinite(at) || at < LEGACY_KEY_UNTIL) return true;
  // Una caja con la versión anterior abierta marca solo "plataforma:número": si ya hay
  // descuento de esta venta en la bitácora, no se vuelve a descontar
  return getKardex().some((m) => (m.type === "Venta plataforma" || m.type === "Venta POS") && String(m.orderId) === String(order.id));
}

/** Falta: tiene mínimo configurado y está en él o abajo (sin mínimo, nunca cuenta como faltante) */
export const isLowStock = (item: Pick<Ingredient, "stock" | "minimum">) => Number(item.minimum) > 0 && Number(item.stock) <= Number(item.minimum);

/** Lo que bajó al mínimo en el turno y sigue abajo (si ya se compró o se ajustó, sale de la lista) */
export function getPendingLowStock(): Ingredient[] {
  const ids = readJson<number[]>(LOW_STOCK_KEY, []);
  const inventory = getInventory();
  return ids.map((id) => inventory.find((item) => item.id === id)).filter((item): item is Ingredient => Boolean(item) && isLowStock(item!));
}

function updateLowStockPending(inventory: Ingredient[]) {
  const existing = new Set(readJson<number[]>(LOW_STOCK_KEY, []));
  inventory.filter(isLowStock).forEach((item) => existing.add(item.id));
  writeJson(LOW_STOCK_KEY, [...existing]);
  window.dispatchEvent(new Event("bpos:inventory-alerts-updated"));
}

export type ShoppingListSentRecord = {
  shiftOpenedAt: string;
  sentAt: string;
  sentBy?: string;
  phone?: string;
  items?: string[];
};

export function getShoppingListSentRecord() {
  return readJson<ShoppingListSentRecord | null>(SHOPPING_SENT_KEY, null);
}

export function shoppingListWasSentForShift(openedAt?: string | null) {
  if (!openedAt) return false;
  const record = getShoppingListSentRecord();
  return record?.shiftOpenedAt === openedAt && Boolean(record.sentAt);
}

export function markShoppingListSent(
  shiftOpenedAt: string,
  metadata: { sentBy?: string; phone?: string; items?: string[] } = {}
) {
  const record: ShoppingListSentRecord = {
    shiftOpenedAt,
    sentAt: new Date().toISOString(),
    ...metadata,
  };
  writeJson(SHOPPING_SENT_KEY, record);
  window.dispatchEvent(new Event("bpos:inventory-alerts-updated"));
  return record;
}

export function clearLowStockAfterShiftClose() {
  writeJson(LOW_STOCK_KEY, []);
  localStorage.removeItem(SHOPPING_SENT_KEY);
  window.dispatchEvent(new Event("bpos:inventory-alerts-updated"));
}

export function buildShoppingListMessage() {
  const items = getPendingLowStock();
  const lines = items.length
    ? items.map((item) => `• ${item.name}: ${item.stock} ${item.unit} (mínimo ${item.minimum} ${item.unit})`).join("\n")
    : "Sin faltantes registrados.";
  return `📦 *B-POS · LISTA DE FALTANTES*\n\n${lines}\n\n🕒 ${new Date().toLocaleString()}`;
}

/**
 * Marca una venta como ya descontada sin tocar el inventario: para la parte
 * de una cuenta dividida por productos (sus ingredientes ya se descontaron
 * cuando se mandó a cocina la cuenta original).
 */
export function markInventoryApplied(orderId: number | string) {
  if (typeof window === "undefined") return;
  const applied = new Set(readJson<string[]>(APPLIED_KEY, []));
  applied.add(`order:${orderId}`);
  writeJson(APPLIED_KEY, Array.from(applied));
}

/** Lo que descuenta una venta: receta (y partes de combo), empaque del producto vendido y ajustes del Bridge */
function orderConsumption(order: InventoryOrderLike) {
  const recipeList = getAdminRecipes();
  const consumptions = new Map<number, number>();
  const recipeOf = (productId: number) => recipeList.filter((recipe) => Number(recipe.productId) === Number(productId));
  const packagingOf = new Map(getAdminProducts().map((p) => [Number(p.id), p.packaging || []]));
  for (const item of order.items || []) {
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Cantidad inválida en producto ${item.name || item.id}.`);
    // Receta propia + la de cada parte si es combo
    itemConsumption({ ...item, quantity: qty }, recipeOf).forEach((amount, ingredientId) => {
      consumptions.set(ingredientId, (consumptions.get(ingredientId) || 0) + amount);
    });
    // Empaque: solo el del producto vendido (no el de las partes del combo)
    for (const p of packagingOf.get(Number(item.id)) || []) {
      const amount = (Number(p.quantity) || 0) * qty;
      if (amount > 0) consumptions.set(Number(p.ingredientId), (consumptions.get(Number(p.ingredientId)) || 0) + amount);
    }
  }
  for (const adjustment of order.bridgeActions?.inventoryAdjustments || []) {
    const id = Number(adjustment.ingredientId);
    const qty = Number(adjustment.quantity);
    if (!Number.isFinite(id) || !Number.isFinite(qty) || qty <= 0) throw new Error(`Ajuste de inventario inválido: ${adjustment.name || adjustment.ingredientId}.`);
    consumptions.set(id, (consumptions.get(id) || 0) + qty);
  }
  return consumptions;
}

export function applyInventoryForOrder(order: InventoryOrderLike): InventoryApplicationResult {
  if (typeof window === "undefined") return { success: false, duplicate: false, movements: [], lowStock: [], error: "Disponible solo en navegador." };
  const key = applicationKey(order);
  const applied = new Set(readJson<string[]>(APPLIED_KEY, []));
  if (isApplied(applied, order)) return { success: true, duplicate: true, movements: [], lowStock: getPendingLowStock() };

  try {
    const inventory = structuredClone(getInventory());
    const now = new Date().toISOString();
    const movements: InventoryMovement[] = [];
    for (const [ingredientId, quantity] of orderConsumption(order)) {
      const ingredient = inventory.find((item) => Number(item.id) === ingredientId);
      if (!ingredient) throw new Error(`El ingrediente ${ingredientId} no existe.`);
      const previousStock = Number(ingredient.stock);
      ingredient.stock = round(previousStock - quantity); // sin colas de decimales (7.3359999…)
      movements.push({
        id: `mov-${Date.now()}-${ingredientId}-${Math.random().toString(36).slice(2, 7)}`,
        ingredientId,
        ingredientName: ingredient.name,
        unit: ingredient.unit,
        type: order.externalOrderKey ? "Venta plataforma" : "Venta POS",
        quantity,
        previousStock,
        finalStock: ingredient.stock,
        orderId: order.id,
        externalOrderKey: order.externalOrderKey,
        platform: order.externalPlatform,
        reason: order.externalOrderKey ? `Pedido ${order.externalOrderKey}` : `Venta #${order.id}`,
        createdAt: now,
      });
      if (ingredient.stock < 0) {
        const missingAmount = Math.abs(ingredient.stock);
        addCriticalError(
          `${ingredient.name} quedó en inventario negativo: faltan ${missingAmount} ${ingredient.unit}. La venta continuó y quedó registrada.`,
          {
            code: "NEGATIVE_STOCK",
            ingredientId,
            ingredientName: ingredient.name,
            orderId: order.id,
            externalOrderKey: order.externalOrderKey,
            platform: order.externalPlatform,
            previousStock,
            quantity,
            finalStock: ingredient.stock,
          }
        );
      }
    }

    saveAdminIngredients(inventory);
    writeJson(KARDEX_KEY, [...getKardex(), ...movements]);
    applied.add(key);
    writeJson(APPLIED_KEY, [...applied]);
    updateLowStockPending(inventory);
    window.dispatchEvent(new CustomEvent("bpos:inventory-updated", { detail: { orderId: order.id, movements } }));
    return { success: true, duplicate: false, movements, lowStock: inventory.filter(isLowStock) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar inventario.";
    addCriticalError(message, {
      code: message.includes("no existe") ? "MISSING_INGREDIENT" : "INVENTORY_ERROR",
      orderId: order.id,
      externalOrderKey: order.externalOrderKey,
      platform: order.externalPlatform,
    });
    return { success: false, duplicate: false, movements: [], lowStock: getPendingLowStock(), error: message };
  }
}

/**
 * Compatibilidad con el flujo actual del POS.
 * Convierte el ID y los artículos de la venta al formato único del motor
 * de inventario del Bloque 4.
 */
export function discountInventoryByOrder(
  orderId: number | string,
  items: Array<{ id: number; name?: string; quantity: number; parts?: SoldPart[]; modifiers?: SoldModifier[] }>
): InventoryApplicationResult {
  return applyInventoryForOrder({
    id: orderId,
    items,
    source: "POS",
  });
}

// ---------------------------------------------------------------- devolver lo de una venta

const SALE_TYPES = new Set<InventoryMovement["type"]>(["Venta POS", "Venta plataforma"]);
const round = (n: number) => Math.round(n * 10000) / 10000;

/** ¿Ya se descontó el inventario de esta venta? (se descuenta pocos segundos después de cobrar) */
export function inventoryWasApplied(order: InventoryOrderLike) {
  return isApplied(new Set(readJson<string[]>(APPLIED_KEY, [])), order);
}

/**
 * Lo que sigue descontado por esa venta, por ingrediente: lo que se descontó
 * (según la bitácora de inventario, no la receta de hoy) menos lo que ya se devolvió.
 */
export function orderNetConsumption(orderId: number | string) {
  const id = String(orderId);
  const net = new Map<number, number>();
  // Las rondas de una mesa se descuentan como "<id>-r2", "<id>-r3"…
  const ofOrder = (orderOf: unknown) => String(orderOf) === id || String(orderOf).startsWith(`${id}-r`);
  for (const m of getKardex()) {
    const ingredientId = Number(m.ingredientId);
    if (SALE_TYPES.has(m.type) && ofOrder(m.orderId)) net.set(ingredientId, (net.get(ingredientId) || 0) + Number(m.quantity));
    else if (m.revertOf === id) net.set(ingredientId, (net.get(ingredientId) || 0) - Number(m.quantity));
  }
  for (const [ingredientId, qty] of net) if (round(qty) <= 0) net.delete(ingredientId);
  return net;
}

/** Último costo por unidad (Compras o "Puesto a mano"); 0 si no se conoce */
function latestUnitCost(ingredientId: number) {
  const records = readJson<{ ingredientId: number; purchasedAt: string; unitCost: number }[]>("bpos_ingredient_cost_history", []);
  const last = records.filter((r) => Number(r.ingredientId) === ingredientId).sort((a, b) => +new Date(b.purchasedAt) - +new Date(a.purchasedAt))[0];
  return Number(last?.unitCost) || 0;
}

/** Suma (+) o resta (−) al inventario y lo anota en la bitácora */
function moveStock(inventory: Ingredient[], ingredientId: number, delta: number, base: Omit<InventoryMovement, "id" | "ingredientId" | "ingredientName" | "unit" | "quantity" | "previousStock" | "finalStock" | "createdAt">): InventoryMovement | null {
  const ingredient = inventory.find((item) => Number(item.id) === ingredientId);
  if (!ingredient) return null; // se borró el ingrediente: no hay a dónde regresarlo
  const previousStock = Number(ingredient.stock);
  ingredient.stock = round(previousStock + delta);
  return {
    id: `mov-${Date.now()}-${ingredientId}-${Math.random().toString(36).slice(2, 7)}`,
    ingredientId,
    ingredientName: ingredient.name,
    unit: ingredient.unit,
    quantity: round(Math.abs(delta)),
    previousStock,
    finalStock: ingredient.stock,
    createdAt: new Date().toISOString(),
    ...base,
  };
}

function saveMovements(inventory: Ingredient[], movements: InventoryMovement[], orderId: number | string) {
  saveAdminIngredients(inventory);
  writeJson(KARDEX_KEY, [...getKardex(), ...movements]);
  updateLowStockPending(inventory);
  window.dispatchEvent(new CustomEvent("bpos:inventory-updated", { detail: { orderId, movements } }));
}

/**
 * Venta cancelada o devuelta:
 *   "regresar": no se preparó → lo que se descontó regresa al inventario.
 *   "merma": ya se preparó y se tiró → regresa y sale como merma (con su costo),
 *            así el inventario queda igual pero se ve en Mermas y en el food cost.
 * Si todavía no se descontaba, con "regresar" ya no se descuenta.
 */
export function revertInventoryForOrder(order: InventoryOrderLike, mode: "regresar" | "merma", reason: string) {
  if (typeof window === "undefined") return { returned: 0, merma: 0 };
  if (!inventoryWasApplied(order)) {
    if (mode === "regresar") {
      const applied = new Set(readJson<string[]>(APPLIED_KEY, []));
      applied.add(applicationKey(order));
      writeJson(APPLIED_KEY, [...applied]);
      return { returned: 0, merma: 0 };
    }
    applyInventoryForOrder(order); // ya se preparó: sí se gastó
  }
  const inventory = structuredClone(getInventory());
  const id = String(order.id);
  const movements: InventoryMovement[] = [];
  let merma = 0;
  for (const [ingredientId, qty] of orderNetConsumption(id)) {
    const back = moveStock(inventory, ingredientId, qty, { type: "Ajuste positivo", revertOf: id, platform: order.externalPlatform, reason: `Devolución de la venta #${id}: ${reason}` });
    if (!back) continue;
    movements.push(back);
    if (mode === "merma") {
      const cost = Math.round(latestUnitCost(ingredientId) * qty * 100) / 100;
      merma += cost;
      const out = moveStock(inventory, ingredientId, -qty, { type: "Merma", platform: order.externalPlatform, reason: `Venta #${id} cancelada, ya se había preparado: ${reason}`, ...(cost ? { cost } : {}) });
      if (out) movements.push(out);
    }
  }
  if (movements.length) saveMovements(inventory, movements, order.id);
  return { returned: movements.filter((m) => m.type === "Ajuste positivo").length, merma };
}

/**
 * Se corrigieron los productos de una venta (ej. una equivalencia mal hecha en
 * el Bridge): regresa lo que se descontó y descuenta lo de los productos nuevos.
 * Si todavía no se descontaba, no hace nada (se descontará con los nuevos).
 */
export function correctInventoryForOrder(order: InventoryOrderLike, reason: string, wasted: InventoryOrderLike["items"] = []) {
  if (typeof window === "undefined" || !inventoryWasApplied(order)) return { corrected: false };
  const inventory = structuredClone(getInventory());
  const id = String(order.id);
  const movements: InventoryMovement[] = [];
  for (const [ingredientId, qty] of orderNetConsumption(id)) {
    const back = moveStock(inventory, ingredientId, qty, { type: "Ajuste positivo", revertOf: id, platform: order.externalPlatform, reason: `Corrección de la venta #${id}: ${reason}` });
    if (back) movements.push(back);
  }
  for (const [ingredientId, qty] of orderConsumption(order)) {
    const out = moveStock(inventory, ingredientId, -qty, {
      type: order.externalOrderKey ? "Venta plataforma" : "Venta POS",
      orderId: order.id,
      externalOrderKey: order.externalOrderKey,
      platform: order.externalPlatform,
      reason: `Corrección de la venta #${id}: ${reason}`,
    });
    if (!out) throw new Error(`El ingrediente ${ingredientId} no existe.`);
    movements.push(out);
  }
  // Lo que se quitó de la cuenta pero ya se había preparado: merma con su costo
  if (wasted.length) {
    for (const [ingredientId, qty] of orderConsumption({ id: order.id, items: wasted })) {
      const cost = Math.round(latestUnitCost(ingredientId) * qty * 100) / 100;
      const out = moveStock(inventory, ingredientId, -qty, { type: "Merma", platform: order.externalPlatform, reason: `Venta #${id}, ya se había preparado: ${reason}`, ...(cost ? { cost } : {}) });
      if (out) movements.push(out);
    }
  }
  saveMovements(inventory, movements, order.id);
  return { corrected: true };
}

export function processUnappliedOrders(): InventoryApplicationResult[] {
  const orders = readJson<InventoryOrderLike[]>("bpos_orders", []);
  return orders.map(applyInventoryForOrder);
}

export function adjustInventory(input: { ingredientId: number; quantity: number; adjustmentType: AdjustmentType; reason: string; cost?: number }) {
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Captura una cantidad válida.");
  if (!input.reason.trim()) throw new Error("El motivo es obligatorio.");
  const inventory = structuredClone(getInventory());
  const ingredient = inventory.find((item) => Number(item.id) === Number(input.ingredientId));
  if (!ingredient) throw new Error("Ingrediente no encontrado.");
  const previousStock = ingredient.stock;
  ingredient.stock = round(input.adjustmentType === "Ajuste positivo" ? previousStock + quantity : previousStock - quantity); // negativo y merma restan
  saveAdminIngredients(inventory);
  const movement: InventoryMovement = {
    id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    unit: ingredient.unit,
    type: input.adjustmentType,
    quantity,
    previousStock,
    finalStock: ingredient.stock,
    reason: input.reason,
    ...(input.adjustmentType === "Merma" && input.cost !== undefined ? { cost: Math.round(input.cost * 100) / 100 } : {}),
    ...userStamp(),
    createdAt: new Date().toISOString(),
  };
  writeJson(KARDEX_KEY, [...getKardex(), movement]);
  updateLowStockPending(inventory);
  window.dispatchEvent(new Event("bpos:inventory-updated"));
  return movement;
}

/**
 * El Kardex en orden de fecha con los huecos a la vista: si un movimiento
 * empieza en una existencia distinta a la que dejó el anterior del mismo
 * insumo (o el primero no empieza en 0), la existencia cambió sin dejar
 * movimiento (por ejemplo, escrita en la ficha antes de que eso se
 * registrara). Ese cambio sale como "Sin registro", entre las dos fechas.
 */
export function kardexWithGaps(kardex: InventoryMovement[]): InventoryMovement[] {
  const sorted = kardex.map((m, i) => [m, i] as const).sort((a, b) => Date.parse(a[0].createdAt) - Date.parse(b[0].createdAt) || a[1] - b[1]).map(([m]) => m);
  const last = new Map<number, InventoryMovement>();
  const out: InventoryMovement[] = [];
  for (const m of sorted) {
    const before = last.get(Number(m.ingredientId));
    const from = before ? Number(before.finalStock) : 0;
    const to = Number(m.previousStock);
    if (Number.isFinite(from) && Number.isFinite(to) && Math.abs(to - from) > 0.0005) {
      const diff = Math.round((to - from) * 1e6) / 1e6;
      out.push({
        id: `gap-${m.id}-${m.ingredientId}`,
        ingredientId: m.ingredientId,
        ingredientName: m.ingredientName,
        unit: m.unit,
        type: "Sin registro",
        quantity: Math.abs(diff),
        previousStock: from,
        finalStock: to,
        reason: before ? "La existencia cambió sin movimiento (escrita a mano en la ficha o de otro equipo)" : "Existencia con la que se dio de alta o se escribió en la ficha (sin movimiento)",
        createdAt: m.createdAt,
        ...(before ? { gapSince: before.createdAt } : {}),
      });
    }
    out.push(m);
    last.set(Number(m.ingredientId), m);
  }
  return out;
}

function userStamp() {
  const user = getCurrentUser();
  return user.id ? { userName: user.name } : {};
}

/**
 * La existencia se cambió escribiéndola en la ficha del insumo (ya guardada):
 * queda en el Kardex como ajuste por la diferencia, con quién y por qué.
 */
export function recordStockEdit(ingredient: Pick<Ingredient, "id" | "name" | "unit" | "stock">, previousStock: number, reason: string) {
  const diff = Math.round((ingredient.stock - previousStock) * 1e6) / 1e6;
  if (!diff) return null;
  const movement: InventoryMovement = {
    id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    unit: ingredient.unit,
    type: diff > 0 ? "Ajuste positivo" : "Ajuste negativo",
    quantity: Math.abs(diff),
    previousStock,
    finalStock: ingredient.stock,
    reason: `Cambio en la ficha: ${reason}`,
    ...userStamp(),
    createdAt: new Date().toISOString(),
  };
  writeJson(KARDEX_KEY, [...getKardex(), movement]);
  updateLowStockPending(getInventory());
  window.dispatchEvent(new Event("bpos:inventory-updated"));
  return movement;
}

/** Las compras se guardan como ajuste positivo con el folio en el motivo ("C-000012 · Proveedor") */
export const isPurchase = (m: InventoryMovement) => m.type === "Ajuste positivo" && /^C-\d{3,}/.test(m.reason || "");

/** Cómo se llama el movimiento en el kardex */
export function movementLabel(m: InventoryMovement) {
  if (isPurchase(m)) return "Compra";
  if (m.revertOf) return "Devolución de venta";
  return m.type;
}
