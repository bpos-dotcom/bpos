"use client";
/**
 * Bloque 10 · Motor de reportes.
 * Solo lee lo que B-POS ya guarda (ventas, recetas, costos de compra,
 * Kardex, compras y cortes); no modifica nada.
 */
import { getAdminProducts, getAdminRecipes } from "@/lib/admin";
import { getCashCloseHistory, type CashCloseRecord } from "@/lib/cash-history";
import { getInventory, getKardex, type InventoryMovement } from "@/lib/inventory";
import { getIngredientCostHistory, getPurchases, type IngredientCostRecord, type Purchase } from "@/lib/purchases";

// ------------------------------------------------------------ tipos

export type ReportOrderItem = { id: number; name: string; category?: string; price: number; quantity: number };

export type ReportOrder = {
  id: number | string;
  localOrderNumber?: number;
  createdAt: string;
  items: ReportOrderItem[];
  details?: { orderType?: string; paymentMethod?: string; discount?: number; customerName?: string };
  subtotal?: number;
  total: number;
  source?: string;
  externalPlatform?: string;
  bridgeActions?: { inventoryAdjustments?: { ingredientId: string | number; quantity: number }[] };
};

export type DateRange = { from: Date; to: Date }; // to = exclusivo

export type Row = { label: string; count: number; quantity: number; sales: number; cost: number; profit: number; margin: number };

export type ReportData = {
  range: DateRange;
  orders: ReportOrder[];
  kpis: {
    sales: number;
    orders: number;
    averageTicket: number;
    discounts: number;
    itemsSold: number;
    cost: number;
    profit: number;
    margin: number;
    costCoverage: number; // % de la venta con costo conocido
    purchases: number;
    inventoryValue: number;
  };
  byDay: Row[];
  byHour: Row[];
  byProduct: Row[];
  byCategory: Row[];
  byChannel: Row[];
  byPayment: Row[];
  shifts: CashCloseRecord[];
  purchases: Purchase[];
  purchasesBySupplier: Row[];
  purchasedIngredients: Row[];
  inventory: { name: string; unit: string; stock: number; minimum: number; unitCost: number; value: number; low: boolean }[];
  movements: { type: string; count: number; byIngredient: { name: string; unit: string; quantity: number }[] }[];
};

// ------------------------------------------------------------ fechas

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export type RangePreset = "hoy" | "ayer" | "7d" | "30d" | "mes" | "mes-pasado";

export function presetRange(preset: RangePreset, now = new Date()): DateRange {
  const today = startOfDay(now);
  switch (preset) {
    case "hoy":
      return { from: today, to: addDays(today, 1) };
    case "ayer":
      return { from: addDays(today, -1), to: today };
    case "7d":
      return { from: addDays(today, -6), to: addDays(today, 1) };
    case "30d":
      return { from: addDays(today, -29), to: addDays(today, 1) };
    case "mes":
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: addDays(today, 1) };
    case "mes-pasado":
      return {
        from: new Date(today.getFullYear(), today.getMonth() - 1, 1),
        to: new Date(today.getFullYear(), today.getMonth(), 1),
      };
  }
}

const inRange = (iso: string | undefined, r: DateRange) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= r.from.getTime() && t < r.to.getTime();
};

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ------------------------------------------------------------ canal y costo

export function orderChannel(order: ReportOrder) {
  if (order.source === "B-POS Bridge") return order.externalPlatform || order.details?.orderType || "Plataforma";
  return order.details?.orderType || "Mostrador";
}

export function orderPayment(order: ReportOrder) {
  return order.details?.paymentMethod || "Sin método";
}

/** Costo por unidad de inventario vigente en una fecha (última compra antes de esa fecha) */
export function makeCostLookup(history: IngredientCostRecord[]) {
  const byIngredient = new Map<number, IngredientCostRecord[]>();
  history
    .filter((h) => h.unitCost > 0)
    .forEach((h) => {
      const list = byIngredient.get(h.ingredientId) ?? [];
      list.push(h);
      byIngredient.set(h.ingredientId, list);
    });
  byIngredient.forEach((list) => list.sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt)));

  return (ingredientId: number, atIso?: string): number => {
    const list = byIngredient.get(ingredientId);
    if (!list?.length) return 0;
    if (!atIso) return list[list.length - 1].unitCost;
    let found: IngredientCostRecord | undefined;
    for (const h of list) {
      if (h.purchasedAt <= atIso) found = h;
      else break;
    }
    // si la venta es anterior a la primera compra, se usa el primer costo conocido
    return (found ?? list[0]).unitCost;
  };
}

type RecipeIndex = Map<number, { ingredientId: number; quantity: number }[]>;

export function makeRecipeIndex(recipes: { productId: number; ingredientId: number; quantity: number }[]): RecipeIndex {
  const index: RecipeIndex = new Map();
  recipes.forEach((r) => {
    const list = index.get(r.productId) ?? [];
    list.push({ ingredientId: r.ingredientId, quantity: r.quantity });
    index.set(r.productId, list);
  });
  return index;
}

/** Costo de insumos de una partida y si se conoce completo */
export function itemCost(item: ReportOrderItem, at: string, recipes: RecipeIndex, costAt: (id: number, at?: string) => number) {
  const recipe = recipes.get(item.id);
  if (!recipe?.length) return { cost: 0, known: false };
  let cost = 0;
  let known = true;
  recipe.forEach((r) => {
    const unit = costAt(r.ingredientId, at);
    if (!unit) known = false;
    cost += unit * r.quantity * item.quantity;
  });
  return { cost, known };
}

// ------------------------------------------------------------ agregación

function emptyRow(label: string): Row {
  return { label, count: 0, quantity: 0, sales: 0, cost: 0, profit: 0, margin: 0 };
}

function finish(rows: Map<string, Row>, sort: "sales" | "label" = "sales"): Row[] {
  const list = [...rows.values()].map((r) => ({
    ...r,
    profit: r.sales - r.cost,
    margin: r.sales > 0 ? ((r.sales - r.cost) / r.sales) * 100 : 0,
  }));
  return sort === "label" ? list.sort((a, b) => a.label.localeCompare(b.label)) : list.sort((a, b) => b.sales - a.sales);
}

function bump(map: Map<string, Row>, label: string, patch: { count?: number; quantity?: number; sales?: number; cost?: number }) {
  const row = map.get(label) ?? emptyRow(label);
  row.count += patch.count ?? 0;
  row.quantity += patch.quantity ?? 0;
  row.sales += patch.sales ?? 0;
  row.cost += patch.cost ?? 0;
  map.set(label, row);
}

export type ReportSources = {
  orders: ReportOrder[];
  recipes: { productId: number; ingredientId: number; quantity: number }[];
  products: { id: number; name: string; category?: string }[];
  costHistory: IngredientCostRecord[];
  purchases: Purchase[];
  shifts: CashCloseRecord[];
  inventory: { id: number; name: string; unit: string; stock: number; minimum: number }[];
  kardex: InventoryMovement[];
};

export function loadReportSources(): ReportSources {
  let orders: ReportOrder[] = [];
  try {
    orders = JSON.parse(localStorage.getItem("bpos_orders") || "[]");
  } catch {
    orders = [];
  }
  return {
    orders: Array.isArray(orders) ? orders : [],
    recipes: getAdminRecipes(),
    products: getAdminProducts(),
    costHistory: getIngredientCostHistory(),
    purchases: getPurchases(),
    shifts: getCashCloseHistory(),
    inventory: getInventory(),
    kardex: getKardex(),
  };
}

export function buildReport(src: ReportSources, range: DateRange): ReportData {
  const costAt = makeCostLookup(src.costHistory);
  const recipes = makeRecipeIndex(src.recipes);
  const productById = new Map(src.products.map((p) => [p.id, p]));

  const orders = src.orders.filter((o) => inRange(o.createdAt, range)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const byDay = new Map<string, Row>();
  const byHour = new Map<string, Row>();
  const byProduct = new Map<string, Row>();
  const byCategory = new Map<string, Row>();
  const byChannel = new Map<string, Row>();
  const byPayment = new Map<string, Row>();

  // días del rango, aunque no haya ventas
  for (let d = startOfDay(range.from); d < range.to; d = addDays(d, 1)) {
    byDay.set(dayKey(d.toISOString()), emptyRow(dayKey(d.toISOString())));
    if (byDay.size > 400) break;
  }
  for (let h = 0; h < 24; h += 1) byHour.set(String(h).padStart(2, "0"), emptyRow(String(h).padStart(2, "0")));

  let sales = 0;
  let discounts = 0;
  let itemsSold = 0;
  let cost = 0;
  let salesWithKnownCost = 0;

  orders.forEach((order) => {
    const total = Number(order.total) || 0;
    const items = Array.isArray(order.items) ? order.items : [];
    const itemsSubtotal = items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
    // descuento repartido proporcionalmente entre las partidas
    const factor = itemsSubtotal > 0 ? total / itemsSubtotal : 0;

    let orderCost = 0;
    let orderKnown = items.length > 0;

    items.forEach((item) => {
      const qty = Number(item.quantity) || 0;
      const lineSales = (Number(item.price) || 0) * qty * factor;
      const { cost: lineCost, known } = itemCost({ ...item, quantity: qty }, order.createdAt, recipes, costAt);
      if (!known) orderKnown = false;
      orderCost += lineCost;
      itemsSold += qty;

      const product = productById.get(item.id);
      const name = product?.name || item.name || `Producto ${item.id}`;
      bump(byProduct, name, { count: 1, quantity: qty, sales: lineSales, cost: lineCost });
      bump(byCategory, product?.category || item.category || "Sin categoría", { quantity: qty, sales: lineSales, cost: lineCost });
    });

    // insumos sueltos de pedidos de plataforma (extras sin producto)
    order.bridgeActions?.inventoryAdjustments?.forEach((adj) => {
      orderCost += costAt(Number(adj.ingredientId), order.createdAt) * (Number(adj.quantity) || 0);
    });

    sales += total;
    discounts += Number(order.details?.discount) || 0;
    cost += orderCost;
    if (orderKnown) salesWithKnownCost += total;

    const day = dayKey(order.createdAt);
    bump(byDay, day, { count: 1, sales: total, cost: orderCost });
    bump(byHour, String(new Date(order.createdAt).getHours()).padStart(2, "0"), { count: 1, sales: total, cost: orderCost });
    bump(byChannel, orderChannel(order), { count: 1, sales: total, cost: orderCost });
    bump(byPayment, orderPayment(order), { count: 1, sales: total, cost: orderCost });
  });

  // ---------- compras
  const purchases = src.purchases
    .filter((p) => p.status !== "cancelled" && inRange(p.createdAt, range))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const bySupplier = new Map<string, Row>();
  const byIngredient = new Map<string, Row>();
  purchases.forEach((p) => {
    bump(bySupplier, p.supplier || "Sin proveedor", { count: 1, sales: p.total });
    p.items.forEach((i) => bump(byIngredient, `${i.ingredientName} (${i.unit})`, { count: 1, quantity: i.inventoryQuantity, sales: i.lineTotal }));
  });

  // ---------- inventario actual valorizado
  const inventory = src.inventory.map((i) => {
    const unitCost = costAt(i.id);
    return {
      name: i.name,
      unit: i.unit,
      stock: Number(i.stock) || 0,
      minimum: Number(i.minimum) || 0,
      unitCost,
      value: Math.max(Number(i.stock) || 0, 0) * unitCost,
      low: Number(i.minimum) > 0 && Number(i.stock) <= Number(i.minimum),
    };
  });

  // ---------- movimientos de inventario en el periodo
  const movementsByType = new Map<string, { count: number; ing: Map<string, { name: string; unit: string; quantity: number }> }>();
  src.kardex
    .filter((m) => inRange(m.createdAt, range))
    .forEach((m) => {
      const entry = movementsByType.get(m.type) ?? { count: 0, ing: new Map() };
      entry.count += 1;
      const ing = entry.ing.get(m.ingredientName) ?? { name: m.ingredientName, unit: m.unit, quantity: 0 };
      ing.quantity += Number(m.quantity) || 0;
      entry.ing.set(m.ingredientName, ing);
      movementsByType.set(m.type, entry);
    });

  const shifts = src.shifts.filter((s) => inRange(s.closedAt, range) || inRange(s.openedAt, range));

  return {
    range,
    orders,
    kpis: {
      sales,
      orders: orders.length,
      averageTicket: orders.length ? sales / orders.length : 0,
      discounts,
      itemsSold,
      cost,
      profit: sales - cost,
      margin: sales > 0 ? ((sales - cost) / sales) * 100 : 0,
      costCoverage: sales > 0 ? (salesWithKnownCost / sales) * 100 : 100,
      purchases: purchases.reduce((s, p) => s + p.total, 0),
      inventoryValue: inventory.reduce((s, i) => s + i.value, 0),
    },
    byDay: finish(byDay, "label"),
    byHour: finish(byHour, "label"),
    byProduct: finish(byProduct),
    byCategory: finish(byCategory),
    byChannel: finish(byChannel),
    byPayment: finish(byPayment),
    shifts,
    purchases,
    purchasesBySupplier: finish(bySupplier),
    purchasedIngredients: finish(byIngredient),
    inventory,
    movements: [...movementsByType.entries()].map(([type, e]) => ({
      type,
      count: e.count,
      byIngredient: [...e.ing.values()].sort((a, b) => b.quantity - a.quantity),
    })),
  };
}

// ------------------------------------------------------------ sucursales (nube)

/** Ventas de todas las sucursales del negocio desde la nube */
export async function loadBranchSales(range: DateRange) {
  const { loadCloudAccount } = await import("@/lib/cloud/account");
  const { getSupabase, isCloudConfigured } = await import("@/lib/supabase/client");
  if (!isCloudConfigured) return null;
  const account = await loadCloudAccount();
  if (account.status !== "ready") return null;

  const rows: { scope: string; data: ReportOrder }[] = [];
  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await getSupabase()
      .from("sync_records")
      .select("scope, data")
      .eq("business_id", account.businessId)
      .eq("collection", "bpos_orders")
      .eq("deleted", false)
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as { scope: string; data: ReportOrder }[]));
    if (!data || data.length < 1000) break;
  }

  const names = new Map(account.branches.map((b) => [b.id, b.name]));
  const byBranch = new Map<string, Row>();
  account.branches.forEach((b) => byBranch.set(b.name, emptyRow(b.name)));
  rows.forEach(({ scope, data }) => {
    if (!data || !inRange(data.createdAt, range)) return;
    bump(byBranch, names.get(scope) || "Otra sucursal", { count: 1, sales: Number(data.total) || 0 });
  });
  return finish(byBranch);
}
