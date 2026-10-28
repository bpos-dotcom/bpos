"use client";

import { addAuditEvent } from "@/lib/audit";
import { useEffect, useMemo, useState } from "react";
import { CartItem, CartPanel } from "@/components/CartPanel";
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
import { Product } from "@/data/products";
import { getAdminProducts } from "@/lib/admin";
import { getCurrentUser, CurrentUser } from "@/lib/auth";
import { requirePermissionOrAdmin } from "@/lib/permissions";
import { createPrintJobsForOrder } from "@/lib/bridge/printManager";
import { discountInventoryByOrder } from "@/lib/inventory";
import { Sidebar } from "@/components/layout/Sidebar";
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
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<SavedOrder[]>([]);
  const [currentUser, setCurrentUserState] = useState<CurrentUser | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("Todos");
  const [search, setSearch] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [, setShiftVersion] = useState(0);

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

  const categories = useMemo(() => {
    return ["Todos", ...Array.from(new Set(products.map((p) => p.category)))];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesCategory =
        selectedCategory === "Todos" || product.category === selectedCategory;

      const matchesSearch = product.name
        .toLowerCase()
        .includes(search.toLowerCase());

      return matchesCategory && matchesSearch;
    });
  }, [products, selectedCategory, search]);

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

  function addToCart(product: Product) {
    setCart((currentCart) => {
      const existingItem = currentCart.find((item) => item.id === product.id);

      if (existingItem) {
        return currentCart.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      return [...currentCart, { ...product, quantity: 1 }];
    });
  }

  function increaseQuantity(id: number) {
    setCart((currentCart) =>
      currentCart.map((item) =>
        item.id === id ? { ...item, quantity: item.quantity + 1 } : item
      )
    );
  }

  function decreaseQuantity(id: number) {
    setCart((currentCart) =>
      currentCart
        .map((item) =>
          item.id === id ? { ...item, quantity: item.quantity - 1 } : item
        )
        .filter((item) => item.quantity > 0)
    );
  }

  function clearCart() {
    if (cart.length === 0) return;

    if (currentUser?.role !== "Admin") {
      const authorized = authorizeAdmin("limpiar pedido");
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

  function confirmCheckout(data: {
    paymentMethod: PaymentMethod;
    cashReceived: number;
    cardAmount: number;
    transferAmount: number;
    discount: number;
  }) {
    if (data.discount > 0 && !requirePermissionOrAdmin(currentUser, "pos.discount", "aplicar descuento")) return;

    const total = Math.max(subtotal - data.discount, 0);

    const nextDetails: OrderDetails = {
      ...details,
      paymentMethod: data.paymentMethod,
      discount: data.discount,
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
    discountInventoryByOrder(newOrder.id, cart);
    createPrintJobsForOrder(newOrder);
    addAuditEvent({ category: "Venta", action: "sale.created", description: `${currentUser?.name || "Usuario"} creó Pedido #${formatOrderNumber(newOrder)} por $${total.toFixed(2)}`, userId: currentUser?.id ? String(currentUser.id) : undefined, userName: currentUser?.name, entityId: String(newOrder.id), metadata: { paymentMethod: data.paymentMethod, discount: data.discount, shiftSessionId: sequence.shiftSessionId } });

    alert(`Pedido #${formatOrderNumber(newOrder)} cobrado correctamente.`);

    // printTicket(newOrder);

    setCheckoutOpen(false);
    setCart([]);
    setDetails({
      orderType: "Mostrador",
      customerName: "",
      customerPhone: "",
      customerAddress: "",
      paymentMethod: "Efectivo",
      discount: 0,
    });
  }

  function deleteOrder(id: number) {
    if (!requirePermissionOrAdmin(currentUser, "pos.cancel", "cancelar o borrar una venta")) return;

    if (!confirm("¿Seguro que quieres borrar este pedido?")) return;

    saveOrders(orders.filter((order) => order.id !== id));
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
            <strong>$${(item.price * item.quantity).toFixed(2)}</strong>
          </div>
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
          `• ${item.quantity} x ${item.name} - $${(
            item.price * item.quantity
          ).toFixed(2)}`
      )
      .join("\n");

    const message = `🍔 *Burger Planet - Ticket #${formatOrderNumber(
      order as SavedOrder & { localOrderNumber?: number }
    )}*

Hola ${order.details.customerName || "Cliente"}, este es tu pedido:

${items}

Subtotal: $${order.subtotal.toFixed(2)}
Descuento: -$${order.details.discount.toFixed(2)}
Total: *$${order.total.toFixed(2)}*

Tipo: ${order.details.orderType}
Pago: ${order.details.paymentMethod}

Gracias por pedir en Burger Planet 🚀`;

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
        onClose={() => setCheckoutOpen(false)}
        onConfirm={confirmCheckout}
      />

      <Sidebar />

      <section className="lg:ml-64">
        <header className="sticky top-0 z-20 border-b border-zinc-800 bg-black/90 px-6 py-4 backdrop-blur">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
            <TopStatus title="Caja" value="Abierta" detail="Fondo: $1,500.00" />
            <TopStatus
              title="Usuario"
              value={currentUser?.name || "Sin usuario"}
              detail={`Rol: ${currentUser?.role || "No definido"}`}
            />
            <TopStatus
              title="Turno"
              value="Caja abierta"
              detail="El folio reinicia en cada apertura"
            />
            <TopStatus
              title="Siguiente pedido"
              value={`#${getNextShiftOrderNumberPreview()
                .toString()
                .padStart(6, "0")}`}
              detail="Consecutivo del turno actual"
            />

            <button
              onClick={logout}
              className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-left font-black text-red-400"
            >
              Cerrar sesión
              <p className="mt-1 text-sm font-normal text-red-300/70">
                Volver al login
              </p>
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 p-6 xl:grid-cols-[1fr_330px_390px]">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
            <h2 className="text-xl font-black">PRODUCTOS</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Busca por nombre o filtra por categoría.
            </p>

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar producto..."
              className="mt-5 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white placeholder:text-zinc-600"
            />

            <div className="mt-4 flex flex-wrap gap-2">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`rounded-2xl border px-4 py-2 text-sm font-bold ${
                    selectedCategory === category
                      ? "border-orange-500 bg-orange-500 text-black"
                      : "border-zinc-800 bg-black text-zinc-300 hover:border-orange-500"
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onAdd={addToCart}
                />
              ))}
            </div>
          </section>

          <section className="space-y-4 xl:sticky xl:top-28 xl:self-start">
            <OrderDetailsPanel details={details} onChange={setDetails} />
          </section>

          <section className="space-y-4 xl:sticky xl:top-28 xl:self-start">
            <CartPanel
              items={cart}
              discount={details.discount}
              canCheckout={hasRequiredDetails}
              validationMessage={validationMessage}
              onIncrease={increaseQuantity}
              onDecrease={decreaseQuantity}
              onClear={clearCart}
              onCheckout={openCheckout}
            />
          </section>
        </div>

        <div className="px-6 pb-6">

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

function TopStatus({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs font-bold text-zinc-500">{title}</p>
      <p className="mt-1 text-lg font-black text-white">{value}</p>
      <p className="text-sm text-zinc-400">{detail}</p>
    </div>
  );
}