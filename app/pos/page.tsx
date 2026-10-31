"use client";

import { addAuditEvent } from "@/lib/audit";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CartItem, CartPanel, cartLineId } from "@/components/CartPanel";
import { ComboChoiceModal } from "@/components/ComboChoiceModal";
import { buildSelection, extrasPrice, lineIdFor, needsChoices } from "@/lib/compound";
import { getBusinessSettings } from "@/lib/business-settings";
import { CheckoutModal, PaymentMethod } from "@/components/CheckoutModal";
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
import { getCurrentUser, CurrentUser } from "@/lib/auth";
import { requirePermissionOrAdmin } from "@/lib/permissions";
import { printSale, saleStations } from "@/lib/bridge/sale-tickets";
import { discountInventoryByOrder } from "@/lib/inventory";
import { checkCoupon, countCouponUse } from "@/lib/coupons";
import { ClubPanel } from "@/components/club/ClubPanel";
import { getLoyalty } from "@/lib/loyalty";
import { earnLoyalty, redeemLoyalty, type ClubMember } from "@/lib/loyalty-pos";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopCorner } from "@/components/layout/TopCorner";
import RequirePermission from "@/components/auth/RequirePermission";
import { cancelSale, isCancelled } from "@/lib/sale-cancel";
import { useTerminalCharge } from "@/components/payments/TerminalCharge";
import { branchUsesTerminal } from "@/lib/mp/client";
import { DispatchModal } from "@/components/delivery/DispatchModal";
import type { DispatchInfo } from "@/lib/drivers";
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
  const [comboToChoose, setComboToChoose] = useState<Product | null>(null);
  const [, setShiftVersion] = useState(0);
  // Terminal Mercado Pago: con tarjeta, el monto se manda solo a la terminal
  const terminal = useTerminalCharge();
  // Pedido a domicilio cobrado: elegir repartidor
  const [dispatch, setDispatch] = useState<{ info: DispatchInfo; saleId: number } | null>(null);
  /** Socio del club elegido para esta venta */
  const [clubMember, setClubMember] = useState<ClubMember | null>(null);

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

  const categories = useMemo(() => {
    return ["Todos", ...Array.from(new Set(sellable.map((p) => p.category)))];
  }, [sellable]);

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

  const requiresDeliveryData =
    details.orderType === "Domicilio" || details.orderType === "WhatsApp";

  const hasRequiredDetails =
    cart.length > 0 &&
    details.customerName.trim() !== "" &&
    details.orderType.trim() !== "" &&
    (!requiresDeliveryData ||
      (details.customerPhone.trim() !== "" &&
        details.customerAddress.trim() !== ""));

  const validationMessage =
    cart.length === 0
      ? "Agrega productos al pedido para cobrar."
      : details.customerName.trim() === ""
      ? "Captura el nombre del cliente."
      : requiresDeliveryData
      ? "Completa teléfono y dirección para WhatsApp/Domicilio."
      : "Completa los detalles del pedido.";

  function saveOrders(nextOrders: SavedOrder[]) {
    setOrders(nextOrders);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextOrders));
  }

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

  function nextGlobalOrderId() {
    return orders.reduce(
      (max, order) => Math.max(max, Number(order.id) || 0),
      0
    ) + 1;
  }

  async function confirmCheckout(data: {
    paymentMethod: PaymentMethod;
    cashReceived: number;
    cardAmount: number;
    transferAmount: number;
    discount: number;
    couponCode?: string;
    clubCashback?: number;
  }) {
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

    const total = Math.max(subtotal - data.discount, 0);

    // Con terminal vinculada, la parte con tarjeta se cobra primero en la terminal
    const cardPart = data.paymentMethod === "Tarjeta" ? total : data.paymentMethod === "Mixto" ? Math.min(total, data.cardAmount || 0) : 0;
    if (cardPart > 0 && (await branchUsesTerminal())) {
      const result = await terminal.charge(cardPart, `Pedido ${getNextShiftOrderNumberPreview()}`);
      if (result === "cancelled") return;
    }

    const nextDetails: OrderDetails = {
      ...details,
      paymentMethod: data.paymentMethod,
      discount: data.discount,
      ...(byCoupon && data.couponCode ? { couponCode: data.couponCode } : {}),
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
          await earnLoyalty(member.account_id, total, ref, currentUser?.name || "");
        } catch (e) {
          alert(`Venta cobrada, pero no se pudo sumar al club: ${e instanceof Error ? e.message : "sin internet"}`);
        }
      })();
    }
    discountInventoryByOrder(newOrder.id, cart);
    // Comandas por estación y ticket del cliente en Caja, directo a las térmicas
    void printSale(newOrder, { stations: saleStations(newOrder), customer: true }, false)
      .then((failed) => {
        if (failed.length) alert(`Pedido cobrado, pero no salió en: ${failed.join(" · ")}. Revisa Configuración → Impresoras o reimprime desde Impresiones.`);
      })
      .catch(() => alert("Pedido cobrado, pero B-POS no pudo imprimir. Revisa que B-POS Agent esté conectado en la computadora de las impresoras y reimprime desde Impresiones."));
    addAuditEvent({ category: "Venta", action: "sale.created", description: `${currentUser?.name || "Usuario"} creó Pedido #${formatOrderNumber(newOrder)} por $${total.toFixed(2)}`, userId: currentUser?.id ? String(currentUser.id) : undefined, userName: currentUser?.name, entityId: String(newOrder.id), metadata: { total, paymentMethod: data.paymentMethod, discount: data.discount, shiftSessionId: sequence.shiftSessionId } });

    alert(`Pedido #${formatOrderNumber(newOrder)} cobrado correctamente.`);

    if (nextDetails.orderType === "Domicilio") {
      setDispatch({
        saleId: newOrder.id,
        info: {
          title: `Pedido #${formatOrderNumber(newOrder)}`,
          businessName: getBusinessSettings().businessName,
          customer: { name: nextDetails.customerName, phone: nextDetails.customerPhone, address: nextDetails.customerAddress },
          lines: cart.map((i) => ({ quantity: i.quantity, name: i.name, detail: [...(i.parts || []).map((p) => p.name), ...(i.modifiers || []).filter((m) => !m.extra).map((m) => m.name), i.comment].filter(Boolean).join(" · ") || undefined })),
          total,
          payment: { paid: true, method: data.paymentMethod },
        },
      });
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
            <strong>-$${order.details.discount.toFixed(2)}</strong>
          </div>

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
        isOpen={checkoutOpen}
        total={subtotal}
        clubCashback={clubMember?.member && getLoyalty().kind === "cashback" ? clubMember.cashback : 0}
        onClose={() => setCheckoutOpen(false)}
        onConfirm={confirmCheckout}
      />
      {terminal.modal}
      {dispatch && <DispatchModal info={dispatch.info} saleId={dispatch.saleId} onClose={() => setDispatch(null)} />}

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

      <section className="bpos-main">
        {/* Barra delgada: datos del turno a la izquierda, tema/hora/logo a la derecha. No se queda fija: se va al bajar. */}
        <header className="border-b border-zinc-800 bg-black px-3 py-1.5 sm:px-6">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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

        {/* Tableta: productos a la izquierda (con su propio scroll) y datos + pedido a la derecha.
            Celular: productos compactos en una caja con scroll y una barra para ir a cobrar. */}
        <div className="grid grid-cols-1 gap-3 p-3 sm:gap-4 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(290px,370px)] xl:grid-cols-[1fr_330px_390px]">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5 md:row-span-2 md:sticky md:top-3 md:max-h-[calc(100dvh-1.5rem)] md:self-start md:overflow-y-auto xl:static xl:row-span-1 xl:max-h-none xl:overflow-visible">
            <h2 className="text-xl font-black">PRODUCTOS</h2>
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

            <div className="mt-1 grid max-h-[55dvh] grid-cols-2 gap-2 overflow-y-auto px-1 pt-2 sm:mt-3 sm:gap-3 md:max-h-none md:overflow-visible md:pr-0 lg:grid-cols-3 2xl:grid-cols-4">
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

          <section className="space-y-4 md:order-3 xl:order-none xl:sticky xl:top-28 xl:self-start">
            <OrderDetailsPanel details={details} onChange={setDetails} />
            <ClubPanel member={clubMember} onChange={setClubMember} />
          </section>

          <section id="pedido-actual" className="scroll-mt-3 space-y-4 md:order-2 xl:order-none xl:sticky xl:top-28 xl:self-start">
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
            />
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
