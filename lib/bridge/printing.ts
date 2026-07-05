import { KitchenStation } from "@/data/products";

export type PrintableItem = {
  id: number;
  name: string;
  quantity: number;
  station?: KitchenStation;
};

export type PrintableOrder = {
  id: number;
  createdAt: string;
  items: PrintableItem[];
  details: {
    orderType: string;
    customerName: string;
  };
  source?: string;
  externalOrderNumber?: string;
};

export function groupPrintableItemsByStation(order: PrintableOrder) {
  return order.items.reduce((acc, item) => {
    const station = item.station || "Cocina";

    if (!acc[station]) acc[station] = [];

    acc[station].push(item);

    return acc;
  }, {} as Record<KitchenStation, PrintableItem[]>);
}

export function buildStationTicket(order: PrintableOrder, station: KitchenStation) {
  const groupedItems = groupPrintableItemsByStation(order);
  const items = groupedItems[station] || [];

  if (items.length === 0) return "";

  return `
B-POS KITCHEN
${station.toUpperCase()}

Pedido #${order.id.toString().padStart(6, "0")}
${order.source === "B-POS Bridge" ? `Bridge: ${order.externalOrderNumber}` : ""}
Cliente: ${order.details.customerName || "Mostrador"}
Tipo: ${order.details.orderType}
Fecha: ${new Date(order.createdAt).toLocaleString()}

----------------------------

${items.map((item) => `${item.quantity} x ${item.name}`).join("\n")}

----------------------------
`;
}