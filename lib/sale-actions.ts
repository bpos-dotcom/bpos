"use client";
import { ask, askText, notify } from "@/components/layout/Dialogs";
/**
 * Acciones sobre una venta guardada que se usan desde el POS y desde
 * Historial de pedidos: ticket en ventana (navegador) y reenvío por WhatsApp.
 */
import type { SavedOrder } from "@/components/OrderHistoryPanel";
import { addAuditEvent } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth";
import { getBusinessSettings } from "@/lib/business-settings";
import { earnLoyalty } from "@/lib/loyalty-pos";
import { formatOrderNumber } from "@/lib/order-sequence";
import { authorizeWithAdminPin, requirePermissionOrAdmin } from "@/lib/permissions";
import { cancelSale, isCancelled } from "@/lib/sale-cancel";
import { revertInventoryForOrder, type InventoryOrderLike } from "@/lib/inventory";
import { openWhatsapp, whatsappLink } from "@/lib/whatsapp";

export function printSaleTicket(order: SavedOrder) {
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

export function sendSaleWhatsapp(order: SavedOrder) {
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

  openWhatsapp(whatsappLink(phone, message));
}


// ---------------------------------------------------------------- cambios a una venta guardada

const ORDERS_KEY = "bpos_orders";

export function loadSavedOrders(): SavedOrder[] {
  try {
    const raw = localStorage.getItem(ORDERS_KEY);
    return raw ? (JSON.parse(raw) as SavedOrder[]) : [];
  } catch {
    return [];
  }
}

/** Guarda y avisa a las demás pantallas (POS, Caja, Cocina) */
export function saveSavedOrders(orders: SavedOrder[]) {
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
  window.dispatchEvent(new Event("bpos:orders-updated"));
}

function replaceOrder(updated: SavedOrder) {
  saveSavedOrders(loadSavedOrders().map((o) => (o.id === updated.id ? updated : o)));
}

/**
 * Al cancelar: ¿la comida ya se preparó? No → lo descontado regresa al
 * inventario. Sí → se anota como merma (no regresa). null = se arrepintió.
 */
export async function askInventoryOnCancel(order: { items?: unknown[] }): Promise<"regresar" | "merma" | null> {
  if (!order.items?.length) return "regresar";
  const choice = await askText("¿Qué pasa con el inventario?", {
    choices: [
      { value: "regresar", label: "No se preparó: regresar al inventario", hint: "Los ingredientes y el empaque vuelven a tu inventario." },
      { value: "merma", label: "Ya se preparó: se tiró", hint: "No regresa; se anota como merma con su costo." },
    ],
    defaultValue: "regresar",
    ok: "Cancelar pedido",
    cancel: "Volver",
  });
  return choice === "merma" ? "merma" : choice === "regresar" ? "regresar" : null;
}

/** Cancela con motivo (queda guardada y en la bitácora). Admin: siempre con su PIN. */
export async function cancelSavedOrder(order: SavedOrder, user: CurrentUser | null): Promise<boolean> {
  if (isCancelled(order)) return false;
  if (!(await requirePermissionOrAdmin(user, "pos.cancel", "cancelar una venta"))) return false;
  const reason = await askText(`Motivo para cancelar el pedido #${formatOrderNumber(order)}`, { placeholder: "Motivo", ok: "Cancelar pedido", cancel: "Volver" });
  if (reason === null) return false;
  if (!reason.trim()) {
    notify("El motivo es obligatorio para cancelar una venta.", "error");
    return false;
  }
  const stock = await askInventoryOnCancel(order);
  if (stock === null) return false;
  const by = user?.name || "Usuario";
  replaceOrder(cancelSale(order, reason, by));
  const result = revertInventoryForOrder(order as unknown as InventoryOrderLike, stock, reason.trim());
  addAuditEvent({
    category: "Venta",
    action: "sale.cancelled",
    description: `${by} canceló el Pedido #${formatOrderNumber(order)} por $${order.total.toFixed(2)}: ${reason.trim()} · ${stock === "merma" ? "ya se había preparado (merma)" : "se regresó al inventario"}`,
    userId: user?.id ? String(user.id) : undefined,
    userName: by,
    entityId: String(order.id),
    metadata: { total: order.total, reason: reason.trim(), inventory: stock, merma: result.merma },
  });
  return true;
}

/** Cuenta en espera: ya pagó (el repartidor trajo el dinero, o pasó a recoger) */
export async function markSavedOrderPaid(order: SavedOrder, method: string, user: CurrentUser | null) {
  if (!(await ask(`¿Pedido #${formatOrderNumber(order)} pagado con ${method.toLowerCase()} por ${order.total.toFixed(2)}?`))) return;
  const paid: SavedOrder = { ...order, pendingPayment: false, paidAt: new Date().toISOString(), details: { ...order.details, paymentMethod: method, payments: { [method]: order.total } } };
  replaceOrder(paid);
  if (order.clubAccountId) {
    void earnLoyalty(order.clubAccountId, order.total, `pos:${(order as SavedOrder & { shiftSessionId?: string }).shiftSessionId || ""}:${order.id}`, user?.name || "").catch((e) =>
      alert(`Cobrado, pero no se pudo sumar al club: ${e instanceof Error ? e.message : "sin internet"}`)
    );
  }
  addAuditEvent({ category: "Venta", action: "sale.paid", description: `${user?.name || "Usuario"} cobró Pedido #${formatOrderNumber(paid)} en espera (${order.total.toFixed(2)}, ${method})`, userId: user?.id ? String(user.id) : undefined, userName: user?.name, entityId: String(order.id), metadata: { total: order.total, paymentMethod: method } });
}

/**
 * Se marcó con un método pero se cobró con otro (ej. "Efectivo" y fue con tarjeta):
 * corrige la venta para que la caja cuadre. Siempre pide PIN de administrador,
 * aunque la sesión sea de un Admin (por si la cuenta se quedó abierta).
 */
export async function changeSavedOrderPayment(order: SavedOrder, method: string, user: CurrentUser | null): Promise<boolean> {
  const before = order.details.paymentMethod || "Sin método";
  if (before === method || isCancelled(order) || order.pendingPayment) return false;
  if (!(await authorizeWithAdminPin(`cambiar el pago del pedido #${formatOrderNumber(order)} de ${before} a ${method}`, user))) return false;
  const tip = Number(order.tip) || 0;
  const updated: SavedOrder = {
    ...order,
    details: { ...order.details, paymentMethod: method, payments: { [method]: order.total } },
    ...(tip > 0 ? { tipPayments: { [method]: tip } } : {}),
  };
  replaceOrder(updated);
  addAuditEvent({
    category: "Venta",
    action: "sale.payment_changed",
    description: `${user?.name || "Usuario"} cambió el pago del Pedido #${formatOrderNumber(order)} ($${order.total.toFixed(2)}) de ${before} a ${method}`,
    userId: user?.id ? String(user.id) : undefined,
    userName: user?.name,
    entityId: String(order.id),
    metadata: { total: order.total, from: before, to: method },
  });
  return true;
}
