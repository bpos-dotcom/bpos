"use client";

import { addAuditEvent } from "@/lib/audit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CartItem, CartPanel, cartLineId } from "@/components/CartPanel";
import { ComboChoiceModal } from "@/components/ComboChoiceModal";
import { buildSelection, extrasPrice, lineIdFor, needsChoices } from "@/lib/compound";
import { getBusinessSettings } from "@/lib/business-settings";
import { CheckoutModal, type CheckoutResult, type SplitLine } from "@/components/CheckoutModal";
import { methodLabel, sumPayments } from "@/lib/sale-payments";
import { markInventoryApplied } from "@/lib/inventory";
import {
  OrderDetails,
  OrderDetailsPanel,
} from "@/components/OrderDetailsPanel";
import {
  OrderHistoryPanel,
  SavedOrder,
} from "@/components/OrderHistoryPanel";
import { ProductCard } from "@/components/ProductCard";
import { isOnSale, scheduleLabel } from "@/lib/sale-schedule";
import { Product } from "@/data/products";
import { getAdminProducts } from "@/lib/admin";
import { DIGITAL_MENU_EVENT, getDigitalMenu, sortCategories } from "@/lib/digital-menu";
import { getCurrentUser, CurrentUser } from "@/lib/auth";
import { requirePermissionOrAdmin } from "@/lib/permissions";
import { printSale, saleStations } from "@/lib/bridge/sale-tickets";
import { discountInventoryByOrder } from "@/lib/inventory";
import { checkCoupon, countCouponUse } from "@/lib/coupons";
import { ClubPanel } from "@/components/club/ClubPanel";
import { getLoyalty } from "@/lib/loyalty";
import { earnLoyalty, findMembers, redeemLoyalty, type ClubMember } from "@/lib/loyalty-pos";
import { BackButton } from "@/components/layout/BackButton";
import { TablesModal } from "@/components/pos/TablesModal";
import { getTables, openTableOrder, TABLES_EVENT, tableLabel, type Table } from "@/lib/tables";
import { notifyKdsUpdated } from "@/lib/kds";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopCorner } from "@/components/layout/TopCorner";
import RequirePermission from "@/components/auth/RequirePermission";
import { cancelSale, isCancelled } from "@/lib/sale-cancel";
import { useTerminalCharge } from "@/components/payments/TerminalCharge";
import { branchUsesTerminal } from "@/lib/mp/client";
import { DispatchModal } from "@/components/delivery/DispatchModal";
import { assignDriverToSale, driverWhatsappLink, type DispatchInfo } from "@/lib/drivers";
import {
  allocateShiftOrderNumber,
  formatOrderNumber,
  getNextShiftOrderNumberPreview,
} from "@/lib/order-sequence";

const STORAGE_KEY = "bpos_orders";
const USERS_KEY = "bpos_users";

type SystemUser = {
  id: number;
  name: string;
  pin: string;
  role: "Cajero" | "Gerente" | "Admin";
  active: boolean;
};

const menuItems = [
  { label: "🛒 POS", href: "/pos" },
  { label: "👨‍🍳 Cocina KDS", href: "/cocina" },
  { label: "💵 Caja", href: "/caja" },
  { label: "📦 Inventario", href: "/inventario" },
  { label: "🛒 Compras", href: "/compras" },
  { label: "🌉 B-POS Bridge", href: "/bridge" },
  { label: "🖨️ Impresiones", href: "/impresiones" },
  { label: "⚙️ Configuración", href: "/configuracion" },
];

export default function Home() {
  return (
    <RequirePermission permission="pos.view">
      <PosScreen />
    </RequirePermission>
  );
}

function PosScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<SavedOrder[]>([]);
  const [currentUser, setCurrentUserState] = useState<CurrentUser | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("Todos");
  const [search, setSearch] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  /** Cuenta en espera que se está cobrando (abre el mismo cobro) */
  const [payingOrder, setPayingOrder] = useState<SavedOrder | null>(null);
  const [comboToChoose, setComboToChoose] = useState<Product | null>(null);
  const [, setShiftVersion] = useState(0);
  // Terminal Mercado Pago: con tarjeta, el monto se manda solo a la terminal
  const terminal = useTerminalCharge();
  // Pedido a domicilio cobrado: elegir repartidor
  const [dispatch, setDispatch] = useState<{ info: DispatchInfo; saleId: number } | null>(null);
  /** Socio del club elegido para esta venta */
  const [clubMember, setClubMember] = useState<ClubMember | null>(null);
  /** Último WhatsApp con el que se buscó socio (para no repetir) */
  const lookedUpPhone = useRef("");
  /** Mesas del restaurante (Configuración → Mesas) y la ventana para elegirlas */
  const [tables, setTables] = useState<Table[]>([]);
  const [tablesOpen, setTablesOpen] = useState(false);
  useEffect(() => {
    const sync = () => setTables(getTables());
    sync();
    window.addEventListener(TABLES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(TABLES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const [details, setDetails] = useState<OrderDetails>({
    orderType: "Mostrador",
    customerName: "",
    customerPhone: "",
    customerAddress: "",
    paymentMethod: "Efectivo",
    discount: 0,
  });

  useEffect(() => {
    setProducts(
      getAdminProducts().map((product) => ({
        ...product,
        station: product.station || "Cocina",
      }))
    );

    setCurrentUserState(getCurrentUser());

    const loadSavedOrders = () => {
      const savedOrders = localStorage.getItem(STORAGE_KEY);
      setOrders(savedOrders ? JSON.parse(savedOrders) : []);
    };

    loadSavedOrders();
    window.addEventListener("storage", loadSavedOrders);
    window.addEventListener("focus", loadSavedOrders);
    window.addEventListener("bpos:orders-updated", loadSavedOrders);
    const refreshShift = () => setShiftVersion((value) => value + 1);
    window.addEventListener("bpos:shift-updated", refreshShift);

    return () => {
      window.removeEventListener("storage", loadSavedOrders);
      window.removeEventListener("focus", loadSavedOrders);
      window.removeEventListener("bpos:orders-updated", loadSavedOrders);
      window.removeEventListener("bpos:shift-updated", refreshShift);
    };
  }, []);

  // Horario de venta: se revisa cada minuto (ej. promoción solo los viernes)
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const offSchedule = useCallback((product: Product) => (isOnSale(product.saleSchedule, new Date(clock)) ? "" : scheduleLabel(product.saleSchedule)), [clock]);

  // Lo que no se vende por separado no aparece en el menú (sí sirve dentro de combos)
  const sellable = useMemo(() => products.filter((product) => !product.notSoldAlone), [products]);

  // Orden de categorías que acomodó el negocio (Configuración → Menú digital)
  const [categoryOrder, setCategoryOrder] = useState<string[]>(() => getDigitalMenu().categoryOrder);
  useEffect(() => {
    const sync = () => setCategoryOrder(getDigitalMenu().categoryOrder);
    window.addEventListener(DIGITAL_MENU_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(DIGITAL_MENU_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const categories = useMemo(() => {
    return ["Todos", ...sortCategories(Array.from(new Set(sellable.map((p) => p.category))), categoryOrder)];
  }, [sellable, categoryOrder]);

  const filteredProducts = useMemo(() => {
    return sellable.filter((product) => {
      const matchesCategory =
        selectedCategory === "Todos" || product.category === selectedCategory;

      const matchesSearch = product.name
        .toLowerCase()
        .includes(search.toLowerCase());

      return matchesCategory && matchesSearch;
    });
  }, [sellable, selectedCategory, search]);

  const subtotal = cart.reduce(
    (total, item) => total + item.price * item.quantity,
    0
  );

  // Al escribir un WhatsApp de 10 dígitos en Detalles, se busca al socio del club y se enrola solo
  const phoneDigits = details.customerPhone.replace(/D/g, "");
  useEffect(() => {
    if (clubMember || phoneDigits.length !== 10 || lookedUpPhone.current === phoneDigits) return;
    lookedUpPhone.current = phoneDigits;
    let alive = true;
    const t = window.setTimeout(async () => {
      try {
        const found = await findMembers(phoneDigits);
        const m = found.find((x) => x.member && x.phone.replace(/D/g, "").endsWith(phoneDigits));
        if (alive && m) setClubMember(m);
      } catch {
        // sin internet: se puede buscar a mano en el Club
      }
    }, 600);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [phoneDigits, clubMember]);

  const requiresDeliveryData =
    details.orderType === "Domicilio" || details.orderType === "WhatsApp";

  // La dirección se pide al cobrar (solo a domicilio)
  const hasRequiredDetails =
    cart.length > 0 &&
    details.customerName.trim() !== "" &&
    details.orderType.trim() !== "" &&
    (!requiresDeliveryData || details.customerPhone.trim() !== "");

  const validationMessage =
    cart.length === 0
      ? "Agrega productos al pedido para cobrar."
      : details.customerName.trim() === ""
      ? "Captura el nombre del cliente."
      : requiresDeliveryData
      ? "Captura el WhatsApp del cliente."
      : "Completa los detalles del pedido.";

  function saveOrders(nextOrders: SavedOrder[]) {
    setOrders(nextOrders);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextOrders));
  }

  /** Mesa libre elegida: el pedido queda como Mesa (comer aquí) y se regresa a los productos */
  function openTable(table: Table, diners: number) {
    setDetails((d) => ({
      ...d,
      orderType: "Mesa",
      table: { id: table.id, name: table.name, zone: table.zone },
      diners,
      customerName: d.customerName.trim() || `Mesa ${table.name}`,
    }));
    setTablesOpen(false);
    document.getElementById("productos")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** Mesa con cuenta abierta: lo que se marque ahora se manda como otra ronda a esa cuenta */
  function startRound(order: SavedOrder, table: Table) {
    setDetails((d) => ({
      ...d,
      orderType: "Mesa",
      table: { id: table.id, name: table.name, zone: table.zone },
      diners: order.details.diners,
      customerName: order.details.customerName || `Mesa ${table.name}`,
    }));
    setTablesOpen(false);
    document.getElementById("productos")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** Otra ronda a una cuenta de mesa: solo lo nuevo va a cocina; el total crece */
  function appendRound(order: SavedOrder) {
    const round = (order.rounds || 1) + 1;
    const newItems: CartItem[] = cart.map((item) => ({ ...item, round }));
    const items: CartItem[] = [...order.items.map((item) => ({ ...item, kdsDone: true })), ...newItems];
    const nextSubtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const updated = {
      ...order,
      items,
      subtotal: nextSubtotal,
      total: Math.max(0, nextSubtotal - (order.details.discount || 0)) + (order.details.deliveryFee || 0),
      rounds: round,
      // Vuelve a aparecer en cocina como nuevo, solo con lo de esta ronda
      kdsCompleted: false,
      kdsCompletedAt: undefined,
      status: "Nuevo",
    } as SavedOrder;
    saveOrders(orders.map((o) => (o.id === order.id ? updated : o)));
    window.dispatchEvent(new Event("bpos:orders-updated"));
    notifyKdsUpdated(order.id);
    discountInventoryByOrder(`${order.id}-r${round}`, cart);
    void printSale({ ...updated, items: newItems }, { stations: saleStations({ ...updated, items: newItems }), customer: false }, true)
      .then((failed) => {
        if (failed.length) alert(`Ronda mandada, pero no salió en: ${failed.join(" · ")}. Reimprime desde Impresiones.`);
      })
      .catch(() => alert("Ronda guardada, pero B-POS no pudo imprimir. Revisa que B-POS Agent esté conectado."));
    addAuditEvent({ category: "Venta", action: "sale.round", description: `${currentUser?.name || "Usuario"} mandó la ronda ${round} de ${tableLabel(order.details.table)} (Pedido #${formatOrderNumber(updated as SavedOrder & { localOrderNumber?: number })}): ${cart.map((i) => `${i.quantity}x ${i.name}`).join(", ")}`, userId: currentUser?.id ? String(currentUser.id) : undefined, userName: currentUser?.name, entityId: String(order.id), metadata: { round, total: updated.total } });
    alert(`Ronda ${round} de ${tableLabel(order.details.table)} mandada a cocina. Total de la mesa: $${updated.total.toFixed(2)}.`);
    setCart([]);
    setDetails({ orderType: "Mostrador", customerName: "", customerPhone: "", customerAddress: "", paymentMethod: "Efectivo", discount: 0 });
  }

  /** Precuenta de una mesa: el ticket del cliente marcado PRECUENTA, sin cobrar */
  function printPrecuenta(order: SavedOrder) {
    void printSale({ ...order, details: { ...order.details, precuenta: true } }, { stations: [], customer: true }, true)
      .then((failed) => {
        if (failed.length) alert(`No salió la precuenta: ${failed.join(" · ")}`);
      })
      .catch(() => alert("No se pudo imprimir la precuenta. Revisa que B-POS Agent esté conectado."));
    setTablesOpen(false);
  }

  const openTables = tables.filter((t) => t.active && openTableOrder(orders, t.id)).length;

  function authorizeAdmin(action: string) {
    return requirePermissionOrAdmin(currentUser, "pos.discount", action);
  }

  // Combos con algo a elegir (ej. el refresco) y productos con opciones (aderezo, salsas) preguntan antes de agregarse
  function addToCart(product: Product) {
    if (!isOnSale(product.saleSchedule)) {
      alert(`${product.name} solo se vende: ${scheduleLabel(product.saleSchedule)}.`);
      return;
    }
    if (needsChoices(product, products)) {
      setComboToChoose(product);
      return;
    }
    addLine(product, buildSelection(product, products));
  }

  // El precio del renglón ya incluye lo que cuestan las opciones elegidas
  function addLine(product: Product, { parts, modifiers, ownTicket, comment, extraStations }: Pick<CartItem, "parts" | "modifiers" | "ownTicket" | "comment" | "extraStations">) {
    // Con otro comentario es otro renglón (cada uno sale con su nota en la comanda)
    const lineId = lineIdFor(product.id, parts, modifiers) + (comment ? `|c:${comment}` : "");
    const price = product.price + extrasPrice(modifiers, parts);
    setCart((currentCart) => {
      const existingItem = currentCart.find((item) => cartLineId(item) === lineId);

      if (existingItem) {
        return currentCart.map((item) =>
          cartLineId(item) === lineId
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [
        ...currentCart,
        { ...product, price, quantity: 1, lineId, ...(parts?.length ? { parts, ownTicket } : {}), ...(modifiers?.length ? { modifiers } : {}), ...(comment ? { comment } : {}), ...(extraStations?.length ? { extraStations } : {}) },
      ];
    });
  }

  // Comentario de un renglón ya en el carrito (vacío lo quita)
  function setLineComment(lineId: string, comment: string) {
    setCart((currentCart) =>
      currentCart.map((item) => {
        if (cartLineId(item) !== lineId) return item;
        const next = { ...item, comment: comment.trim() || undefined };
        if (!next.comment) delete next.comment;
        return next;
      })
    );
  }

  function increaseQuantity(lineId: string) {
    setCart((currentCart) =>
      currentCart.map((item) =>
        cartLineId(item) === lineId ? { ...item, quantity: item.quantity + 1 } : item
      )
    );
  }

  function decreaseQuantity(lineId: string) {
    setCart((currentCart) =>
      currentCart
        .map((item) =>
          cartLineId(item) === lineId ? { ...item, quantity: item.quantity - 1 } : item
        )
        .filter((item) => item.quantity > 0)
    );
  }

  async function clearCart() {
    if (cart.length === 0) return;

    if (currentUser?.role !== "Admin") {
      const authorized = await authorizeAdmin("limpiar pedido");
      if (!authorized) return;
    }

    setCart([]);
  }

  function openCheckout() {
    const activeShift = localStorage.getItem("bpos_active_shift");

    if (!activeShift) {
      alert("Primero debes abrir la caja antes de cobrar.");
      window.location.href = "/caja";
      return;
    }

    if (!hasRequiredDetails) {
      alert(validationMessage);
      return;
    }

    setCheckoutOpen(true);
  }

  /**
   * Cuenta en espera: se manda a cocina ya y se cobra después. A domicilio
   * se abre el cobro para capturar dirección y repartidor (ahí está el botón
   * de mandar a preparar); los demás tipos se guardan directo.
   */
  function holdOrder() {
    if (!localStorage.getItem("bpos_active_shift")) {
      alert("Primero debes abrir la caja.");
      window.location.href = "/caja";
      return;
    }
    if (!hasRequiredDetails) {
      alert(validationMessage);
      return;
    }
    if (details.orderType === "Domicilio") {
      setCheckoutOpen(true);
      return;
    }
    // Mesa con cuenta abierta: es otra ronda de esa cuenta
    if (details.orderType === "Mesa" && details.table) {
      const open = openTableOrder(orders, details.table.id);
      if (open) {
        appendRound(open);
        return;
      }
    }
    void confirmCheckout({ paymentMethod: "Por cobrar", cashReceived: 0, cardAmount: 0, transferAmount: 0, discount: 0, pending: true, payments: {}, tip: 0, tipPayments: {} });
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const money = (n: number) => `$${n.toFixed(2)}`;
  const folio = (o: SavedOrder) => formatOrderNumber(o as SavedOrder & { localOrderNumber?: number });
  const nameOf = (o: SavedOrder) => (o.details.table ? tableLabel(o.details.table, o.details.diners) : `Pedido #${folio(o)}`);
  /** Lo que falta por pagar de una cuenta en espera (ya descontado lo que pagaron entre personas) */
  const remainingOf = (o: SavedOrder) => Math.max(0, round2(o.total - (o.partialPayments || []).reduce((s, p) => s + p.amount, 0)));
  /** Renglones de la cuenta para dividir por productos */
  const splitLinesOf = (o: SavedOrder): SplitLine[] => o.items.map((item, i) => ({ key: item.lineId || `${item.id}-${i}`, name: item.name, price: item.price, quantity: item.quantity }));

  /** Cierra una cuenta en espera como pagada: ticket, club, bitácora */
  function finalizePending(order: SavedOrder, pay: { payments: Record<string, number>; tip: number; tipPayments: Record<string, number>; partialPayments?: SavedOrder["partialPayments"]; couponCode?: string }) {
    const paid: SavedOrder = {
      ...order,
      pendingPayment: false,
      paidAt: new Date().toISOString(),
      tip: pay.tip,
      tipPayments: pay.tipPayments,
      ...(pay.partialPayments ? { partialPayments: pay.partialPayments } : {}),
      details: { ...order.details, paymentMethod: methodLabel(pay.payments), payments: pay.payments, ...(pay.couponCode ? { couponCode: pay.couponCode } : {}) },
    };
    saveOrders(orders.map((o) => (o.id === order.id ? paid : o)));
    if (pay.couponCode) countCouponUse(pay.couponCode);
    if (order.clubAccountId) {
      void earnLoyalty(order.clubAccountId, paid.total, `pos:${(order as SavedOrder & { shiftSessionId?: string }).shiftSessionId || ""}:${order.id}`, currentUser?.name || "").catch((e) =>
        alert(`Cobrado, pero no se pudo sumar al club: ${e instanceof Error ? e.message : "sin internet"}`)
      );
    }
    addAuditEvent({ category: "Venta", action: "sale.paid", description: `${currentUser?.name || "Usuario"} cobró ${nameOf(paid)} (Pedido #${folio(paid)}: ${money(paid.total)}, ${paid.details.paymentMethod}${pay.tip > 0 ? `, propina ${money(pay.tip)}` : ""})`, userId: currentUser?.id ? String(currentUser.id) : undefined, userName: currentUser?.name, entityId: String(order.id), metadata: { total: paid.total, paymentMethod: paid.details.paymentMethod, payments: pay.payments, tip: pay.tip } });
    // Ticket del cliente ya con el pago
    void printSale(paid, { stations: [], customer: true }, true).catch(() => undefined);
    setPayingOrder(null);
    alert(`${nameOf(paid)} cobrada: ${money(paid.total)}${pay.tip > 0 ? ` + ${money(pay.tip)} de propina` : ""}.`);
  }

  /**
   * Cobro de una cuenta en espera o de mesa: completa, por productos (cada
   * parte es su propia venta) o entre personas (se va juntando hasta cubrir
   * el total). Mismo cobro del POS: efectivo, tarjeta, mixto, cupón, club, propina.
   */
  async function payPending(data: CheckoutResult) {
    const order = payingOrder;
    if (!order) return;
    if (data.pending) {
      setPayingOrder(null);
      return;
    }
    const discount = Math.max(0, Number(data.discount) || 0);
    if (discount > 0 && !(await requirePermissionOrAdmin(currentUser, "pos.discount", "aplicar descuento"))) return;
    const cardPart = round2((data.payments.Tarjeta || 0) + (data.tipPayments.Tarjeta || 0));
    if (cardPart > 0 && (await branchUsesTerminal())) {
      const result = await terminal.charge(cardPart, `Pedido ${folio(order)}`);
      if (result === "cancelled") return;
    }
    const now = new Date().toISOString();
    const by = currentUser?.name || "";

    // --- Por productos: lo marcado se cobra como una venta aparte; el resto sigue en la cuenta ---
    if (data.splitItems?.length) {
      const wanted = new Map(data.splitItems.map((s) => [s.key, s.quantity]));
      const taken: CartItem[] = [];
      const left: CartItem[] = [];
      splitLinesOf(order).forEach((line, i) => {
        const item = order.items[i];
        const q = Math.min(item.quantity, wanted.get(line.key) || 0);
        if (q > 0) taken.push({ ...item, quantity: q });
        if (item.quantity - q > 0) left.push({ ...item, quantity: item.quantity - q });
      });
      if (left.length > 0 && taken.length > 0) {
        let sequence;
        try {
          sequence = allocateShiftOrderNumber();
        } catch (error) {
          alert(error instanceof Error ? error.message : "No se pudo generar el folio del turno.");
          return;
        }
        const partSubtotal = round2(taken.reduce((s, i) => s + i.price * i.quantity, 0));
        const part = {
          id: nextGlobalOrderId(),
          localOrderNumber: sequence.localOrderNumber,
          shiftSessionId: sequence.shiftSessionId,
          createdAt: now,
          items: taken,
          details: { ...order.details, paymentMethod: methodLabel(data.payments), payments: data.payments, discount, ...(data.couponCode ? { couponCode: data.couponCode } : {}) },
          subtotal: partSubtotal,
          total: Math.max(0, round2(partSubtotal - discount)),
          paidAt: now,
          splitFrom: order.id,
          tip: data.tip,
          tipPayments: data.tipPayments,
          // Ya se preparó con la cuenta original: no vuelve a cocina ni descuenta inventario
          kdsCompleted: true,
        } as SavedOrder;
        markInventoryApplied(part.id);
        const leftSubtotal = round2(left.reduce((s, i) => s + i.price * i.quantity, 0));
        const rest: SavedOrder = { ...order, items: left, subtotal: leftSubtotal, total: Math.max(0, round2(leftSubtotal - (order.details.discount || 0) + (order.details.deliveryFee || 0))) };
        saveOrders([...orders.map((o) => (o.id === order.id ? rest : o)), part]);
        if (data.couponCode) countCouponUse(data.couponCode);
        addAuditEvent({ category: "Venta", action: "sale.paid", description: `${by || "Usuario"} cobró parte de ${nameOf(order)} como Pedido #${folio(part)} (${money(part.total)}, ${part.details.paymentMethod}): ${taken.map((i) => `${i.quantity}x ${i.name}`).join(", ")}`, userId: currentUser?.id ? String(currentUser.id) : undefined, userName: by, entityId: String(part.id), metadata: { splitFrom: order.id, total: part.total, payments: data.payments, tip: data.tip } });
        void printSale(part, { stations: [], customer: true }, true).catch(() => undefined);
        setPayingOrder(rest);
        alert(`Cobrados ${money(part.total)}${data.tip > 0 ? ` + ${money(data.tip)} de propina` : ""} (Pedido #${folio(part)}). Quedan ${money(rest.total)} en ${nameOf(rest)}.`);
        return;
      }
      // Marcó todo: es el cobro completo
    }

    const withDiscount: SavedOrder = {
      ...order,
      total: Math.max(0, round2(order.total - discount)),
      details: { ...order.details, discount: (order.details.discount || 0) + discount },
    };

    // --- Entre personas: se junta parte por parte hasta cubrir el total ---
    const previous = order.partialPayments || [];
    if (data.splitAmount !== undefined || previous.length) {
      const amount = round2(Object.values(data.payments).reduce((s, v) => s + v, 0));
      const partials = [...previous, { amount, tip: data.tip, method: methodLabel(data.payments), payments: data.payments, tipPayments: data.tipPayments, at: now, by }];
      const paidSum = round2(partials.reduce((s, p) => s + p.amount, 0));
      if (paidSum < withDiscount.total - 0.01) {
        const updated: SavedOrder = { ...withDiscount, partialPayments: partials, ...(data.couponCode ? { details: { ...withDiscount.details, couponCode: data.couponCode } } : {}) };
        saveOrders(orders.map((o) => (o.id === order.id ? updated : o)));
        if (data.couponCode) countCouponUse(data.couponCode);
        addAuditEvent({ category: "Venta", action: "sale.paid", description: `${by || "Usuario"} cobró la parte ${partials.length} de ${nameOf(order)}: ${money(amount)} (${data.paymentMethod}). Faltan ${money(withDiscount.total - paidSum)}.`, userId: currentUser?.id ? String(currentUser.id) : undefined, userName: by, entityId: String(order.id), metadata: { part: partials.length, amount, payments: data.payments, tip: data.tip } });
        setPayingOrder(updated);
        alert(`Parte ${partials.length} cobrada: ${money(amount)}${data.tip > 0 ? ` + ${money(data.tip)} de propina` : ""}. Faltan ${money(withDiscount.total - paidSum)}.`);
        return;
      }
      finalizePending(withDiscount, {
        payments: sumPayments(partials.map((p) => p.payments)),
        tip: round2(partials.reduce((s, p) => s + p.tip, 0)),
        tipPayments: sumPayments(partials.map((p) => p.tipPayments)),
        partialPayments: partials,
        couponCode: data.couponCode,
      });
      return;
    }

    // --- Todo de una vez ---
    finalizePending(withDiscount, { payments: data.payments, tip: data.tip, tipPayments: data.tipPayments, couponCode: data.couponCode });
  }

  function nextGlobalOrderId() {
    return orders.reduce(
      (max, order) => Math.max(max, Number(order.id) || 0),
      0
    ) + 1;
  }

  async function confirmCheckout(data: CheckoutResult) {
    // El descuento de un cupón vigente no pide autorización (se revisa otra vez aquí)
    const coupon = data.couponCode ? checkCoupon(data.couponCode, subtotal, "pos") : null;
    if (coupon && !coupon.ok) {
      alert(coupon.error);
      return;
    }
    // El saldo del club que usa el socio tampoco pide autorización
    const clubCash = clubMember?.member ? Math.min(Math.max(0, data.clubCashback || 0), clubMember.cashback) : 0;
    const otherDiscount = Math.max(0, data.discount - clubCash);
    const byCoupon = Boolean(coupon?.ok && Math.abs(coupon.discount - otherDiscount) < 0.01);
    if (otherDiscount > 0 && !byCoupon && !(await requirePermissionOrAdmin(currentUser, "pos.discount", "aplicar descuento"))) return;

    const deliveryFee = Math.max(0, data.deliveryFee || 0);
    const total = Math.max(subtotal - data.discount, 0) + deliveryFee;

    // Con terminal vinculada, la parte con tarjeta (venta + propina) se cobra primero en la terminal
    const cardPart = round2((data.payments.Tarjeta || 0) + (data.tipPayments.Tarjeta || 0));
    if (!data.pending && cardPart > 0 && (await branchUsesTerminal())) {
      const result = await terminal.charge(cardPart, `Pedido ${getNextShiftOrderNumberPreview()}`);
      if (result === "cancelled") return;
    }

    const nextDetails: OrderDetails = {
      ...details,
      paymentMethod: data.paymentMethod,
      discount: data.discount,
      ...(data.address !== undefined ? { customerAddress: data.address } : {}),
      ...(deliveryFee > 0 ? { deliveryFee } : {}),
      ...(byCoupon && data.couponCode ? { couponCode: data.couponCode } : {}),
      // Cuánto entró con cada método (pago mixto); en espera todavía no hay pago
      ...(!data.pending && Object.keys(data.payments).length ? { payments: data.payments } : {}),
      // Con socio del club: sus datos quedan en la venta (Clientes)
      ...(clubMember && !details.customerName ? { customerName: clubMember.name } : {}),
      ...(clubMember && !details.customerPhone ? { customerPhone: clubMember.phone } : {}),
    };

    let sequence;
    try {
      sequence = allocateShiftOrderNumber();
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo generar el folio del turno.");
      return;
    }

    const newOrder = {
      id: nextGlobalOrderId(),
      localOrderNumber: sequence.localOrderNumber,
      shiftSessionId: sequence.shiftSessionId,
      createdAt: new Date().toISOString(),
      items: cart,
      details: nextDetails,
      subtotal,
      total,
      // En espera: queda "por cobrar"; el club se le suma cuando pague
      ...(data.pending ? { pendingPayment: true, ...(clubMember?.member ? { clubAccountId: clubMember.account_id } : {}) } : { paidAt: new Date().toISOString(), tip: data.tip, tipPayments: data.tipPayments }),
      ...(nextDetails.table ? { rounds: 1 } : {}),
    } as SavedOrder & { localOrderNumber: number; shiftSessionId: string };

    saveOrders([...orders, newOrder]);
    if (nextDetails.couponCode) countCouponUse(nextDetails.couponCode);
    // Club: primero el saldo que usó, luego lo que gana por esta venta
    if (clubMember?.member) {
      const ref = `pos:${sequence.shiftSessionId}:${newOrder.id}`;
      const member = clubMember;
      void (async () => {
        try {
          if (clubCash > 0) await redeemLoyalty(member.account_id, { cashback: clubCash }, `Saldo usado en Pedido #${formatOrderNumber(newOrder)}`, ref, currentUser?.name || "");
          if (!data.pending) await earnLoyalty(member.account_id, total, ref, currentUser?.name || "");
        } catch (e) {
          alert(`Venta cobrada, pero no se pudo sumar al club: ${e instanceof Error ? e.message : "sin internet"}`);
        }
      })();
    }
    discountInventoryByOrder(newOrder.id, cart);
    // Comandas por estación y ticket del cliente en Caja, directo a las térmicas
    void printSale(newOrder, { stations: saleStations(newOrder), customer: true }, false)
      .then((failed) => {
        if (failed.length) alert(`${data.pending ? "Pedido mandado a espera" : "Pedido cobrado"}, pero no salió en: ${failed.join(" · ")}. Revisa Configuración → Impresoras o reimprime desde Impresiones.`);
      })
      .catch(() => alert(`${data.pending ? "Pedido mandado a espera" : "Pedido cobrado"}, pero B-POS no pudo imprimir. Revisa que B-POS Agent esté conectado en la computadora de las impresoras y reimprime desde Impresiones.`));
    addAuditEvent({ category: "Venta", action: "sale.created", description: `${currentUser?.name || "Usuario"} creó Pedido #${formatOrderNumber(newOrder)} por $${total.toFixed(2)}`, userId: currentUser?.id ? String(currentUser.id) : undefined, userName: currentUser?.name, entityId: String(newOrder.id), metadata: { total, paymentMethod: data.paymentMethod, discount: data.discount, shiftSessionId: sequence.shiftSessionId } });

    alert(
      data.pending
        ? nextDetails.table
          ? `${tableLabel(nextDetails.table, nextDetails.diners)} abierta (Pedido #${formatOrderNumber(newOrder)}). Ya está en cocina; desde Mesas agregas rondas, sacas la precuenta o cobras.`
          : `Pedido #${formatOrderNumber(newOrder)} mandado a cocina. Queda en Cuentas en espera para cobrarlo${nextDetails.orderType === "Domicilio" ? " cuando regrese el repartidor" : ""}.`
        : `Pedido #${formatOrderNumber(newOrder)} cobrado correctamente.`
    );

    if (nextDetails.orderType === "Domicilio") {
      const info: DispatchInfo = {
          title: `Pedido #${formatOrderNumber(newOrder)}`,
          businessName: getBusinessSettings().businessName,
          customer: { name: nextDetails.customerName, phone: nextDetails.customerPhone, address: nextDetails.customerAddress },
          lines: cart.map((i) => ({ quantity: i.quantity, name: i.name, detail: [...(i.parts || []).map((p) => p.name), ...(i.modifiers || []).filter((m) => !m.extra).map((m) => m.name), i.comment].filter(Boolean).join(" · ") || undefined })),
          total,
          payment: data.pending ? { paid: false, method: data.paymentMethod, amount: total } : { paid: true, method: data.paymentMethod },
      };
      if (data.driver) {
        // Repartidor elegido al cobrar: se le manda el pedido por WhatsApp de una vez
        assignDriverToSale(newOrder.id, data.driver);
        const link = driverWhatsappLink(data.driver, info);
        if (link) window.open(link, "_blank");
      } else {
        setDispatch({ saleId: newOrder.id, info });
      }
    }

    // printTicket(newOrder);

    setCheckoutOpen(false);
    setCart([]);
    setClubMember(null);
    setDetails({
      orderType: "Mostrador",
      customerName: "",
      customerPhone: "",
      customerAddress: "",
      paymentMethod: "Efectivo",
      discount: 0,
    });
  }

  // Las ventas ya no se borran: se cancelan con motivo y quedan guardadas (y en la bitácora)
  async function deleteOrder(id: number) {
    const order = orders.find((o) => o.id === id);
    if (!order || isCancelled(order)) return;
    if (!(await requirePermissionOrAdmin(currentUser, "pos.cancel", "cancelar una venta"))) return;

    const reason = prompt(`Motivo para cancelar el pedido #${formatOrderNumber(order)}:`);
    if (reason === null) return;
    if (!reason.trim()) {
      alert("El motivo es obligatorio para cancelar una venta.");
      return;
    }

    const by = currentUser?.name || "Usuario";
    saveOrders(orders.map((o) => (o.id === id ? cancelSale(o, reason, by) : o)));
    addAuditEvent({
      category: "Venta",
      action: "sale.cancelled",
      description: `${by} canceló el Pedido #${formatOrderNumber(order)} por $${order.total.toFixed(2)}: ${reason.trim()}`,
      userId: currentUser?.id ? String(currentUser.id) : undefined,
      userName: by,
      entityId: String(order.id),
      metadata: { total: order.total, reason: reason.trim() },
    });
  }

  function logout() {
    localStorage.removeItem("bpos_current_user");
    window.location.href = "/login";
  }

  /** Pedido en espera: el repartidor ya trajo el dinero */
  function markPaid(order: SavedOrder, method: string) {
    if (!confirm(`¿Pedido #${formatOrderNumber(order as SavedOrder & { localOrderNumber?: number })} pagado con ${method.toLowerCase()} por ${order.total.toFixed(2)}?`)) return;
    const paid: SavedOrder = { ...order, pendingPayment: false, paidAt: new Date().toISOString(), details: { ...order.details, paymentMethod: method } };
    saveOrders(orders.map((o) => (o.id === order.id ? paid : o)));
    if (order.clubAccountId) {
      void earnLoyalty(order.clubAccountId, order.total, `pos:${(order as SavedOrder & { shiftSessionId?: string }).shiftSessionId || ""}:${order.id}`, currentUser?.name || "").catch((e) =>
        alert(`Cobrado, pero no se pudo sumar al club: ${e instanceof Error ? e.message : "sin internet"}`)
      );
    }
    addAuditEvent({ category: "Venta", action: "sale.paid", description: `${currentUser?.name || "Usuario"} cobró Pedido #${formatOrderNumber(paid as SavedOrder & { localOrderNumber?: number })} en espera (${order.total.toFixed(2)}, ${method})`, userId: currentUser?.id ? String(currentUser.id) : undefined, userName: currentUser?.name, entityId: String(order.id), metadata: { total: order.total, paymentMethod: method } });
  }

  function printTicket(order: SavedOrder) {
    const ticketWindow = window.open("", "_blank", "width=380,height=700");

    if (!ticketWindow) {
      alert("Permite ventanas emergentes para imprimir el ticket.");
      return;
    }

    const itemsHtml = order.items
      .map(
        (item) => `
          <div class="line">
            <span>${item.quantity} x ${item.name}</span>
            <strong>${(item.price * item.quantity).toFixed(2)}</strong>
          </div>${(item.parts || []).map((p) => `<div class="line"><span>&nbsp;&nbsp;» ${p.name}</span></div>`).join("")}
        `
      )
      .join("");

    ticketWindow.document.write(`
      <html>
        <head>
          <title>Ticket #${formatOrderNumber(order as SavedOrder & { localOrderNumber?: number })}</title>
          <style>
            body {
              font-family: monospace;
              width: 280px;
              margin: 0 auto;
              padding: 14px;
              color: #000;
            }

            .center { text-align: center; }
            .brand { font-size: 20px; font-weight: 900; }
            .line {
              display: flex;
              justify-content: space-between;
              gap: 10px;
              margin: 6px 0;
            }

            hr {
              border: none;
              border-top: 1px dashed #000;
              margin: 12px 0;
            }

            .total {
              font-size: 18px;
              font-weight: 900;
            }

            .small {
              font-size: 12px;
            }
          </style>
        </head>

        <body>
          <div class="center">
            <div class="brand">BURGER PLANET</div>
            <div>Ticket #${formatOrderNumber(order as SavedOrder & { localOrderNumber?: number })}</div>
            <div class="small">${new Date(order.createdAt).toLocaleString()}</div>
          </div>

          <hr />

          <div>Cliente: ${order.details.customerName || "Mostrador"}</div>
          <div>Tipo: ${order.details.orderType}</div>
          <div>Pago: ${order.details.paymentMethod}</div>
          ${
            order.details.customerPhone
              ? `<div>WhatsApp: ${order.details.customerPhone}</div>`
              : ""
          }
          ${
            order.details.customerAddress
              ? `<div>Dirección: ${order.details.customerAddress}</div>`
              : ""
          }

          <hr />

          ${itemsHtml}

          <hr />

          <div class="line">
            <span>Subtotal</span>
            <strong>$${order.subtotal.toFixed(2)}</strong>
          </div>

          <div class="line">
            <span>Descuento</span>
            <strong>-${order.details.discount.toFixed(2)}</strong>
          </div>
          ${order.details.deliveryFee ? `<div class="line"><span>Envío</span><strong>${order.details.deliveryFee.toFixed(2)}</strong></div>` : ""}
          ${order.pendingPayment ? `<div class="line"><strong>POR COBRAR</strong></div>` : ""}

          <div class="line total">
            <span>TOTAL</span>
            <strong>$${order.total.toFixed(2)}</strong>
          </div>

          <hr />

          <div class="center">
            Gracias por tu compra 🚀<br />
            WhatsApp: 5631820373
          </div>

          <script>
            window.print();
          </script>
        </body>
      </html>
    `);

    ticketWindow.document.close();
  }

  function sendWhatsapp(order: SavedOrder) {
    const rawPhone = order.details.customerPhone.trim();

    if (!rawPhone) {
      alert("Este pedido no tiene WhatsApp registrado.");
      return;
    }

    let phone = rawPhone.replace(/\D/g, "");

    if (phone.length === 10) {
      phone = `52${phone}`;
    }

    const items = order.items
      .map(
        (item) =>
          `• ${item.quantity} x ${item.name} - ${(
            item.price * item.quantity
          ).toFixed(2)}${item.parts?.length ? ` (${item.parts.map((p) => p.name).join(", ")})` : ""}`
      )
      .join("\n");

    const businessName = getBusinessSettings().businessName;
    const message = `🧾 *${businessName} - Ticket #${formatOrderNumber(
      order as SavedOrder & { localOrderNumber?: number }
    )}*

Hola ${order.details.customerName || "Cliente"}, este es tu pedido:

${items}

Subtotal: $${order.subtotal.toFixed(2)}
Descuento: -$${order.details.discount.toFixed(2)}
Total: *$${order.total.toFixed(2)}*

Tipo: ${order.details.orderType}
Pago: ${order.details.paymentMethod}

Gracias por pedir en ${businessName} 🚀`;

    window.open(
      `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
      "_blank"
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <CheckoutModal
        isOpen={checkoutOpen || Boolean(payingOrder)}
        total={payingOrder ? remainingOf(payingOrder) : subtotal}
        split={payingOrder ? { lines: splitLinesOf(payingOrder), fullTotal: payingOrder.total, partsPaid: (payingOrder.partialPayments || []).length } : undefined}
        clubCashback={!payingOrder && clubMember?.member && getLoyalty().kind === "cashback" ? clubMember.cashback : 0}
        onClose={() => {
          setCheckoutOpen(false);
          setPayingOrder(null);
        }}
        onConfirm={payingOrder ? payPending : confirmCheckout}
        delivery={!payingOrder && details.orderType === "Domicilio" ? { address: details.customerAddress } : undefined}
        heading={payingOrder ? `Cobrar ${payingOrder.details.table ? tableLabel(payingOrder.details.table, payingOrder.details.diners) : "cuenta en espera"} · #${folio(payingOrder)}` : undefined}
      />
      {terminal.modal}
      {dispatch && <DispatchModal info={dispatch.info} saleId={dispatch.saleId} onClose={() => setDispatch(null)} />}
      {tablesOpen && (
        <TablesModal
          tables={tables}
          orders={orders}
          currentTableId={details.table?.id}
          onClose={() => setTablesOpen(false)}
          onOpenTable={openTable}
          onAddRound={startRound}
          onPrecuenta={printPrecuenta}
          onPay={(order) => {
            setTablesOpen(false);
            setPayingOrder(order);
          }}
        />
      )}

      {comboToChoose && (
        <ComboChoiceModal
          product={comboToChoose}
          products={products}
          onClose={() => setComboToChoose(null)}
          onConfirm={(chosen) => {
            addLine(comboToChoose, chosen);
            setComboToChoose(null);
          }}
        />
      )}

      <Sidebar />

      <section className="bpos-main overflow-x-hidden">
        {/* Barra delgada: Volver y datos del turno a la izquierda, tema/hora/logo a la derecha. No se queda fija: se va al bajar. */}
        <header className="border-b border-zinc-800 bg-black px-3 py-1.5 sm:px-6">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <BackButton className="h-10 w-10 text-xl" />
              <TopStatus title="Caja" value="Abierta" detail="Fondo $1,500.00" />
              <TopStatus title="Usuario" value={currentUser?.name || "Sin usuario"} detail={currentUser?.role || "Sin rol"} />
              <TopStatus
                title="Siguiente pedido"
                value={`#${getNextShiftOrderNumberPreview().toString().padStart(6, "0")}`}
                detail="Folio del turno"
              />
              <button
                onClick={logout}
                className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm font-black text-red-400 hover:bg-red-500/20"
              >
                Cerrar sesión
              </button>
            </div>
            <div className="flex pr-28 sm:justify-end lg:pr-0">
              <TopCorner compact />
            </div>
          </div>
        </header>

        {/* Computadora y tableta: dos columnas que caben en la pantalla sin bajar. Izquierda productos (3 por fila,
            con su propio scroll); derecha el pedido actual, abajo los detalles y al final el Club, con su propio scroll.
            Celular: productos compactos en una caja con scroll y una barra para ir a cobrar. */}
        <div className="grid grid-cols-1 gap-3 p-3 sm:gap-4 sm:p-6 md:h-[calc(100dvh-3.5rem)] md:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] md:gap-3 md:p-3">
          <section id="productos" className="flex min-h-0 scroll-mt-3 flex-col rounded-3xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5 md:overflow-hidden">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-black">PRODUCTOS</h2>
              <div className="flex items-center gap-2">
                {details.table && (
                  <span className="rounded-xl border border-orange-500/50 bg-orange-500/10 px-3 py-1.5 text-sm font-black text-orange-300">
                    🍽️ {tableLabel(details.table, details.diners)}
                  </span>
                )}
                <button
                  onClick={() => setTablesOpen(true)}
                  title="Elegir mesa (comer aquí), agregar rondas, precuenta y cobro"
                  className="rounded-xl border border-zinc-700 bg-black px-4 py-2 text-sm font-black text-white hover:border-orange-500 hover:text-orange-400"
                >
                  🪑 Mesas{openTables > 0 ? ` (${openTables})` : ""}
                </button>
              </div>
            </div>
            <p className="mt-1 hidden text-sm text-zinc-400 sm:block">
              Busca por nombre o filtra por categoría.
            </p>

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar producto..."
              className="mt-3 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white placeholder:text-zinc-600 sm:mt-5"
            />

            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 sm:mt-4 sm:flex-wrap sm:overflow-visible">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`shrink-0 rounded-2xl border px-4 py-2 text-sm font-bold ${
                    selectedCategory === category
                      ? "border-orange-500 bg-orange-500 text-black"
                      : "border-zinc-800 bg-black text-zinc-300 hover:border-orange-500"
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>

            <div className="mt-1 grid max-h-[55dvh] grid-cols-2 gap-2 overflow-y-auto bpos-scroll px-1 pt-2 sm:mt-3 sm:gap-3 md:max-h-none md:min-h-0 md:flex-1 md:grid-cols-2 md:content-start md:overflow-y-auto md:pr-2 lg:grid-cols-3">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onAdd={addToCart}
                  offSchedule={offSchedule(product)}
                  inCart={cart.reduce((n, item) => (item.id === product.id ? n + item.quantity : n), 0)}
                />
              ))}
            </div>
          </section>

          <section className="flex min-h-0 flex-col gap-3 md:overflow-y-auto bpos-scroll md:pr-1 sm:gap-4 md:gap-3">
            {/* Primero el Club (lo más importante para el cliente), luego los datos y al final el pedido */}
            <ClubPanel
              member={clubMember}
              onChange={(m) => {
                setClubMember(m);
                // Al encontrar al socio, sus datos llenan Cliente y WhatsApp (si están vacíos)
                if (m && !clubMember) {
                  setDetails((d) => ({
                    ...d,
                    ...(d.customerName.trim() ? {} : { customerName: m.name }),
                    ...(d.customerPhone.trim() ? {} : { customerPhone: m.phone }),
                  }));
                }
              }}
            />
            <OrderDetailsPanel details={details} onChange={setDetails} />
            <div id="pedido-actual" className="scroll-mt-3">
            <CartPanel
              items={cart}
              discount={details.discount}
              canCheckout={hasRequiredDetails}
              validationMessage={validationMessage}
              onIncrease={increaseQuantity}
              onDecrease={decreaseQuantity}
              onComment={setLineComment}
              onClear={clearCart}
              onCheckout={openCheckout}
              onHold={holdOrder}
              orderType={details.orderType}
              tableName={details.table?.name}
            />
            </div>
          </section>
        </div>

        {/* Celular: barra para bajar directo al pedido y cobrar */}
        {cart.length > 0 && (
          <button
            onClick={() => document.getElementById("pedido-actual")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="fixed bottom-16 left-3 right-3 z-30 flex items-center justify-between rounded-2xl bg-orange-500 px-5 py-4 font-black text-black shadow-2xl md:hidden"
          >
            <span>🛒 Ver pedido ({cart.reduce((n, item) => n + item.quantity, 0)})</span>
            <span>${subtotal.toFixed(2)} · Cobrar ↓</span>
          </button>
        )}

        <div className="px-3 pb-24 sm:px-6 md:pb-6">

          {orders.some((order) => order.pendingPayment && !order.cancelled) && (
            <section className="mb-6 rounded-3xl border border-yellow-500/40 bg-yellow-500/5 p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-black text-yellow-200">⏳ Cuentas en espera</h2>
                <p className="text-sm text-zinc-400">Ya están en cocina. Toca Cobrar cuando paguen.</p>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {[...orders]
                  .filter((order) => order.pendingPayment && !order.cancelled)
                  .reverse()
                  .map((order) => {
                    const minutes = Math.max(0, Math.round((Date.now() - Date.parse(order.createdAt)) / 60000));
                    return (
                      <div key={order.id} className="flex items-center justify-between gap-3 rounded-2xl border border-yellow-500/30 bg-black p-4">
                        <div className="min-w-0">
                          <p className="font-black text-white">Pedido #{formatOrderNumber(order as SavedOrder & { localOrderNumber?: number })}</p>
                          <p className="truncate text-sm text-zinc-400">
                            {order.details.table ? `🍽️ ${tableLabel(order.details.table, order.details.diners)}` : order.details.orderType}
                            {order.details.customerName && order.details.customerName !== `Mesa ${order.details.table?.name}` ? ` · ${order.details.customerName}` : ""}
                            {" · "}
                            {minutes < 1 ? "ahora" : `hace ${minutes} min`}
                          </p>
                          <p className="truncate text-xs text-zinc-500">{order.items.map((item) => `${item.quantity}x ${item.name}`).join(", ")}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <p className="text-xl font-black text-yellow-200">${order.total.toFixed(2)}</p>
                          <div className="flex gap-2">
                            {order.details.table && (
                              <button onClick={() => printPrecuenta(order)} title="Imprimir precuenta" className="rounded-xl border border-zinc-700 bg-black px-3 py-2 text-sm font-black text-white">
                                🧾
                              </button>
                            )}
                            <button onClick={() => setPayingOrder(order)} className="rounded-xl bg-yellow-400 px-4 py-2 text-sm font-black text-black">
                              💵 Cobrar
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </section>
          )}

          {orders.some((order) => Boolean((order as SavedOrder & { externalOrderNumber?: string }).externalOrderNumber)) && (
            <section className="mb-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
              <h2 className="text-xl font-black text-orange-500">Pedidos de plataforma</h2>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {[...orders]
                  .reverse()
                  .filter((order) => Boolean((order as SavedOrder & { externalOrderNumber?: string }).externalOrderNumber))
                  .map((order) => {
                    const external = order as SavedOrder & {
                      externalOrderNumber?: string;
                      externalPlatform?: string;
                    };
                    const platform = String(external.externalPlatform || "").toLowerCase();
                    const label = platform.includes("didi")
                      ? "DiDi Food"
                      : platform.includes("uber")
                        ? "Uber Eats"
                        : platform.includes("rappi")
                          ? "Rappi"
                          : "Plataforma";
                    return (
                      <div key={`platform-${order.id}`} className="rounded-2xl border border-zinc-800 bg-black p-4">
                        <p className="font-black text-white">
                          Pedido #{formatOrderNumber(order as SavedOrder & { localOrderNumber?: number })}
                        </p>
                        <p className="mt-1 text-sm font-bold text-orange-300">
                          Plataforma: {label} · #{external.externalOrderNumber}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {order.details.customerName || "Cliente de plataforma"}
                        </p>
                      </div>
                    );
                  })}
              </div>
            </section>
          )}

          <OrderHistoryPanel
            orders={[...orders].reverse()}
            userRole={currentUser?.role === "Admin" ? "Admin" : "Cajero"}
            onDelete={deleteOrder}
            onPrint={printTicket}
            onWhatsapp={sendWhatsapp}
            onMarkPaid={markPaid}
          />
        </div>
      </section>
    </main>
  );
}

function TopStatus({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div title={`${title}: ${value} · ${detail}`} className="flex min-w-0 items-baseline gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-1.5">
      <span className="text-[11px] font-bold text-zinc-500">{title}</span>
      <span className="truncate text-sm font-black text-white">{value}</span>
      <span className="hidden text-[11px] text-zinc-400 2xl:inline">{detail}</span>
    </div>
  );
}
