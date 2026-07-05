"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Product } from "@/data/products";
import { interpretTicketWithAI } from "@/lib/ai/interpreter";
import { findBridgeProduct, ParsedBridgeItem } from "@/lib/bridge/parser";
import BridgeAliases from "./BridgeAliases";
import { discountInventoryByOrder } from "@/lib/inventory";
import { createPrintJobsForOrder } from "@/lib/bridge/printManager";

type BridgeStatus =
  | "Recibido"
  | "Procesando IA"
  | "Venta creada"
  | "Inventario actualizado"
  | "KDS enviado"
  | "Impreso"
  | "Finalizado"
  | "Error";

type BridgeTicket = {
  id: number;
  platform: "Didi Food" | "Uber Eats";
  orderNumber: string;
  receivedAt: string;
  customer: string;
  parsedItems: ParsedBridgeItem[];
  status: BridgeStatus;
  rawText: string;
  createdOrderId?: number;
};

type BridgeOrderItem = Product & { quantity: number };

type BridgeOrder = {
  id: number;
  createdAt: string;
  items: BridgeOrderItem[];
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
  source?: string;
  externalOrderNumber?: string;
};

const ORDERS_KEY = "bpos_orders";

const STATUS_FLOW: BridgeStatus[] = [
  "Recibido",
  "Procesando IA",
  "Venta creada",
  "Inventario actualizado",
  "KDS enviado",
  "Impreso",
  "Finalizado",
];

const statusStyles: Record<BridgeStatus, string> = {
  Recibido: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  "Procesando IA": "border-purple-500/40 bg-purple-500/10 text-purple-300",
  "Venta creada": "border-orange-500/40 bg-orange-500/10 text-orange-300",
  "Inventario actualizado": "border-green-500/40 bg-green-500/10 text-green-300",
  "KDS enviado": "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
  Impreso: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300",
  Finalizado: "border-green-500/40 bg-green-500/10 text-green-300",
  Error: "border-red-500/40 bg-red-500/10 text-red-300",
};

export default function BridgePage() {
  const [tickets, setTickets] = useState<BridgeTicket[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  const activeTickets = tickets.filter((ticket) => ticket.status !== "Finalizado");
  const finishedTickets = tickets.filter((ticket) => ticket.status === "Finalizado");

  const nextOrderNumber = useMemo(() => {
    return `BPB-${(tickets.length + 1).toString().padStart(4, "0")}`;
  }, [tickets.length]);

  async function createDemoTicket(platform: "Didi Food" | "Uber Eats") {
    setIsCreating(true);

    const demoItems =
      platform === "Didi Food"
        ? ["2 Classic Burger", "1 Papas Grandes", "2 Coca-Cola"]
        : ["1 Smash Doble", "1 Alitas 12 pzas", "1 Agua Mineral"];

    const rawText = `${platform}
Pedido ${nextOrderNumber}

${demoItems.join("\n")}

Notas:
Sin cebolla
Enviar cubiertos`;

    const aiTicket = await interpretTicketWithAI(rawText);

    const parsedItems: ParsedBridgeItem[] = aiTicket.items.map((item) => {
      const result = findBridgeProduct(item.normalizedName);

      return {
        originalLine: item.originalName,
        quantity: item.quantity,
        cleanName: item.normalizedName,
        product: result.product,
        matched: Boolean(result.product),
        matchType: result.matchType,
      };
    });

    const newTicket: BridgeTicket = {
      id: Date.now(),
      platform,
      orderNumber: aiTicket.orderNumber || nextOrderNumber,
      receivedAt: new Date().toISOString(),
      customer: aiTicket.customer || (platform === "Didi Food" ? "Cliente Didi" : "Cliente Uber"),
      parsedItems,
      status: "Recibido",
      rawText,
    };

    setTickets((current) => [newTicket, ...current]);
    setIsCreating(false);
  }

  function createOrderFromTicket(ticket: BridgeTicket) {
    const savedOrders: BridgeOrder[] = JSON.parse(
      localStorage.getItem(ORDERS_KEY) ?? "[]"
    );

    const nextOrderId = savedOrders.length + 1;

    const orderItems: BridgeOrderItem[] = ticket.parsedItems.map((item, index) => {
      if (item.product) {
        return {
          ...item.product,
          quantity: item.quantity,
        };
      }

      return {
        id: Date.now() + index,
        name: item.cleanName,
        category: "Bridge",
        price: 0,
        emoji: "🛵",
        quantity: item.quantity,
      };
    });

    const subtotal = orderItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const newOrder: BridgeOrder = {
      id: nextOrderId,
      createdAt: new Date().toISOString(),
      items: orderItems,
      details: {
        orderType: ticket.platform,
        customerName: ticket.customer,
        customerPhone: "",
        customerAddress: "",
        paymentMethod: ticket.platform,
        discount: 0,
      },
      subtotal,
      total: subtotal,
      source: "B-POS Bridge",
      externalOrderNumber: ticket.orderNumber,
    };

    localStorage.setItem(ORDERS_KEY, JSON.stringify([...savedOrders, newOrder]));
    return nextOrderId;
  }

  function advanceTicket(id: number) {
    setTickets((current) =>
      current.map((ticket) => {
        if (ticket.id !== id) return ticket;

        const currentIndex = STATUS_FLOW.indexOf(ticket.status);
        const nextStatus =
          currentIndex >= 0 && currentIndex < STATUS_FLOW.length - 1
            ? STATUS_FLOW[currentIndex + 1]
            : "Finalizado";

        if (nextStatus === "Venta creada" && !ticket.createdOrderId) {
          const createdOrderId = createOrderFromTicket(ticket);

          return {
            ...ticket,
            status: nextStatus,
            createdOrderId,
          };
        }

        if (nextStatus === "KDS enviado" && ticket.createdOrderId) {
  const savedOrders: BridgeOrder[] = JSON.parse(
    localStorage.getItem(ORDERS_KEY) ?? "[]"
  );

  const nextOrders = savedOrders.map((order) =>
    order.id === ticket.createdOrderId
      ? { ...order, kdsReleased: true, status: "Nuevo" }
      : order
  );

  localStorage.setItem(ORDERS_KEY, JSON.stringify(nextOrders));

  return {
    ...ticket,
    status: nextStatus,
  };
}

if (nextStatus === "Impreso" && ticket.createdOrderId) {
  const savedOrders: BridgeOrder[] = JSON.parse(
    localStorage.getItem(ORDERS_KEY) ?? "[]"
  );

  const order = savedOrders.find((item) => item.id === ticket.createdOrderId);

  if (order) {
    createPrintJobsForOrder(order);
  }

  return {
    ...ticket,
    status: nextStatus,
  };
}

        if (
  nextStatus === "Inventario actualizado" &&
  ticket.createdOrderId
) {
  discountInventoryByOrder(ticket.createdOrderId, ticket.parsedItems.map((item) => {
    if (item.product) {
      return {
        ...item.product,
        quantity: item.quantity,
      };
    }

    return {
      id: Date.now(),
      name: item.cleanName,
      category: "Bridge",
      price: 0,
      emoji: "🛵",
      quantity: item.quantity,
    };
  }));

  return {
    ...ticket,
    status: nextStatus,
  };
}

        return {
          ...ticket,
          status: nextStatus,
        };
      })
    );
  }

  function resetDemo() {
    if (!confirm("¿Limpiar cola e historial de Bridge?")) return;
    setTickets([]);
  }

  return (
    <AppShell
      title="B-POS Bridge"
      subtitle="Impresora virtual inteligente para Didi Food, Uber Eats y plataformas externas."
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_1fr]">
        <section className="space-y-6">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-green-500/10 text-4xl">
                🟢
              </div>

              <div>
                <p className="text-sm font-bold text-green-400">Bridge activo</p>
                <h2 className="text-2xl font-black">Esperando pedidos</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  La impresora virtual B-POS recibirá aquí los tickets externos.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-black text-orange-500">
              Simulador de ticket
            </h2>

            <p className="mt-2 text-sm text-zinc-400">
              Ahora el ticket pasa por el motor IA. Por el momento usa fallback
              local; después conectaremos OpenAI.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-3">
              <button
                disabled={isCreating}
                onClick={() => createDemoTicket("Didi Food")}
                className="rounded-2xl bg-orange-500 px-5 py-4 font-black text-black disabled:opacity-50"
              >
                {isCreating ? "Procesando..." : "Simular pedido Didi Food"}
              </button>

              <button
                disabled={isCreating}
                onClick={() => createDemoTicket("Uber Eats")}
                className="rounded-2xl border border-zinc-800 bg-black px-5 py-4 font-black text-white hover:border-orange-500 disabled:opacity-50"
              >
                {isCreating ? "Procesando..." : "Simular pedido Uber Eats"}
              </button>

              <button
                onClick={resetDemo}
                className="rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-4 font-black text-red-400"
              >
                Limpiar Bridge
              </button>
            </div>
          </div>

          <BridgeAliases />

          <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-black text-orange-500">
              Flujo automático
            </h2>

            <div className="mt-5 space-y-3 text-sm text-zinc-300">
              <FlowItem icon="🖨️" text="Ticket enviado a impresora virtual" />
              <FlowItem icon="🧠" text="IA interpreta productos y notas" />
              <FlowItem icon="🍔" text="Venta creada automáticamente" />
              <FlowItem icon="📦" text="Inventario descontado por receta" />
              <FlowItem icon="👨‍🍳" text="Pedido enviado al KDS" />
              <FlowItem icon="🔥" text="Impresión por estación" />
              <FlowItem icon="📊" text="Dashboard actualizado" />
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Metric title="En cola" value={activeTickets.length.toString()} />
            <Metric title="Finalizados" value={finishedTickets.length.toString()} />
            <Metric title="Plataformas" value="2" />
            <Metric title="Modo" value="IA ready" />
          </div>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-black text-orange-500">
              Cola de procesamiento
            </h2>

            <div className="mt-6 space-y-4">
              {tickets.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">
                  Todavía no hay tickets recibidos.
                </div>
              ) : (
                tickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="rounded-3xl border border-zinc-800 bg-black p-5"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-sm font-bold text-orange-500">
                          {ticket.platform}
                        </p>

                        <h3 className="text-2xl font-black">
                          Pedido {ticket.orderNumber}
                        </h3>

                        <p className="mt-1 text-sm text-zinc-400">
                          {ticket.customer} ·{" "}
                          {new Date(ticket.receivedAt).toLocaleString()}
                        </p>

                        {ticket.createdOrderId && (
                          <p className="mt-2 text-sm font-black text-green-400">
                            Venta B-POS #
                            {ticket.createdOrderId.toString().padStart(6, "0")} creada
                          </p>
                        )}
                      </div>

                      <span
                        className={`rounded-xl border px-3 py-2 text-xs font-black ${
                          statusStyles[ticket.status]
                        }`}
                      >
                        {ticket.status}
                      </span>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                        <p className="mb-3 text-sm font-black text-zinc-400">
                          Productos interpretados
                        </p>

                        <div className="space-y-2">
                          {ticket.parsedItems.map((item) => (
                            <div
                              key={item.originalLine}
                              className="rounded-xl bg-black px-3 py-2 text-sm"
                            >
                              <p className="font-black text-zinc-200">
                                {item.quantity} × {item.cleanName}
                              </p>

                              {item.matched && item.product ? (
                                <p className="text-xs text-green-400">
                                  ✓ {item.matchType === "alias" ? "Alias" : "Catálogo"}:{" "}
                                  {item.product.name} · ${item.product.price.toFixed(2)}
                                </p>
                              ) : (
                                <p className="text-xs text-red-400">
                                  Sin coincidencia en catálogo
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                        <p className="mb-3 text-sm font-black text-zinc-400">
                          Ticket original
                        </p>

                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-5 text-zinc-500">
                          {ticket.rawText}
                        </pre>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                      <MiniStep done={statusDone(ticket.status, "Recibido")} text="Recibido" />
                      <MiniStep done={statusDone(ticket.status, "Procesando IA")} text="IA" />
                      <MiniStep done={statusDone(ticket.status, "Venta creada")} text="Venta" />
                      <MiniStep done={statusDone(ticket.status, "KDS enviado")} text="KDS" />
                    </div>

                    {ticket.status !== "Finalizado" && (
                      <button
                        onClick={() => advanceTicket(ticket.id)}
                        className="mt-5 w-full rounded-2xl bg-orange-500 py-3 font-black text-black"
                      >
                        Avanzar procesamiento
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </section>
      </div>
    </AppShell>
  );
}

function statusDone(current: BridgeStatus, target: BridgeStatus) {
  return STATUS_FLOW.indexOf(current) >= STATUS_FLOW.indexOf(target);
}

function FlowItem({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-black p-3">
      <span className="text-2xl">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
      <p className="text-sm text-zinc-400">{title}</p>
      <p className="mt-2 text-2xl font-black text-orange-500">{value}</p>
    </div>
  );
}

function MiniStep({ done, text }: { done: boolean; text: string }) {
  return (
    <div
      className={`rounded-2xl border p-3 text-center text-xs font-black ${
        done
          ? "border-green-500/40 bg-green-500/10 text-green-400"
          : "border-zinc-800 bg-zinc-950 text-zinc-500"
      }`}
    >
      {done ? "✓ " : ""}
      {text}
    </div>
  );
}