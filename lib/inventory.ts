"use client";

import { initialIngredients, recipes, type Ingredient } from "@/data/inventory";
import { getAdminIngredients, getAdminRecipes, saveAdminIngredients } from "@/lib/admin";
import { itemConsumption, type SoldModifier, type SoldPart } from "@/lib/compound";

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
  type: "Venta POS" | "Venta plataforma" | "Ajuste positivo" | "Ajuste negativo";
  quantity: number;
  previousStock: number;
  finalStock: number;
  orderId?: number | string;
  externalOrderKey?: string;
  platform?: string;
  reason?: string;
  createdAt: string;
};

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

function applicationKey(order: InventoryOrderLike) {
  return order.externalOrderKey || `order:${order.id}`;
}

export function getPendingLowStock(): Ingredient[] {
  const ids = readJson<number[]>(LOW_STOCK_KEY, []);
  const inventory = getInventory();
  return ids.map((id) => inventory.find((item) => item.id === id)).filter(Boolean) as Ingredient[];
}

function updateLowStockPending(inventory: Ingredient[]) {
  const existing = new Set(readJson<number[]>(LOW_STOCK_KEY, []));
  inventory.filter((item) => item.stock <= item.minimum).forEach((item) => existing.add(item.id));
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

export function applyInventoryForOrder(order: InventoryOrderLike): InventoryApplicationResult {
  if (typeof window === "undefined") return { success: false, duplicate: false, movements: [], lowStock: [], error: "Disponible solo en navegador." };
  const key = applicationKey(order);
  const applied = new Set(readJson<string[]>(APPLIED_KEY, []));
  if (applied.has(key)) return { success: true, duplicate: true, movements: [], lowStock: getPendingLowStock() };

  try {
    const inventory = structuredClone(getInventory());
    const recipeList = getAdminRecipes();
    const consumptions = new Map<number, number>();

    const recipeOf = (productId: number) => recipeList.filter((recipe) => Number(recipe.productId) === Number(productId));
    for (const item of order.items || []) {
      const qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Cantidad inválida en producto ${item.name || item.id}.`);
      // Receta propia + la de cada parte si es combo
      itemConsumption({ ...item, quantity: qty }, recipeOf).forEach((amount, ingredientId) => {
        consumptions.set(ingredientId, (consumptions.get(ingredientId) || 0) + amount);
      });
    }

    for (const adjustment of order.bridgeActions?.inventoryAdjustments || []) {
      const id = Number(adjustment.ingredientId);
      const qty = Number(adjustment.quantity);
      if (!Number.isFinite(id) || !Number.isFinite(qty) || qty <= 0) throw new Error(`Ajuste de inventario inválido: ${adjustment.name || adjustment.ingredientId}.`);
      consumptions.set(id, (consumptions.get(id) || 0) + qty);
    }

    const now = new Date().toISOString();
    const movements: InventoryMovement[] = [];
    for (const [ingredientId, quantity] of consumptions) {
      const ingredient = inventory.find((item) => Number(item.id) === ingredientId);
      if (!ingredient) throw new Error(`El ingrediente ${ingredientId} no existe.`);
      const previousStock = Number(ingredient.stock);
      ingredient.stock = previousStock - quantity;
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
    return { success: true, duplicate: false, movements, lowStock: inventory.filter((item) => item.stock <= item.minimum) };
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

export function processUnappliedOrders(): InventoryApplicationResult[] {
  const orders = readJson<InventoryOrderLike[]>("bpos_orders", []);
  return orders.map(applyInventoryForOrder);
}

export function adjustInventory(input: { ingredientId: number; quantity: number; adjustmentType: "Ajuste positivo" | "Ajuste negativo"; reason: string }) {
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Captura una cantidad válida.");
  if (!input.reason.trim()) throw new Error("El motivo es obligatorio.");
  const inventory = structuredClone(getInventory());
  const ingredient = inventory.find((item) => Number(item.id) === Number(input.ingredientId));
  if (!ingredient) throw new Error("Ingrediente no encontrado.");
  const previousStock = ingredient.stock;
  ingredient.stock = input.adjustmentType === "Ajuste positivo" ? previousStock + quantity : previousStock - quantity;
  saveAdminIngredients(inventory);
  const movement: InventoryMovement = {
    id: `manual-${Date.now()}`,
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    unit: ingredient.unit,
    type: input.adjustmentType,
    quantity,
    previousStock,
    finalStock: ingredient.stock,
    reason: input.reason,
    createdAt: new Date().toISOString(),
  };
  writeJson(KARDEX_KEY, [...getKardex(), movement]);
  updateLowStockPending(inventory);
  window.dispatchEvent(new Event("bpos:inventory-updated"));
  return movement;
}
