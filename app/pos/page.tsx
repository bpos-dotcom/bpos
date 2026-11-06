"use client";

import { addAuditEvent } from "@/lib/audit";
import { notify } from "@/components/layout/Toasts";
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
import { DIGITAL_MENU_EVENT, categoryOffMenu, getDigitalMenu, saveDigitalMenu, sortCategories, sortProducts } from "@/lib/digital-menu";
import { getCurrentUser, CurrentUser } from "@/lib/auth";
import { requirePermissionOrAdmin } from "@/lib/permissions";
import { printSale, saleStations } from "@/lib/bridge/sale-tickets";
import { clearDrawerSuspect, drawerShouldOpen } from "@/lib/cash-drawer";
import { openCashDrawer } from "@/lib/localService";
import { discountInventoryByOrder } from "@/lib/inventory";
import { checkCoupon, countCouponUse } from "@/lib/coupons";
import { ClubPanel } from "@/components/club/ClubPanel";
import { getLoyalty } from "@/lib/loyalty";
import { claimWelcomeGift, earnLoyalty, findMembers, redeemLoyalty, type ClubMember } from "@/lib/loyalty-pos";
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
import { openWhatsapp } from "@/lib/whatsapp";

const STORAGE_KEY = "bpos_orders";
/** Pedido en curso (carrito y datos) para que no se pierda al cambiar de página */
const DRAFT_KEY = "bpos_pos_draft";
/** Cuadrícula o lista: preferencia de esta caja (no se sincroniza) */
const POS_VIEW_KEY = "bpos_pos_view";
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

  // El pedido en curso se guarda en el navegador: si el cajero cambia de página o
  // recarga, al volver sigue ahí. Solo se vacía al cobrar, mandar a espera o con
  // "Limpiar pedido" (PIN de administrador y bitácora): así nadie "cancela" un
  // pedido sin dejar rastro nomás saliendo del POS.
  const draftLoaded = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as { cart?: CartItem[]; details?: OrderDetails };
        if (Array.isArray(draft.cart) && draft.cart.length) setCart(draft.cart);
        if (draft.details && typeof draft.details.orderType === "string") setDetails(draft.details);
      }
    } catch {
      // borrador dañado: se empieza vacío
    }
    draftLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!draftLoaded.current) return;
    try {
      if (cart.length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ cart, details }));
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      // sin espacio: el pedido sigue en pantalla
    }
  }, [cart, details]);

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
  // Orden de categorías y productos, favoritos y menús con horario (Configuración → Menú digital)
  const [menuCfg, setMenuCfg] = useState(() => getDigitalMenu());
  const categoryOrder = menuCfg.categoryOrder;
  // Fuera de horario: el del producto o el de su menú (ej. Desayunos de 7 a 12)
  const offSchedule = useCallback(
    (product: Product) => {
      const now = new Date(clock);
      if (!isOnSale(product.saleSchedule, now)) return scheduleLabel(product.saleSchedule);
      return categoryOffMenu(menuCfg, product.category, now);
    },
    [clock, menuCfg]
  );

  // Lo que no se vende por separado no aparece en el menú (sí sirve dentro de combos)
  const sellable = useMemo(
    () => sortProducts(products.filter((product) => !product.notSoldAlone), menuCfg.categoryOrder, menuCfg.productOrder),
    [products, menuCfg.categoryOrder, menuCfg.productOrder]
  );

  // Barra de favoritos (en el orden en que se marcaron) y vista en cuadrícula o lista (de esta caja)
  const favorites = useMemo(() => {
    const byId = new Map(sellable.map((p) => [Number(p.id), p]));
    return menuCfg.posFavorites.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));
  }, [sellable, menuCfg.posFavorites]);
  const [editingFavorites, setEditingFavorites] = useState(false);
  function toggleFavorite(product: Product) {
    const id = Number(product.id);
    const list = getDigitalMenu().posFavorites;
    setMenuCfg(saveDigitalMenu({ posFavorites: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] }));
  }
  const [posView, setPosView] = useState<"grid" | "list">("grid");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preferencia de esta caja: se lee después de montar
      if (localStorage.getItem(POS_VIEW_KEY) === "list") setPosView("list");
    } catch {
      // sin almacenamiento: cuadrícula
    }
  }, []);
  function changePosView(view: "grid" | "list") {
    setPosView(view);
    try {
      localStorage.setItem(POS_VIEW_KEY, view);
    } catch {
      // sin almacenamiento: solo dura mientras la página esté abierta
    }
  }

  useEffect(() => {
    const sync = () => setMenuCfg(getDigitalMenu());
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
        if (failed.length) notify(`Ronda mandada, pero no salió en: ${failed.join(" · ")}. Reimprime desde Impresiones.`, "error");
      })
      .catch(() => notify("Ronda guardada, pero B-POS no pudo imprimir. Revisa que B-POS Agent esté conectado.", "error"));
    addAuditEvent({ category: "Venta", action: "sale.round", description: `${currentUser?.name || "Usuario"} mandó la ronda ${round} de ${tableLabel(order.details.table)} (Pedido #${formatOrderNumber(updated as SavedOrder & { localOrderNumber?: number })}): ${cart.map((i) => `${i.quantity}x ${i.name}`).join(", ")}`, userId: currentUser?.id ? String(currentUser.id) : undefined, userName: currentUser?.name, entityId: String(order.id), metadata: { round, total: updated.total } });
    void clearDrawerSuspect(cart.reduce((sum, item) => sum + item.price * item.quantity, 0), "espera");
    notify(`Ronda ${round} de ${tableLabel(order.details.table)} mandada a cocina. Total de la mesa: $${updated.total.toFixed(2)}.`);
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
  const pendingCount = orders.filter((order) => order.pendingPayment && !order.cancelled).length;

  function authorizeAdmin(action: string) {
    return requirePermissionOrAdmin(currentUser, "pos.discount", action);
  }

  // Combos con algo a elegir (ej. el refresco) y productos con opciones (aderezo, salsas) preguntan antes de agregarse
  function addToCart(product: Product) {
    if (editingFavorites) {
      toggleFavorite(product);
      return;
    }
    const off = offSchedule(product);
    if (off) {
      alert(`${product.name} solo se vende: ${off}.`);
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

  /** Regalo de bienvenida del club: el producto a $0, un solo renglón (se registra como recibido al cobrar) */
  function addWelcomeGift(productId: number) {
    const product = products.find((p) => Number(p.id) === Number(productId));
    if (!product) return alert("El producto de regalo ya no existe: revisa Configuración → Club.");
    const { parts, modifiers, ownTicket, extraStations } = buildSelection(product, products);
    const lineId = `${lineIdFor(product.id, parts, modifiers)}|regalo`;
    setCart((current) =>
      current.some((i) => cartLineId(i) === lineId)
        ? current
        : [
            ...current,
            {
              ...product,
              price: 0,
              quantity: 1,
              lineId,
              comment: "🎁 Regalo de bienvenida del club",
              ...(parts?.length ? { parts, ownTicket } : {}),
              ...(modifiers?.length ? { modifiers } : {}),
              ...(extraStations?.length ? { extraStations } : {}),
            },
          ]
    );
  }
  const welcomeInCart = cart.some((i) => cartLineId(i).endsWith("|regalo"));

  function increaseQuantity(lineId: string) {
    if (lineId.endsWith("|regalo")) return; // el regalo es uno solo
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

    // Siempre con PIN (también en sesión de Admin) y con registro: limpiar un pedido es como cancelarlo
    const authorized = await authorizeAdmin("limpiar pedido");
    if (!authorized) return;

    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    addAuditEvent({
      category: "Venta",
      action: "cart.cleared",
      description: `${currentUser?.name || "Usuario"} limpió el pedido en curso ($${total.toFixed(2)}): ${cart.map((i) => `${i.quantity}x ${i.name}`).join(", ")}`,
      userId: currentUser?.id ? String(currentUser.id) : undefined,
      userName: currentUser?.name,
      metadata: { total, items: cart.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })) },
    });
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
  async function finalizePending(order: SavedOrder, pay: { payments: Record<string, number>; tip: number; tipPayments: Record<string, number>; partialPayments?: SavedOrder["partialPayments"]; couponCode?: string; drawerOpened?: boolean }) {
    const paid: SavedOrder = {
      ...order,
      pendingPayment: false,
      paidAt: new Date().toISOString(),
      ...(currentUser?.name ? { paidBy: currentUser.name } : {}),
      tip: pay.tip,
      tipPayments: pay.tipPayments,
      ...(pay.partialPayments ? { partialPayments: pay.partialPayments } : {}),
      details: { ...order.details, paymentMethod: methodLabel(pay.payments), payments: pay.payments, ...(pay.couponCode ? { couponCode: pay.couponCode } : {}) },
    };
    saveOrders(orders.map((o) => (o.id === order.id ? paid : o)));
    void clearDrawerSuspect(paid.total, "cobro");
    if (pay.couponCode) countCouponUse(pay.couponCode);
    if (order.clubAccountId) {
      void earnLoyalty(order.clubAccountId, paid.total, `pos:${(order as SavedOrder & { shiftSessionId?: string }).shiftSessionId || ""}:${order.id}`, currentUser?.name || "").catch((e) =>
        alert(`Cobrado, pero no se pudo sumar al club: ${e instanceof Error ? e.message : "sin internet"}`)
      );
    }
    addAuditEvent({ category: "Venta", action: "sale.paid", description: `${currentUser?.name || "Usuario"} cobró ${nameOf(paid)} (Pedido #${folio(paid)}: ${money(paid.total)}, ${paid.details.paymentMethod}${pay.tip > 0 ? `, propina ${money(pay.tip)}` : ""})`, userId: currentUser?.id ? String(currentUser.id) : undefined, userName: currentUser?.name, entityId: String(order.id), metadata: { total: paid.total, paymentMethod: paid.details.paymentMethod, payments: pay.payments, tip: pay.tip } });
    // Ticket del cliente ya con el pago
    const drawerWanted = drawerShouldOpen(paid.details.paymentMethod, paid.details.orderType);
    const drawerOpened = pay.drawerOpened || (drawerWanted && (await openCashDrawer()));
    void printSale(paid, { stations: [], customer: true, drawer: drawerWanted && !drawerOpened }, true).catch(() => undefined);
    setPayingOrder(null);
    notify(`${nameOf(paid)} cobrada: ${money(paid.total)}${pay.tip > 0 ? ` + ${money(pay.tip)} de propina` : ""}.`);
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
          ...(order.soldBy ? { soldBy: order.soldBy } : {}),
          ...(currentUser?.name ? { paidBy: currentUser.name } : {}),
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
        notify(`Cobrados ${money(part.total)}${data.tip > 0 ? ` + ${money(data.tip)} de propina` : ""} (Pedido #${folio(part)}). Quedan ${money(rest.total)} en ${nameOf(rest)}.`);
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
        notify(`Parte ${partials.length} cobrada: ${money(amount)}${data.tip > 0 ? ` + ${money(data.tip)} de propina` : ""}. Faltan ${money(withDiscount.total - paidSum)}.`);
        return;
      }
      void finalizePending(withDiscount, {
        payments: sumPayments(partials.map((p) => p.payments)),
        tip: round2(partials.reduce((s, p) => s + p.tip, 0)),
        tipPayments: sumPayments(partials.map((p) => p.tipPayments)),
        partialPayments: partials,
        drawerOpened: data.drawerOpened,
        couponCode: data.couponCode,
      });
      return;
    }

    // --- Todo de una vez ---
    void finalizePending(withDiscount, { payments: data.payments, tip: data.tip, tipPayments: data.tipPayments, couponCode: data.couponCode, drawerOpened: data.drawerOpened });
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
      ...(currentUser?.name ? { soldBy: currentUser.name } : {}),
      // En espera: queda "por cobrar"; el club se le suma cuando pague
      ...(data.pending ? { pendingPayment: true, ...(clubMember?.member ? { clubAccountId: clubMember.account_id } : {}) } : { paidAt: new Date().toISOString(), ...(currentUser?.name ? { paidBy: currentUser.name } : {}), tip: data.tip, tipPayments: data.tipPayments }),
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
    // Regalo de bienvenida en el pedido: queda registrado para que no se dé otra vez
    const gift = clubMember?.member ? cart.find((i) => cartLineId(i).endsWith("|regalo")) : undefined;
    if (gift && clubMember) {
      void claimWelcomeGift(clubMember.account_id, gift.name, `Pedido #${formatOrderNumber(newOrder)}`, currentUser?.name || "").catch((e) =>
        alert(`Venta cobrada, pero no se pudo registrar el regalo de bienvenida: ${e instanceof Error ? e.message : "sin internet"}`)
      );
    }
    discountInventoryByOrder(newOrder.id, cart);
    // Cajón: si no se abrió al abrir el cobro y la configuración dice que sí (forma de pago y tipo de pedido),
    // se abre ahora, antes de armar el ticket; el ticket solo lo abre si el Agent no pudo (Agent viejo)
    const drawerWanted = !data.pending && drawerShouldOpen(data.paymentMethod, nextDetails.orderType);
    const drawerOpened = data.drawerOpened || (drawerWanted && (await openCashDrawer()));
    // Comandas por estación y ticket del cliente en Caja, directo a las térmicas
    void printSale(newOrder, { stations: saleStations(newOrder), customer: true, drawer: drawerWanted && !drawerOpened }, false)
      .then((failed) => {
        if (failed.length) notify(`${data.pending ? "Pedido mandado a espera" : "Pedido cobrado"}, pero no salió en: ${failed.join(" · ")}. Revisa Configuración → Impresoras o reimprime desde Impresiones.`, "error");
      })
      .catch(() => notify(`${data.pending ? "Pedido mandado a espera" : "Pedido cobrado"}, pero B-POS no pudo imprimir. Revisa que B-POS Agent esté conectado en la computadora de las impresoras y reimprime desde Impresiones.`, "error"));
    addAuditEvent({ category: "Venta", action: "sale.created", description: `${currentUser?.name || "Usuario"} creó Pedido #${formatOrderNumber(newOrder)} por ${total.toFixed(2)}`, userId: currentUser?.id ? String(currentUser.id) : undefined, userName: currentUser?.name, entityId: String(newOrder.id), metadata: { total, paymentMethod: data.paymentMethod, discount: data.discount, shiftSessionId: sequence.shiftSessionId } });
    // Si antes se cerró un cobro de esta cuenta con el cajón abierto, no era sospechoso (se guardó en espera o se cobró)
    void clearDrawerSuspect(total, data.pending ? "espera" : "cobro");

    notify(
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
        if (link) openWhatsapp(link);
      } else {
        setDispatch({ saleId: newOrder.id, info });
      }
    }

    // printSaleTicket(newOrder);

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

  function logout() {
    localStorage.removeItem("bpos_current_user");
    window.location.href = "/login";
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
        orderType={payingOrder ? payingOrder.details.orderType : details.orderType}
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

            <div className="mt-3 flex gap-2 sm:mt-5">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar producto..."
                className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white placeholder:text-zinc-600"
              />
              <div className="flex shrink-0 overflow-hidden rounded-2xl border border-zinc-800" role="group" aria-label="Vista de productos">
                {(
                  [
                    ["grid", "▦", "Cuadrícula"],
                    ["list", "☰", "Lista"],
                  ] as const
                ).map(([view, icon, text]) => (
                  <button
                    key={view}
                    onClick={() => changePosView(view)}
                    title={text}
                    aria-pressed={posView === view}
                    className={`px-3 text-lg font-black ${posView === view ? "bg-orange-500 text-black" : "bg-black text-zinc-400 hover:text-white"}`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            {/* Favoritos: lo que más se vende, a un toque sin buscar ni cambiar de categoría */}
            <div className="mt-3 flex items-center gap-2">
              <div className="bpos-scroll flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
                {favorites.map((product) => {
                  const off = offSchedule(product);
                  return (
                    <button
                      key={product.id}
                      onClick={() => (editingFavorites ? toggleFavorite(product) : addToCart(product))}
                      disabled={!editingFavorites && Boolean(off)}
                      title={off ? `Fuera de horario: ${off}` : undefined}
                      className={`flex shrink-0 items-center gap-1.5 rounded-2xl border px-3 py-2 text-sm font-black active:scale-95 ${
                        editingFavorites ? "border-red-500/60 bg-red-500/10 text-red-200" : off ? "border-zinc-800 bg-black text-zinc-600" : "border-yellow-500/50 bg-yellow-500/10 text-yellow-100 hover:border-yellow-400"
                      }`}
                    >
                      <span>{product.emoji}</span>
                      <span className="max-w-36 truncate">{product.name}</span>
                      <span className={editingFavorites ? "" : "text-orange-400"}>{editingFavorites ? "✕" : `$${product.price.toFixed(0)}`}</span>
                    </button>
                  );
                })}
                {favorites.length === 0 && !editingFavorites && <span className="py-2 text-xs text-zinc-500">Pon a la mano lo que más vendes →</span>}
                {editingFavorites && favorites.length === 0 && <span className="whitespace-nowrap py-2 text-xs font-bold text-yellow-200">Toca productos abajo para agregarlos ⭐</span>}
              </div>
              <button
                onClick={() => setEditingFavorites((v) => !v)}
                className={`shrink-0 rounded-2xl border px-3 py-2 text-sm font-black ${editingFavorites ? "border-yellow-400 bg-yellow-400 text-black" : "border-zinc-800 bg-black text-zinc-300 hover:border-yellow-400"}`}
              >
                {editingFavorites ? "✓ Listo" : "⭐ Favoritos"}
              </button>
            </div>

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

            <div
              className={`mt-1 grid max-h-[55dvh] overflow-y-auto bpos-scroll px-1 pt-2 sm:mt-3 md:max-h-none md:min-h-0 md:flex-1 md:content-start md:overflow-y-auto md:pr-2 ${
                posView === "list" ? "grid-cols-1 gap-1.5 lg:grid-cols-2" : "grid-cols-2 gap-2 sm:gap-3 md:grid-cols-2 lg:grid-cols-3"
              }`}
            >
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onAdd={addToCart}
                  layout={posView}
                  favorite={editingFavorites ? menuCfg.posFavorites.includes(Number(product.id)) : undefined}
                  offSchedule={editingFavorites ? "" : offSchedule(product)}
                  inCart={cart.reduce((n, item) => (item.id === product.id ? n + item.quantity : n), 0)}
                />
              ))}
            </div>
          </section>

          <section className="flex min-h-0 flex-col gap-3 md:overflow-y-auto bpos-scroll md:pr-1 sm:gap-4 md:gap-3">
            {/* Primero el Club (lo más importante para el cliente), luego los datos y al final el pedido */}
            <ClubPanel
              member={clubMember}
              welcomeInCart={welcomeInCart}
              onWelcomeGift={addWelcomeGift}
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
            {/* Cuentas en espera (mesas, domicilio por cobrar, pedidos del menú que pagan al recoger) */}
            <button
              onClick={() => document.getElementById("cuentas-en-espera")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              disabled={pendingCount === 0}
              className={`mt-3 w-full rounded-2xl border py-3 text-sm font-black ${pendingCount > 0 ? "border-yellow-500/60 bg-yellow-500/10 text-yellow-200 hover:bg-yellow-500/20" : "border-zinc-800 bg-black text-zinc-500"}`}
            >
              ⏳ Cuentas en espera ({pendingCount}){pendingCount > 0 ? " · ver y cobrar ↓" : ""}
            </button>
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

          {pendingCount > 0 && (
            <section id="cuentas-en-espera" className="mb-6 scroll-mt-3 rounded-3xl border border-yellow-500/40 bg-yellow-500/5 p-5 sm:p-6">
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

          <a href="/historial" className="block rounded-3xl border border-zinc-800 bg-zinc-950 p-5 text-center text-sm font-black text-orange-400 hover:border-orange-500">
            📋 Historial de pedidos · reimprimir, WhatsApp, cambiar pago o cancelar →
          </a>
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
