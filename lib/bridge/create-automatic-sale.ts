"use client";

import { isSameSale } from "@/lib/bridge/order-identity";
import { getAdminProducts } from "@/lib/admin";
import type { DeliveryTicket } from "@/lib/bridge/delivery-ticket";
import type { SaleReadyPayload } from "@/lib/bridge/prepare-sale";
import { applyInventoryForOrder, correctInventoryForOrder } from "@/lib/inventory";
import { createKdsCriticalError, notifyKdsUpdated } from "@/lib/kds";
import type { KdsTicketLine } from "@/lib/bridge/ticket-structure";
import { allocateShiftOrderNumber } from "@/lib/order-sequence";
import { OWN_OPTIONS, buildSelection, isAutoGroup, optionName, type SoldModifier, type SoldPart } from "@/lib/compound";
import type { ModifierGroup, Product } from "@/data/products";
import { addAuditEvent } from "@/lib/audit";
import { optionNameMatches } from "@/lib/bridge/interpret-order";
import { getOperationsAlerts, resolveOperationsAlert, upsertOperationsAlert } from "@/lib/notifications/operationsCenter";

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type PreparedLine = { sourceIndex?: number; externalName?: string; compound?: boolean };

/**
 * ¿Este renglón se arma como combo (leer sub-líneas, partes por estación,
 * receta de cada opción)? Solo si la equivalencia se marcó compuesta. Un
 * pedido preparado antes de que existiera la casilla conserva el
 * comportamiento viejo: combo si el producto tiene grupos de opciones.
 */
function isCompoundLine(product: Product, line: PreparedLine) {
  if (!product.modifierGroups?.length) return false;
  return line.compound === undefined ? true : line.compound;
}

/**
 * Renglón del ticket al que corresponde el producto: por número de renglón,
 * si no por nombre. Sin renglón propio se leen las opciones de todo el ticket
 * (pedidos viejos preparados antes de guardar el renglón).
 */
function ownTicketItems(ticket: DeliveryTicket | undefined, line: PreparedLine) {
  const items = ticket?.items || [];
  const byIndex = items.find((i) => i.index === line.sourceIndex);
  if (byIndex) return [byIndex];
  const name = plain(line.externalName || "");
  const byName = name ? items.filter((i) => plain(i.name) === name) : [];
  return byName.length ? byName : items;
}

/**
 * Opciones de un grupo que nombra el ticket. Cada cosa que dice elige UNA
 * opción: la de nombre igual y, si no hay, la más parecida ("Dr. Pepper" es
 * el Dr Pepper, no el "Dr Pepper Strawberry Cream" que también lo contiene).
 * Palabras completas y al menos 4 letras: "Si" (catsup aparte) no elige "Si
 * Racha". "Ranch No, Gracias" o "Sin cebolla" es que NO lo quiso: solo
 * cuenta si una opción se llama exactamente así.
 */
export function pickOptions(said: string[], options: { key: string; name: string }[], groupName = "") {
  const names = options.map((o) => ({ key: o.key, name: plain(o.name) }));
  const matched: string[] = [];
  for (const raw of said) {
    const s = plain(raw);
    if (!s) continue;
    const declined = /(^| )(no|sin|nada)( |$)/.test(s);
    const best =
      names
        .filter((o) => (declined ? o.name === s : optionNameMatches(s, o.name)))
        .sort((a, b) => Number(b.name === s) - Number(a.name === s) || Math.abs(a.name.length - s.length) - Math.abs(b.name.length - s.length))[0] ||
      (declined ? undefined : looseOption(s, names, groupName));
    if (best && !matched.includes(best.key)) matched.push(best.key);
  }
  return matched;
}

/**
 * Cuando la plataforma nombra la opción a su manera:
 * - "newyork (tocino, bbq y aros)" es la "Hamburguesa NewYork BBQ": todas las
 *   palabras propias de la opción (sin "hamburguesa" ni las del grupo) vienen
 *   en el ticket. Si caben varias, la que tiene más palabras (la Doble solo si
 *   dice "doble").
 * - "BBQ" es la "Salsa BBQ": la palabra solo está en UNA opción del grupo.
 * Si sigue habiendo empate no se adivina.
 */
function looseOption(said: string, names: { key: string; name: string }[], groupName: string) {
  const saidWords = new Set(said.split(" "));
  const generic = new Set(["hamburguesa", "de", "la", "el", "con", "y", ...plain(groupName).split(" ")]);
  const scored = names
    .map((o) => ({ o, core: o.name.split(" ").filter((w) => w && !generic.has(w)) }))
    .filter(({ core }) => core.join("").length >= 4 && core.every((w) => saidWords.has(w)))
    .sort((a, b) => b.core.length - a.core.length);
  if (scored.length && (scored.length === 1 || scored[0].core.length > scored[1].core.length)) return scored[0].o;
  if (said.length >= 3 && !said.includes(" ")) {
    const holders = names.filter((o) => o.name.split(" ").includes(said));
    if (holders.length === 1) return holders[0];
  }
  return undefined;
}

/** "No, Gracias", "No", "Sin refresco", "Nada": el cliente dijo que no */
const saysNo = (name: string) => /^(no|sin|nada|ninguno|ninguna)( |$)/.test(plain(name));

/**
 * Opciones de un combo de delivery: lo que el cliente eligió en la
 * plataforma ("Elige tu refresco: Manzanita") decide la opción. Si el
 * ticket no dice nada de un grupo, el grupo queda vacío: no se inventa
 * la primera opción (salía "Papas Fritas" fantasma en una hamburguesa
 * sola). Solo cuentan las sub-líneas del renglón de este combo: dos
 * combos con hamburguesas distintas en el mismo pedido no se cruzan.
 */
function deliveryPicks(product: Product, catalog: Product[], ticket: DeliveryTicket | undefined, line: PreparedLine) {
  const own = ownTicketItems(ticket, line);
  const said = own.flatMap((i) => [...i.choices.map((c) => c.name), ...i.notes]).map(plain).filter(Boolean);
  const picks: Record<string, string[]> = {};
  /** Grupos a los que el cliente contestó "No, gracias" en la plataforma (aunque el grupo de B-POS no tenga esa opción) */
  const declined = new Set<string>();
  for (const group of product.modifierGroups || []) {
    if (isAutoGroup(group)) continue; // ya se llena solo
    const matched = pickOptions(said, group.options.map((o) => ({ key: o.key, name: optionName(o, catalog) })), group.name);
    const limit = group.max > 0 ? group.max : matched.length;
    if (matched.length) picks[group.key] = matched.slice(0, limit);
    else {
      // Didi y Uber no imprimen nada cuando el cliente no quiso extra: si el
      // grupo tiene su "No, gracias", el silencio del ticket es eso
      const no = declineOption(group);
      if (no && group.min > 0) picks[group.key] = [no.key];
      // "Que tal una bebida? → No, Gracias": la misma pregunta que el grupo, contestada que no
      else if (own.some((i) => i.choices.some((c) => saysNo(c.name) && c.question && optionNameMatches(plain(c.question), plain(group.name))))) declined.add(group.key);
    }
  }
  return { picks, declined };
}

/**
 * Opción de "no quiero" de un grupo ("No, Gracias", "Sin extra", "Nada",
 * "Ninguno"): sin producto ni insumo, así que no descuenta nada.
 */
export function declineOption(group: ModifierGroup) {
  return group.options.find((o) => !o.productId && !o.ingredientId && /^(no|sin|nada|ninguno|ninguna)( |$)/.test(plain(o.name)));
}

/**
 * Avisos "Combo sin opción obligatoria" que siguen abiertos: se vuelve a leer
 * el ticket guardado de cada venta con las reglas de hoy ("No, gracias" a la
 * misma pregunta, el refresco cambiado que se cobró aparte, la hamburguesa
 * escrita a la manera de la plataforma, el "No, gracias" que no se imprime).
 * Si ahora sí se sabe la opción, la venta se corrige, el inventario descuenta
 * lo que faltaba (anotado en la bitácora) y el aviso se resuelve solo.
 */
export function recheckComboAlerts(by = "B-POS") {
  if (typeof window === "undefined") return 0;
  const open = getOperationsAlerts().filter((a) => a.id.startsWith("bridge-combo:") && a.status !== "resolved");
  if (!open.length) return 0;
  const catalog = getAdminProducts();
  const orders = readOrders();
  let cleared = 0;
  let changed = false;
  for (const alert of open) {
    const orderId = Number(alert.id.slice("bridge-combo:".length));
    const index = orders.findIndex((o) => Number(o.id) === orderId);
    const order = orders[index];
    if (!order) continue;
    // La venta ya está completa (se corrigió en el Bridge o en otra caja): el aviso ya no aplica
    if (!order.items.some((i) => i.missingChoices?.length)) {
      resolveOperationsAlert(alert.id, by, "Venta corregida");
      cleared++;
      continue;
    }
    const soldApart = order.items.map((i) => ({ externalName: i.externalName || "", category: i.category }));
    let touched = false;
    const items = order.items.map((item) => {
      if (!item.missingChoices?.length) return item;
      const product = catalog.find((p) => Number(p.id) === Number(item.id));
      if (!product?.modifierGroups?.length) return item;
      const fresh = deliverySelection(product, catalog, order.deliveryTicket, { externalName: item.externalName }, soldApart.filter((s) => s.externalName !== item.externalName));
      if ((fresh.missingChoices || []).length >= item.missingChoices.length) return item;
      touched = true;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { missingChoices, parts, modifiers, ownTicket, ...rest } = item;
      return { ...rest, ...fresh };
    });
    if (!touched) continue;
    const updated = { ...order, items };
    try {
      correctInventoryForOrder(updated, `se volvió a leer el combo del ticket (${by})`);
    } catch {
      continue; // falta un insumo en inventario: la venta se queda como estaba y el aviso sigue
    }
    orders[index] = updated;
    changed = true;
    if (!items.some((i) => i.missingChoices?.length)) {
      resolveOperationsAlert(alert.id, by, "B-POS volvió a leer el ticket y ya encontró las opciones del combo");
      cleared++;
    }
  }
  if (changed) {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
    window.dispatchEvent(new CustomEvent("bpos:orders-updated", { detail: { source: "bridge" } }));
  }
  return cleared;
}

/**
 * deliverySelection: opciones del combo según el ticket.
 * soldApart: los productos del mismo pedido que se vendieron por separado
 * (su nombre en el ticket y su categoría). Si el cliente cambió el refresco
 * del combo por uno con costo ("Elige tu REF → Coca Cola 600ml +$25"), la
 * Coca ya se vendió y descontó aparte: el grupo de refresco no falta.
 */
export function deliverySelection(product: Product, catalog: Product[], ticket: DeliveryTicket | undefined, line: PreparedLine, soldApart: { externalName: string; category?: string }[] = []) {
  const { picks, declined } = deliveryPicks(product, catalog, ticket, line);
  const { parts, modifiers, ownTicket } = buildSelection(product, catalog, { [OWN_OPTIONS]: picks });
  // El cobro de extras ya viene en el total de la plataforma
  const kept = modifiers?.filter((m) => !m.extra);
  // Grupo obligatorio que el ticket no eligió ("Combo El Favorito" sin decir qué
  // hamburguesa, o una hamburguesa que no está en el combo del POS): no se inventa
  // la opción, pero se avisa porque esa parte no descuenta inventario (solo grupos de
  // productos enlazados: "¿Deseas agregar algún extra?" sin contestar no falta nada)
  let missingGroups = (product.modifierGroups || []).filter((g) => g.min > 0 && !isAutoGroup(g) && g.options.some((o) => o.productId) && !picks[g.key]?.length && !declined.has(g.key));
  // Opciones del ticket de este combo que se vendieron como producto propio: cubren el grupo de su misma categoría
  const choices = ownTicketItems(ticket, line).flatMap((i) => i.choices.map((c) => plain(c.name)));
  for (const sold of soldApart) {
    if (!sold.category || !choices.includes(plain(sold.externalName))) continue;
    const covered = missingGroups.find((g) => g.options.some((o) => o.productId && catalog.find((p) => Number(p.id) === Number(o.productId))?.category === sold.category));
    if (covered) missingGroups = missingGroups.filter((g) => g !== covered);
  }
  const missing = missingGroups.map((g) => g.name);
  return { ...(parts?.length ? { parts, ownTicket } : {}), ...(kept?.length ? { modifiers: kept } : {}), ...(missing.length ? { missingChoices: missing } : {}) };
}

/** Avisa al dueño (Centro de Operaciones y su celular) de los combos que quedaron sin una opción obligatoria */
function warnMissingChoices(order: { id: number; externalPlatform: string; externalOrderNumber: string; items: AutomaticSaleItem[] }) {
  const incomplete = order.items.filter((i) => i.missingChoices?.length);
  if (!incomplete.length) {
    // Venta corregida: el aviso anterior ya no aplica
    if (getOperationsAlerts().some((a) => a.id === `bridge-combo:${order.id}` && a.status !== "resolved")) resolveOperationsAlert(`bridge-combo:${order.id}`, "B-POS", "Venta corregida");
    return;
  }
  const what = incomplete.map((i) => `${i.name} sin "${i.missingChoices!.join('", "')}"`).join("; ");
  const message = `Pedido ${platformLabel(order.externalPlatform)} #${order.externalOrderNumber} (venta #${String(order.id).padStart(6, "0")}): ${what}. El ticket no trae una opción que exista en el combo de B-POS, así que esa parte no se descontó del inventario. Revisa la equivalencia en el Bridge.`;
  upsertOperationsAlert({
    id: `bridge-combo:${order.id}`,
    priority: "warning",
    title: "Combo sin opción obligatoria",
    message,
    source: "Bridge",
    moduleHref: "/bridge",
    metadata: { orderId: order.id },
  });
  addAuditEvent({ category: "Bridge", action: "sale.combo_incomplete", description: message, entityId: String(order.id), metadata: { orderId: order.id } });
}

const ORDERS_KEY = "bpos_orders";
const SHIFT_KEY = "bpos_active_shift";

export type AutomaticSaleResult =
  | {
      success: true;
      duplicate: false;
      orderId: number;
      order: AutomaticSaleOrder;
    }
  | {
      success: true;
      duplicate: true;
      orderId: number;
      order: AutomaticSaleOrder;
    }
  | {
      success: false;
      duplicate: false;
      error: string;
    };

type AutomaticSaleItem = {
  id: number;
  name: string;
  category: string;
  price: number;
  emoji?: string;
  station?: "Parrilla" | "Freidora" | "Barra" | "Cocina";
  quantity: number;
  externalName?: string;
  parts?: SoldPart[];
  modifiers?: SoldModifier[];
  ownTicket?: boolean;
  /** Grupos obligatorios del combo que el ticket no eligió (no descontaron inventario) */
  missingChoices?: string[];
};

export type AutomaticSaleOrder = {
  id: number;
  localOrderNumber: number;
  shiftSessionId: string;
  createdAt: string;
  items: AutomaticSaleItem[];
  details: {
    orderType: string;
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    paymentMethod: string;
    discount: number;
  };
  subtotal: number;
  total: number;
  source: "B-POS Bridge";
  externalOrderNumber: string;
  externalOrderKey: string;
  externalPlatform: string;
  externalTotal: number;
  externalRawText: string;
  kdsTicketLines: KdsTicketLine[];
  bridgeActions: {
    inventoryAdjustments: SaleReadyPayload["inventoryAdjustments"];
    ignoredLines: SaleReadyPayload["ignoredLines"];
  };
  status: "Nuevo" | "Entregado"; // "Entregado" si se equivaló tarde (cocina ya lo preparó)
  kdsReleased: true;
  kdsReleasedAt: string;
  kdsCompleted: boolean;
  kdsCompletedAt?: string;
  /** Ticket armado por el Bridge con los renglones del pedido original (para reimprimir igual) */
  deliveryTicket?: DeliveryTicket;
};

function readOrders(): AutomaticSaleOrder[] {
  try {
    const raw = localStorage.getItem(ORDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function platformLabel(platform: string) {
  const value = platform.toLowerCase();
  if (value.includes("didi")) return "Didi Food";
  if (value.includes("uber")) return "Uber Eats";
  if (value.includes("rappi")) return "Rappi";
  return "Plataforma";
}

function nextOrderId(orders: AutomaticSaleOrder[]) {
  return orders.reduce((max, order) => Math.max(max, Number(order.id) || 0), 0) + 1;
}

/** Si se equivale después de esto, cocina ya lo preparó con el ticket impreso: entra al KDS como entregado. */
const LATE_SALE_MS = 15 * 60 * 1000;
/**
 * DiDi reinicia sus números cada día (#1, #2…): el mismo número solo es el
 * mismo pedido si llegó hace menos de esto. Antes el DiDi #12 de hoy se tomaba
 * como repetido del #12 de ayer y no se creaba la venta.
 */
export const SAME_ORDER_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Productos de la venta a partir del pedido preparado (con las equivalencias de ese momento) */
function buildSaleItems(payload: SaleReadyPayload, ticket: DeliveryTicket | undefined): { items: AutomaticSaleItem[] } | { error: string } {
  const catalog = getAdminProducts();
  const items: AutomaticSaleItem[] = [];
  // Lo que se vendió como producto propio (para saber si un refresco cambiado del combo ya se cobró aparte)
  const soldApart = payload.products.map((p) => ({ externalName: p.externalName || "", category: catalog.find((c) => String(c.id) === String(p.productId))?.category }));
  for (const preparedProduct of payload.products) {
    const product = catalog.find((candidate) => String(candidate.id) === String(preparedProduct.productId));
    if (!product) return { error: `El producto ${preparedProduct.productId} ya no existe en el catálogo.` };
    const quantity = Number(preparedProduct.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return { error: `Cantidad inválida para ${product.name}.` };
    items.push({
      ...product,
      // Un producto que no se vende por separado es un modificador de la plataforma: su precio ya va en el renglón principal
      ...(product.notSoldAlone ? { price: 0 } : {}),
      quantity,
      externalName: preparedProduct.externalName,
      // Equivalencia compuesta: cada opción elegida va a su estación y descuenta
      // su receta. Sin ella, el producto se descuenta con su receta tal cual.
      ...(isCompoundLine(product, preparedProduct) ? deliverySelection(product, catalog, ticket, preparedProduct, soldApart.filter((s) => s.externalName !== preparedProduct.externalName)) : {}),
    });
  }
  if (items.length === 0) return { error: "El pedido no contiene productos vendibles." };
  return { items };
}

/**
 * Pedido finalizado mal equivalado: rehace los productos de la venta con las
 * equivalencias de hoy y corrige el inventario (regresa lo descontado y
 * descuenta lo nuevo, anotado en la bitácora de inventario). El folio, la hora
 * y el turno no cambian; el total se recalcula con los precios del catálogo,
 * igual que al crear la venta.
 */
export function correctAutomaticSale(saleId: number, payload: SaleReadyPayload, options: { ticket?: DeliveryTicket; by: string }) {
  const orders = readOrders();
  const sale = orders.find((o) => Number(o.id) === Number(saleId));
  if (!sale) return { success: false as const, error: "No encontré la venta de este pedido en este dispositivo." };
  const built = buildSaleItems(payload, options.ticket);
  if ("error" in built) return { success: false as const, error: built.error };
  const subtotal = built.items.reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0);
  const updated: AutomaticSaleOrder = {
    ...sale,
    items: built.items,
    subtotal,
    total: Math.max(0, subtotal - Number(sale.details?.discount || 0)),
    bridgeActions: { inventoryAdjustments: payload.inventoryAdjustments, ignoredLines: payload.ignoredLines },
    ...(options.ticket ? { deliveryTicket: options.ticket } : {}),
  };
  const before = sale.items.map((i) => `${i.quantity}x ${i.name}`).join(", ");
  const after = updated.items.map((i) => `${i.quantity}x ${i.name}`).join(", ");
  try {
    correctInventoryForOrder(updated, `equivalencia corregida por ${options.by}`);
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "No se pudo corregir el inventario." };
  }
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders.map((o) => (Number(o.id) === Number(saleId) ? updated : o))));
  window.dispatchEvent(new CustomEvent("bpos:orders-updated", { detail: { orderId: sale.id, source: "bridge" } }));
  warnMissingChoices(updated);
  return { success: true as const, sale: updated, before, after, previousTotal: sale.total };
}

export function createAutomaticSale(
  payload: SaleReadyPayload,
  options: { receivedAt?: string; ticket?: DeliveryTicket; bridgeKey?: string } = {}
): AutomaticSaleResult {
  if (typeof window === "undefined") {
    return {
      success: false,
      duplicate: false,
      error: "La venta automática solo puede crearse en el navegador.",
    };
  }

  if (!payload?.readyForSale || !payload.externalOrderKey) {
    return {
      success: false,
      duplicate: false,
      error: "El pedido no está preparado para venta.",
    };
  }

  const activeShift = localStorage.getItem(SHIFT_KEY);
  if (!activeShift) {
    return {
      success: false,
      duplicate: false,
      error: "La caja está cerrada. Abre turno para crear ventas automáticas.",
    };
  }

  const orders = readOrders();
  const incomingAt = Date.parse(options.receivedAt || "") || Date.now();
  const duplicate = orders.find(
    (order) =>
      order.externalOrderKey === payload.externalOrderKey &&
      isSameSale(order as { bridgeKey?: string; createdAt?: string; externalOrderKey?: string }, { bridgeKey: options.bridgeKey, at: incomingAt, platform: payload.platform })
  );

  if (duplicate) {
    return {
      success: true,
      duplicate: true,
      orderId: duplicate.id,
      order: duplicate,
    };
  }

  const built = buildSaleItems(payload, options.ticket);
  if ("error" in built) return { success: false, duplicate: false, error: built.error };
  const items = built.items;

  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.price || 0) * item.quantity,
    0
  );
  const id = nextOrderId(orders);
  let sequence;
  try {
    sequence = allocateShiftOrderNumber();
  } catch (error) {
    return {
      success: false,
      duplicate: false,
      error: error instanceof Error ? error.message : "No se pudo generar el folio del turno.",
    };
  }
  const label = platformLabel(payload.platform);
  // La venta lleva la hora real del pedido (no la de cuando se equivaló)
  const received = Date.parse(options.receivedAt || "");
  const createdAt = Number.isFinite(received) && received <= Date.now() ? new Date(received).toISOString() : new Date().toISOString();
  const late = Date.now() - Date.parse(createdAt) > LATE_SALE_MS;

  const order: AutomaticSaleOrder = {
    id,
    localOrderNumber: sequence.localOrderNumber,
    shiftSessionId: sequence.shiftSessionId,
    createdAt,
    items,
    details: {
      orderType: label,
      customerName: payload.customer?.name || "Cliente de plataforma",
      customerPhone: payload.customer?.phone || "",
      customerAddress: payload.delivery?.address || "",
      paymentMethod: label,
      discount: 0,
    },
    subtotal,
    total: subtotal,
    source: "B-POS Bridge",
    externalOrderNumber: payload.externalOrderId,
    externalOrderKey: payload.externalOrderKey,
    ...(options.bridgeKey ? { bridgeKey: options.bridgeKey } : {}),
    externalPlatform: payload.platform,
    externalTotal: Number(payload.externalTotal || 0),
    externalRawText: String(payload.rawText || ""),
    kdsTicketLines: Array.isArray(payload.kdsTicketLines) ? payload.kdsTicketLines : [],
    bridgeActions: {
      inventoryAdjustments: payload.inventoryAdjustments,
      ignoredLines: payload.ignoredLines,
    },
    status: late ? "Entregado" : "Nuevo",
    kdsReleased: true,
    kdsReleasedAt: new Date().toISOString(),
    kdsCompleted: late,
    ...(late ? { kdsCompletedAt: new Date().toISOString() } : {}),
    ...(options.ticket ? { deliveryTicket: options.ticket } : {}),
  };

  try {
    localStorage.setItem(ORDERS_KEY, JSON.stringify([...orders, order]));
    const storedOrders = readOrders();
    const released = storedOrders.some(
      (stored) => stored.id === order.id && stored.kdsReleased === true
    );
    if (!released) {
      throw new Error("La venta se guardó, pero no quedó liberada al KDS.");
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo enviar la venta al KDS.";
    createKdsCriticalError({ orderId: order.id, message });
    return { success: false, duplicate: false, error: message };
  }

  // Los tickets de estación y de bolsa ya los imprimió el Bridge (tickets propios); aquí no se generan comandas.

  // Bloque 4: usa el mismo motor de inventario que las ventas normales.
  // La protección por externalOrderKey evita descuentos duplicados.
  const inventoryResult = applyInventoryForOrder(order);
  if (!inventoryResult.success) {
    console.error("Venta creada, pero inventario pendiente:", inventoryResult.error);
  }
  warnMissingChoices(order);

  window.dispatchEvent(
    new CustomEvent("bpos:orders-updated", {
      detail: { orderId: order.id, source: "bridge" },
    })
  );
  notifyKdsUpdated(order.id);

  return {
    success: true,
    duplicate: false,
    orderId: order.id,
    order,
  };
}
