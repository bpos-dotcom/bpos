"use client";

import Link from "next/link";
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
import { createPrintJobsForOrder } from "@/lib/bridge/printManager";
import { discountInventoryByOrder } from "@/lib/inventory";

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

    const savedOrders = localStorage.getItem(STORAGE_KEY);
    if (savedOrders) setOrders(JSON.parse(savedOrders));
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
    const pin = window.prompt(`Autorización Admin requerida para: ${action}`);

    if (!pin) return false;

    const savedUsers = localStorage.getItem(USERS_KEY);
    const users: SystemUser[] = savedUsers ? JSON.parse(savedUsers) : [];

    const admin = users.find(
      (user) => user.active && user.role === "Admin" && user.pin === pin
    );

    if (!admin) {
      alert("PIN de administrador incorrecto.");
      return false;
    }

    return true;
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

  function confirmCheckout(data: {
    paymentMethod: PaymentMethod;
    cashReceived: number;
    cardAmount: number;
    transferAmount: number;
    discount: number;
  }) {
    if (data.discount > 0 && currentUser?.role !== "Admin") {
      const authorized = authorizeAdmin("aplicar descuento");
      if (!authorized) return;
    }

    const total = Math.max(subtotal - data.discount, 0);

    const nextDetails: OrderDetails = {
      ...details,
      paymentMethod: data.paymentMethod,
      discount: data.discount,
    };

    const newOrder: SavedOrder = {
      id: orders.length + 1,
      createdAt: new Date().toISOString(),
      items: cart,
      details: nextDetails,
      subtotal,
      total,
    };

    saveOrders([...orders, newOrder]);
    discountInventoryByOrder(newOrder.id, cart);
    createPrintJobsForOrder(newOrder);

    alert(`Pedido #${newOrder.id} cobrado correctamente.`);

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
    if (currentUser?.role !== "Admin") {
      alert("Solo el administrador puede borrar pedidos.");
      return;
    }

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
          <title>Ticket #${order.id}</title>
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
            <div>Ticket #${order.id.toString().padStart(6, "0")}</div>
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

    const message = `🍔 *Burger Planet - Ticket #${order.id
      .toString()
      .padStart(6, "0")}*

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

      <aside className="fixed left-0 top-0 hidden h-screen w-64 border-r border-zinc-800 bg-zinc-950 p-4 lg:block">
        <div className="mb-8 rounded-2xl border border-zinc-800 bg-black p-4">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500 font-black text-black">
            BP
          </div>
          <p className="text-sm font-bold text-orange-500">Burger Planet</p>
          <h1 className="text-2xl font-black">B-POS</h1>
        </div>

        <nav className="space-y-2">
          {menuItems.map((item) => (
            <Link
              key={item.href + item.label}
              href={item.href}
              className="block w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-left text-sm font-bold text-zinc-200 hover:border-orange-500 hover:text-orange-500"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <section className="lg:ml-64">
        <header className="sticky top-0 z-20 border-b border-zinc-800 bg-black/90 px-6 py-4 backdrop-blur">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
            <TopStatus title="Caja" value="Abierta" detail="Fondo: $1,500.00" />
            <TopStatus
              title="Usuario"
              value={currentUser?.name || "Sin usuario"}
              detail={`Rol: ${currentUser?.role || "No definido"}`}
            />
            <TopStatus title="Turno" value="Matutino" detail="08:00 - 16:00" />
            <TopStatus title="Pedido actual" value="#000125" detail="POS activo" />

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