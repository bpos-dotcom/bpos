"use client";
/**
 * Descargas a Excel desde cada pantalla (pedidos, cortes, clientes,
 * inventario). Reportes tiene su propio libro completo (app/reportes).
 */
import type { SavedOrder } from "@/components/OrderHistoryPanel";
import type { Ingredient } from "@/data/inventory";
import type { CashCloseRecord } from "@/lib/cash-history";
import type { Customer } from "@/lib/customers";
import { kardexWithGaps, type InventoryMovement } from "@/lib/inventory";
import { formatOrderNumber } from "@/lib/order-sequence";
import { methodLabel } from "@/lib/sale-payments";
import { downloadXlsx } from "@/lib/xlsx";

const stamp = () => new Date().toISOString().slice(0, 10);
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("es-MX") : "");

export function exportOrders(orders: SavedOrder[], label = "pedidos") {
  downloadXlsx(`${label}-${stamp()}.xlsx`, [
    {
      name: "Pedidos",
      rows: [
        ["Folio", "Fecha", "Tipo", "Cliente", "Teléfono", "Mesa", "Productos", "Subtotal", "Descuento", "Total", "Propina", "Forma de pago", "Estado", "Plataforma", "Pedido plataforma"],
        ...orders.map((o) => [
          formatOrderNumber(o as SavedOrder & { localOrderNumber?: number }),
          when(o.createdAt),
          o.details.orderType,
          o.details.customerName,
          o.details.customerPhone,
          o.details.table?.name || "",
          o.items.map((i) => `${i.quantity}x ${i.name}`).join(", "),
          o.subtotal,
          o.details.discount || 0,
          o.total,
          o.tip || 0,
          o.details.payments ? methodLabel(o.details.payments) : o.details.paymentMethod,
          o.cancelled ? "Cancelada" : o.pendingPayment ? "Por cobrar" : "Cobrada",
          o.externalPlatform || "",
          o.externalOrderNumber || "",
        ]),
      ],
    },
    {
      name: "Productos",
      rows: [
        ["Folio", "Fecha", "Producto", "Cantidad", "Precio", "Importe", "Comentario"],
        ...orders
          .filter((o) => !o.cancelled)
          .flatMap((o) => o.items.map((i) => [formatOrderNumber(o as SavedOrder & { localOrderNumber?: number }), when(o.createdAt), i.name, i.quantity, i.price, i.price * i.quantity, i.comment || ""])),
      ],
    },
  ]);
}

export function exportCuts(records: CashCloseRecord[]) {
  downloadXlsx(`cortes-${stamp()}.xlsx`, [
    {
      name: "Cortes",
      rows: [
        ["Folio", "Apertura", "Cierre", "Abrió", "Cerró", "Fondo", "Ventas", "Pedidos", "Efectivo", "Tarjeta", "Transferencia", "Entradas", "Salidas", "Esperado", "Contado", "Diferencia", "Motivo"],
        ...records.map((r) => [
          r.folio,
          when(r.openedAt),
          when(r.closedAt),
          r.openedBy || "",
          r.closedBy || "",
          r.openingCash,
          r.totalSales,
          r.orderCount,
          r.salesByPayment.cash,
          r.salesByPayment.card,
          r.salesByPayment.transfer,
          r.cashIn,
          r.cashOut,
          r.expectedCash,
          r.countedCash,
          r.difference,
          r.differenceReason || "",
        ]),
      ],
    },
    {
      name: "Horas del personal",
      rows: [["Folio", "Cierre", "Empleado", "Horas"], ...records.flatMap((r) => (r.staffHours || []).map((s) => [r.folio, when(r.closedAt), s.userName, Math.round(s.hours * 100) / 100]))],
    },
  ]);
}

export function exportCustomers(customers: Customer[]) {
  downloadXlsx(`clientes-${stamp()}.xlsx`, [
    {
      name: "Clientes",
      rows: [
        ["Nombre", "Teléfono", "Dirección", "Pedidos", "Gastado", "Ticket promedio", "Primer pedido", "Último pedido", "Tipo", "Favoritos", "Notas"],
        ...customers.map((c) => [c.name, c.phone, c.address, c.orders, c.spent, Math.round(c.average * 100) / 100, when(c.firstAt), when(c.lastAt), c.segment, c.favorites.map((f) => f.name).join(", "), c.notes]),
      ],
    },
  ]);
}

/** Todo el Kardex, de lo más nuevo a lo más viejo, con los cambios "Sin registro" en su lugar */
const kardexSheet = (kardex: InventoryMovement[]) => ({
  name: "Kardex",
  rows: [
    ["Fecha", "Insumo", "Tipo", "Cantidad", "Unidad", "Antes", "Después", "Motivo", "Pedido", "Quién"],
    ...kardexWithGaps(kardex)
      .reverse()
      .map((m) => [m.gapSince ? `Entre ${when(m.gapSince)} y ${when(m.createdAt)}` : when(m.createdAt), m.ingredientName, m.type, m.quantity, m.unit, m.previousStock, m.finalStock, m.reason || "", m.orderId ?? m.externalOrderKey ?? "", m.userName || ""]),
  ],
});

export function exportInventory(ingredients: Ingredient[], kardex: InventoryMovement[]) {
  downloadXlsx(`inventario-${stamp()}.xlsx`, [
    { name: "Existencias", rows: [["Insumo", "Existencia", "Unidad", "Mínimo", "Por reponer"], ...ingredients.map((i) => [i.name, i.stock, i.unit, i.minimum, i.stock <= i.minimum ? "Sí" : ""])] },
    kardexSheet(kardex),
  ]);
}

/** Solo el Kardex (completo) */
export function exportKardex(kardex: InventoryMovement[]) {
  downloadXlsx(`kardex-${stamp()}.xlsx`, [kardexSheet(kardex)]);
}
