"use client";
/**
 * Bloque 10 · Motor de reportes.
 * Solo lee lo que B-POS ya guarda (ventas, recetas, costos de compra,
 * Kardex, compras y cortes); no modifica nada.
 */
import { itemConsumption, type SoldModifier, type SoldPart } from "@/lib/compound";
import { getAdminProducts, getAdminRecipes } from "@/lib/admin";
import { getCashCloseHistory, inVoidedShift, voidedShiftIds, type CashCloseRecord } from "@/lib/cash-history";
import { getInventory, getKardex, type InventoryMovement } from "@/lib/inventory";
import { getIngredientCostHistory, getPurchases, type IngredientCostRecord, type Purchase } from "@/lib/purchases";
import { brandName, getBrands, orderBrandId, type Brand } from "@/lib/brands";
import { deliveryApp } from "@/lib/app-commissions";
import { platformLabel } from "@/lib/bridge/delivery-ticket";

// ------------------------------------------------------------ tipos

export type ReportOrderItem = { id: number; name: string; category?: string; price: number; quantity: number; parts?: SoldPart[]; modifiers?: SoldModifier[] };

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
  /** Con varias marcas el canal lleva la marca: "DiDi Food (Supremos)" */
  byChannel: Row[];
  byPayment: Row[];
  /** Multimarca: ventas, costo y utilidad de cada marca (vacío si el negocio tiene una sola) */
  byBrand: (Row & { brandId: string; color: string; channels: (Row & { app: string | null })[] })[];
  /** Pedidos con productos de dos marcas (cuentan en la que más vendió): para revisarlos */
  mixedBrandOrders: { id: number | string; localOrderNumber?: number; createdAt: string; total: number; channel: string; brands: string[] }[];
  shifts: CashCloseRecord[];
  purchases: Purchase[];
  purchasesBySupplier: Row[];
  purchasedIngredients: Row[];
  /** Qué ingredientes suman el costo de lo vendido (de más a menos): cuánto se usó y a cuánto la unidad */
  costByIngredient: { id: number; name: string; unit: string; quantity: number; unitCost: number; cost: number }[];
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

/** Costo de insumos de una partida (con las partes si es combo) y si se conoce completo */
export function itemCost(
  item: ReportOrderItem,
  at: string,
  recipes: RecipeIndex,
  costAt: (id: number, at?: string) => number,
  onUse?: (ingredientId: number, quantity: number, cost: number) => void
) {
  // Combo: cada parte necesita receta; el combo puede tener o no receta propia
  const withRecipe = [item.id, ...(item.parts || []).map((p) => p.productId)];
  const known0 = item.parts?.length ? item.parts.every((p) => recipes.get(p.productId)?.length) : Boolean(recipes.get(item.id)?.length);
  if (!withRecipe.some((id) => recipes.get(id)?.length)) return { cost: 0, known: false };
  let cost = 0;
  let known = known0;
  itemConsumption(item, (id) => recipes.get(id) || []).forEach((quantity, ingredientId) => {
    const unit = costAt(ingredientId, at);
    if (!unit) known = false;
    cost += unit * quantity;
    onUse?.(ingredientId, quantity, unit * quantity);
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
  products: { id: number; name: string; category?: string; brandId?: string }[];
  /** Marcas del negocio (la principal primero); con una sola no se separa nada */
  brands?: Brand[];
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
    brands: getBrands(),
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
  // Empaque de cada producto (solo cuenta el del producto vendido, no el de las partes del combo)
  const packagingOf = new Map(src.products.map((p) => [Number(p.id), (p as { packaging?: { ingredientId: number; quantity: number }[] }).packaging || []]));

  // Las ventas de un corte anulado (ej. pruebas) no cuentan
  const voided = voidedShiftIds(src.shifts);
  const orders = src.orders
    .filter((o) => !(o as { cancelled?: boolean }).cancelled && !(o as { pendingPayment?: boolean }).pendingPayment && !inVoidedShift(o as { shiftSessionId?: string }, voided) && inRange(o.createdAt, range))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const byDay = new Map<string, Row>();
  const byHour = new Map<string, Row>();
  const byProduct = new Map<string, Row>();
  const byCategory = new Map<string, Row>();
  const byChannel = new Map<string, Row>();
  const byPayment = new Map<string, Row>();
  // Multimarca: la marca de cada pedido sale de sus productos
  const brands = src.brands && src.brands.length > 1 ? src.brands : null;
  const byBrand = new Map<string, Row>();
  brands?.forEach((b) => byBrand.set(b.id, emptyRow(b.name)));
  // Canales de cada marca; `app` = DiDi, Uber o Rappi (su venta no es lo que depositan)
  const brandChannels = new Map<string, Map<string, Row & { app: string | null }>>();
  const mixedBrandOrders: ReportData["mixedBrandOrders"] = [];

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
  const used = new Map<number, { quantity: number; cost: number }>();
  const use = (id: number, quantity: number, c: number) => {
    const u = used.get(id) || { quantity: 0, cost: 0 };
    u.quantity += quantity;
    u.cost += c;
    used.set(id, u);
  };

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
      const { cost: recipeCost, known } = itemCost({ ...item, quantity: qty }, order.createdAt, recipes, costAt, use);
      let lineCost = recipeCost;
      for (const p of packagingOf.get(Number(item.id)) || []) {
        const amount = (Number(p.quantity) || 0) * qty;
        const c = costAt(Number(p.ingredientId), order.createdAt) * amount;
        lineCost += c;
        if (amount > 0) use(Number(p.ingredientId), amount, c);
      }
      if (!known) orderKnown = false;
      orderCost += lineCost;
      itemsSold += qty;

      const product = productById.get(item.id);
      const name = product?.name || item.name || `Producto ${item.id}`;
      bump(byProduct, name, { count: 1, quantity: qty, sales: lineSales, cost: lineCost });
      // Lo que iba dentro del combo también cuenta como vendido (cantidad, sin venta ni costo: ya están en el combo)
      item.parts?.forEach((part) => {
        const partName = productById.get(part.productId)?.name || part.name;
        bump(byProduct, partName, { quantity: (Number(part.quantity) || 1) * qty });
      });
      bump(byCategory, product?.category || item.category || "Sin categoría", { quantity: qty, sales: lineSales, cost: lineCost });
    });

    // insumos sueltos de pedidos de plataforma (extras sin producto)
    order.bridgeActions?.inventoryAdjustments?.forEach((adj) => {
      const c = costAt(Number(adj.ingredientId), order.createdAt) * (Number(adj.quantity) || 0);
      orderCost += c;
      use(Number(adj.ingredientId), Number(adj.quantity) || 0, c);
    });

    sales += total;
    discounts += Number(order.details?.discount) || 0;
    cost += orderCost;
    if (orderKnown) salesWithKnownCost += total;

    const day = dayKey(order.createdAt);
    bump(byDay, day, { count: 1, sales: total, cost: orderCost });
    bump(byHour, String(new Date(order.createdAt).getHours()).padStart(2, "0"), { count: 1, sales: total, cost: orderCost });
    if (brands) {
      const brand = orderBrandId(items, productById, brands);
      const name = brandName(brand.brandId, brands);
      // Apps con su nombre completo ("didi" → "DiDi Food"): "DiDi Food (Supremos)"
      const app = order.source === "B-POS Bridge" || order.externalPlatform ? deliveryApp(order) : null;
      const channel = app ? platformLabel(order.externalPlatform || order.details?.orderType) : orderChannel(order);
      bump(byChannel, `${channel} (${name})`, { count: 1, sales: total, cost: orderCost });
      const row = byBrand.get(brand.brandId) ?? emptyRow(name);
      row.count += 1;
      row.sales += total;
      row.cost += orderCost;
      byBrand.set(brand.brandId, row);
      const channels = brandChannels.get(brand.brandId) ?? new Map();
      const ch = channels.get(channel) ?? { ...emptyRow(channel), app };
      ch.count += 1;
      ch.sales += total;
      ch.cost += orderCost;
      channels.set(channel, ch);
      brandChannels.set(brand.brandId, channels);
      if (brand.mixed) mixedBrandOrders.push({ id: order.id, localOrderNumber: order.localOrderNumber, createdAt: order.createdAt, total, channel, brands: brand.brandIds.map((id) => brandName(id, brands)) });
    } else bump(byChannel, orderChannel(order), { count: 1, sales: total, cost: orderCost });
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

  const shifts = src.shifts.filter((s) => !s.voided && (inRange(s.closedAt, range) || inRange(s.openedAt, range)));

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
    byBrand: [...byBrand.entries()].map(([brandId, r]) => ({
      ...r,
      brandId,
      color: brands?.find((b) => b.id === brandId)?.color || "#71717a",
      profit: r.sales - r.cost,
      margin: r.sales > 0 ? ((r.sales - r.cost) / r.sales) * 100 : 0,
      channels: [...(brandChannels.get(brandId)?.values() || [])]
        .map((c) => ({ ...c, profit: c.sales - c.cost, margin: c.sales > 0 ? ((c.sales - c.cost) / c.sales) * 100 : 0 }))
        .sort((a, b) => b.sales - a.sales),
    })),
    mixedBrandOrders,
    shifts,
    purchases,
    purchasesBySupplier: finish(bySupplier),
    purchasedIngredients: finish(byIngredient),
    costByIngredient: [...used.entries()]
      .filter(([, u]) => u.cost > 0)
      .map(([id, u]) => {
        const ing = src.inventory.find((i) => Number(i.id) === id);
        return { id, name: ing?.name || `Ingrediente ${id}`, unit: ing?.unit || "", quantity: u.quantity, unitCost: u.quantity ? u.cost / u.quantity : 0, cost: u.cost };
      })
      .sort((a, b) => b.cost - a.cost),
    inventory,
    movements: [...movementsByType.entries()].map(([type, e]) => ({
      type,
      count: e.count,
      byIngredient: [...e.ing.values()].sort((a, b) => b.quantity - a.quantity),
    })),
  };
}

// ------------------------------------------------------------ sucursales (nube)

/** Pedidos de todas las sucursales del negocio desde la nube (null si no hay nube) */
/** `since`: solo pedidos guardados desde esa fecha (más rápido para periodos cortos) */
export async function loadCloudOrders(since?: Date) {
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
      // un pedido siempre se guarda después de crearse, así que no se pierde ninguno del periodo
      .gte("updated_at", (since ?? new Date(0)).toISOString())
      .order("seq")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as { scope: string; data: ReportOrder }[]));
    if (!data || data.length < 1000) break;
  }

  const names = new Map(account.branches.map((b) => [b.id, b.name]));
  return {
    branches: account.branches,
    orders: rows
      .filter(({ data }) => data && typeof data.createdAt === "string")
      .map(({ scope, data }) => ({ branchId: scope, branchName: names.get(scope) || "Otra sucursal", order: data })),
  };
}

/** Ventas de todas las sucursales del negocio desde la nube */
export async function loadBranchSales(range: DateRange) {
  const cloud = await loadCloudOrders(range.from);
  if (!cloud) return null;
  return salesByBranch(cloud.branches, cloud.orders, range);
}

export function salesByBranch(
  branches: { id: string; name: string }[],
  orders: { branchName: string; order: ReportOrder }[],
  range: DateRange
) {
  const byBranch = new Map<string, Row>();
  branches.forEach((b) => byBranch.set(b.name, emptyRow(b.name)));
  orders.forEach(({ branchName, order }) => {
    if ((order as { cancelled?: boolean }).cancelled || (order as { pendingPayment?: boolean }).pendingPayment || !inRange(order.createdAt, range)) return;
    bump(byBranch, branchName, { count: 1, sales: Number(order.total) || 0 });
  });
  return finish(byBranch);
}

/** Un pedido de la nube por su id (para el detalle de un aviso en la App del dueño); null si no está. */
export async function loadCloudOrder(id: string) {
  const { getSupabase, isCloudConfigured } = await import("@/lib/supabase/client");
  if (!isCloudConfigured || !id) return null;
  const { data, error } = await getSupabase()
    .from("sync_records")
    .select("scope, data")
    .eq("collection", "bpos_orders")
    .eq("record_id", id)
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0]?.data as ReportOrder | undefined) ?? null;
}
