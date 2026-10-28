import { KitchenStation } from "@/data/products";

export type PrintableItem = {
  id: number;
  name: string;
  quantity: number;
  station?: KitchenStation;
  externalName?: string;
};

export type PrintableOrder = {
  id: number;
  localOrderNumber?: number;
  createdAt: string;
  items: PrintableItem[];
  details: {
    orderType: string;
    customerName: string;
  };
  source?: string;
  externalOrderNumber?: string;
  externalPlatform?: string;
  externalRawText?: string;
  kdsTicketLines?: unknown[];
  bridgeActions?: {
    inventoryAdjustments?: Array<{
      name?: string;
      quantity?: number;
      unit?: string;
      externalName?: string;
    }>;
  };
};

export function groupPrintableItemsByStation(order: PrintableOrder) {
  return order.items.reduce((acc, item) => {
    const station = item.station || "Cocina";

    if (!acc[station]) acc[station] = [];

    acc[station].push(item);

    return acc;
  }, {} as Record<KitchenStation, PrintableItem[]>);
}

function platformLabel(value?: string) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("didi")) return "DiDi Food";
  if (normalized.includes("uber")) return "Uber Eats";
  if (normalized.includes("rappi")) return "Rappi";
  return "Plataforma";
}

export function buildStationTicket(order: PrintableOrder, station: KitchenStation) {
  const groupedItems = groupPrintableItemsByStation(order);
  const items = groupedItems[station] || [];

  if (items.length === 0) return "";

  return `
B-POS KITCHEN
${station.toUpperCase()}

Pedido #${Number(order.localOrderNumber || order.id).toString().padStart(6, "0")}
${order.source === "B-POS Bridge" ? `Plataforma: ${platformLabel(order.externalPlatform)} · #${order.externalOrderNumber}` : ""}
Cliente: ${order.details.customerName || "Mostrador"}
Tipo: ${order.details.orderType}
Fecha: ${new Date(order.createdAt).toLocaleString()}

----------------------------

${items
  .map((item) => {
    const external =
      item.externalName &&
      item.externalName.trim().toLowerCase() !== item.name.trim().toLowerCase()
        ? `\n  > ${item.externalName}`
        : "";
    return `${item.quantity} x ${item.name}${external}`;
  })
  .join("\n")}

${(order.bridgeActions?.inventoryAdjustments || []).length > 0
  ? `INDICACIONES / MODIFICADORES\n${(order.bridgeActions?.inventoryAdjustments || [])
      .map(
        (item) =>
          `- ${item.externalName || item.name}${
            item.quantity ? ` (${item.quantity} ${item.unit || ""})` : ""
          }`
      )
      .join("\n")}\n\n`
  : ""}----------------------------
`;
}