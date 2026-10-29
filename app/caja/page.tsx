"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { buildShoppingListMessage, clearLowStockAfterShiftClose, getPendingLowStock, markShoppingListSent, shoppingListWasSentForShift } from "@/lib/inventory";
import { getOwnerWhatsapp } from "@/lib/business-settings";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrAdmin } from "@/lib/permissions";
import { addAuditEvent } from "@/lib/audit";
import { bridgeFetch } from "@/lib/bridge/bridge-fetch";
import { saveCashCloseRecord } from "@/lib/cash-history";

type CashMovement = {
  id: number;
  type: "Gasto" | "Retiro" | "Ingreso extra";
  amount: number;
  reason: string;
  createdAt: string;
  userName?: string;
};

type Shift = {
  openedAt: string;
  sessionId: string;
  orderCounter: number;
  openingCash: number;
  status: "open";
  movements: CashMovement[];
  openedBy?: string;
};

type SavedOrder = {
  id: number;
  localOrderNumber?: number;
  shiftSessionId?: string;
  createdAt: string;
  total: number;
  details: {
    paymentMethod: string;
    orderType?: string;
  };
};

const SHIFT_KEY = "bpos_active_shift";
const ORDERS_KEY = "bpos_orders";

export default function CajaPage() {
  const [openingCash, setOpeningCash] = useState("");
  const [cashCounted, setCashCounted] = useState("");
  const [differenceReason, setDifferenceReason] = useState("");
  const [movementType, setMovementType] =
    useState<CashMovement["type"]>("Gasto");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [shift, setShift] = useState<Shift | null>(null);
  const [ordersVersion, setOrdersVersion] = useState(0);
  const [inventoryVersion, setInventoryVersion] = useState(0);

  useEffect(() => {
    const savedShift = localStorage.getItem(SHIFT_KEY);
    if (savedShift) {
      const parsed = JSON.parse(savedShift);
      const migrated: Shift = {
        ...parsed,
        sessionId:
          parsed.sessionId ||
          `shift-${parsed.openedAt}-${Math.random().toString(36).slice(2, 9)}`,
        orderCounter: Number(parsed.orderCounter || 0),
      };
      localStorage.setItem(SHIFT_KEY, JSON.stringify(migrated));
      setShift(migrated);
    }

    const refreshOrders = () => setOrdersVersion((value) => value + 1);
    const refreshShift = () => {
      const current = localStorage.getItem(SHIFT_KEY);
      setShift(current ? JSON.parse(current) : null);
    };
    window.addEventListener("storage", refreshOrders);
    window.addEventListener("focus", refreshOrders);
    window.addEventListener("bpos:orders-updated", refreshOrders);
    window.addEventListener("bpos:shift-updated", refreshShift);
    const refreshInventory = () => setInventoryVersion((value) => value + 1);
    window.addEventListener("bpos:inventory-alerts-updated", refreshInventory);

    return () => {
      window.removeEventListener("storage", refreshOrders);
      window.removeEventListener("focus", refreshOrders);
      window.removeEventListener("bpos:orders-updated", refreshOrders);
      window.removeEventListener("bpos:shift-updated", refreshShift);
      window.removeEventListener("bpos:inventory-alerts-updated", refreshInventory);
    };
  }, []);

  const shiftOrders = useMemo(() => {
    if (!shift) return [];

    const savedOrders = localStorage.getItem(ORDERS_KEY);
    const orders: SavedOrder[] = savedOrders ? JSON.parse(savedOrders) : [];

    return orders.filter((order) => {
      if (order.shiftSessionId) {
        return order.shiftSessionId === shift.sessionId;
      }

      return new Date(order.createdAt) >= new Date(shift.openedAt);
    });
  }, [shift, ordersVersion]);

  const totalSales = shiftOrders.reduce((sum, order) => sum + order.total, 0);

  const cashSales = shiftOrders
    .filter((order) => order.details.paymentMethod === "Efectivo")
    .reduce((sum, order) => sum + order.total, 0);

  const cardSales = shiftOrders
    .filter((order) => order.details.paymentMethod === "Tarjeta")
    .reduce((sum, order) => sum + order.total, 0);

  const transferSales = shiftOrders
    .filter((order) => order.details.paymentMethod === "Transferencia")
    .reduce((sum, order) => sum + order.total, 0);

  const cashOut = (shift?.movements || [])
    .filter((movement) => movement.type === "Gasto" || movement.type === "Retiro")
    .reduce((sum, movement) => sum + movement.amount, 0);

  const cashIn = (shift?.movements || [])
    .filter((movement) => movement.type === "Ingreso extra")
    .reduce((sum, movement) => sum + movement.amount, 0);

  const expectedCash = (shift?.openingCash || 0) + cashSales + cashIn - cashOut;
  const difference = Number(cashCounted || 0) - expectedCash;


  const pendingLowStock = useMemo(() => getPendingLowStock(), [inventoryVersion, shift]);
  const shoppingListSent = Boolean(shift && shoppingListWasSentForShift(shift.openedAt));

  function sendShoppingList() {
    if (!shift) return;
    const phone = getOwnerWhatsapp();
    if (!phone) {
      alert("Configura el WhatsApp del dueño en Configuración → Empresa y propietario.");
      window.location.href = "/configuracion/empresa";
      return;
    }

    const message = buildShoppingListMessage();
    const currentUser = getCurrentUser();
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
    markShoppingListSent(shift.openedAt, {
      sentBy: currentUser?.name || "Usuario del sistema",
      phone,
      items: pendingLowStock.map((item) => item.name),
    });
    addAuditEvent({
      category: "Caja",
      action: "shopping-list.sent",
      description: `Lista de compras enviada por WhatsApp con ${pendingLowStock.length} artículo(s).`,
      userName: currentUser?.name || "Usuario del sistema",
      entityId: shift.sessionId,
      metadata: { phone, items: pendingLowStock.map((item) => item.name) },
    });
    setInventoryVersion((value) => value + 1);
  }

  function saveShift(nextShift: Shift | null) {
    setShift(nextShift);

    if (nextShift) {
      localStorage.setItem(SHIFT_KEY, JSON.stringify(nextShift));
    } else {
      localStorage.removeItem(SHIFT_KEY);
    }
  }

  async function openShift() {
    const user = getCurrentUser();
    if (!(await requirePermissionOrAdmin(user, "cash.open", "abrir caja"))) return;
    const amount = Number(openingCash);

    if (amount <= 0) {
      alert("Captura un fondo inicial válido.");
      return;
    }

    const openedAt = new Date().toISOString();

    const currentUser = getCurrentUser();
    const nextShift: Shift = {
      openedAt,
      sessionId: `shift-${openedAt}-${Math.random().toString(36).slice(2, 9)}`,
      orderCounter: 0,
      openingCash: amount,
      status: "open",
      movements: [],
      openedBy: currentUser?.name || "Usuario del sistema",
    };
    saveShift(nextShift);
    addAuditEvent({
      category: "Caja",
      action: "cash.opened",
      description: `Caja abierta con fondo inicial de $${amount.toFixed(2)}.`,
      userName: nextShift.openedBy,
      entityId: nextShift.sessionId,
      metadata: { openingCash: amount, openedAt },
    });

    setOpeningCash("");
  }

  async function addMovement() {
    if (!shift) return;
    const permissionUser = getCurrentUser();
    if (!(await requirePermissionOrAdmin(permissionUser, "cash.movement", "registrar movimiento de caja"))) return;

    const amount = Number(movementAmount);

    if (amount <= 0) {
      alert("Captura un monto válido.");
      return;
    }

    if (movementReason.trim() === "") {
      alert("Captura un motivo para el movimiento.");
      return;
    }

    const currentUser = getCurrentUser();
    const movement: CashMovement = {
      id: Date.now(),
      type: movementType,
      amount,
      reason: movementReason,
      createdAt: new Date().toISOString(),
      userName: currentUser?.name || "Usuario del sistema",
    };

    saveShift({
      ...shift,
      movements: [...shift.movements, movement],
    });
    addAuditEvent({
      category: "Caja",
      action: "cash.movement.created",
      description: `${movement.type} por $${movement.amount.toFixed(2)}: ${movement.reason}`,
      userName: movement.userName,
      entityId: shift.sessionId,
      metadata: movement,
    });

    setMovementAmount("");
    setMovementReason("");
  }

  // No se cierra caja con pedidos de delivery sin equivalencia: se quedarían sin venta ni inventario
  async function closeShift() {
    if (!shift) return;
    try {
      const response = await bridgeFetch("/api/bridge/pending", { cache: "no-store" });
      const payload = (await response.json()) as { success?: boolean; pending?: { platform: string; orderId: string; externalName: string }[] };
      const pending = response.ok && payload.success ? payload.pending || [] : [];
      if (pending.length > 0) {
        const list = pending.slice(0, 8).map((p) => `• ${p.externalName} (${p.platform} #${p.orderId})`).join("\n");
        alert(
          `No puedes cerrar caja: hay ${pending.length} producto(s) de delivery sin equivalencia.\n\n${list}\n\n` +
            "Equivalelos en el Bridge para registrar las ventas y descontar el inventario."
        );
        return;
      }
      if (!response.ok) throw new Error("sin respuesta");
    } catch {
      if (!confirm("No se pudo revisar si hay pedidos de delivery sin equivalencia. ¿Cerrar caja de todos modos?")) return;
    }
    doCloseShift();
  }

  async function doCloseShift() {
  if (!shift) return;
  const permissionUser = getCurrentUser();
  if (!(await requirePermissionOrAdmin(permissionUser, "cash.close", "cerrar caja"))) return;

  if (pendingLowStock.length > 0 && !shoppingListWasSentForShift(shift.openedAt)) {
    alert("No podrás cerrar caja hasta enviar la lista de compras por WhatsApp.");
    return;
  }

  if (cashCounted === "") {
    alert("Captura el efectivo contado antes de cerrar.");
    return;
  }

  const counted = Number(cashCounted);
  const cutDifference = counted - expectedCash;

  if (cutDifference !== 0 && differenceReason.trim() === "") {
    alert("Captura el motivo del faltante o sobrante antes de cerrar.");
    return;
  }

  const uberSales = shiftOrders
    .filter((order) => order.details.orderType === "Uber Eats")
    .reduce((sum, order) => sum + order.total, 0);

  const didiSales = shiftOrders
    .filter((order) => order.details.orderType === "Didi Food")
    .reduce((sum, order) => sum + order.total, 0);

  const whatsappSales = shiftOrders
    .filter((order) => order.details.orderType === "WhatsApp")
    .reduce((sum, order) => sum + order.total, 0);

  const counterSales = shiftOrders
    .filter((order) => order.details.orderType === "Mostrador")
    .reduce((sum, order) => sum + order.total, 0);

  const movementsText =
    shift.movements.length === 0
      ? "Sin movimientos registrados."
      : shift.movements
          .map(
            (movement) =>
              `• ${movement.type}: $${movement.amount.toFixed(2)} - ${
                movement.reason
              }`
          )
          .join("\n");

  const cutFolio = `CC-${new Date()
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "")}-${Date.now().toString().slice(-4)}`;

  const currentUserForCut = getCurrentUser();
  const cashierName = currentUserForCut?.name || "Usuario del sistema";
  const message = `🍔 *BURGER PLANET*
📊 *CORTE DE CAJA*

🧾 Folio: ${cutFolio}
👤 Cajero: ${cashierName}
🕒 Apertura: ${new Date(shift.openedAt).toLocaleString()}
🕒 Cierre: ${new Date().toLocaleString()}

💰 Fondo inicial: $${shift.openingCash.toFixed(2)}

──────────────
*VENTAS POR MÉTODO*

💵 Efectivo: $${cashSales.toFixed(2)}
💳 Tarjeta: $${cardSales.toFixed(2)}
🏦 Transferencia: $${transferSales.toFixed(2)}

📈 Total ventas: $${totalSales.toFixed(2)}

──────────────
*VENTAS POR CANAL*

🏪 Mostrador: $${counterSales.toFixed(2)}
📱 WhatsApp: $${whatsappSales.toFixed(2)}
🍔 Uber Eats: $${uberSales.toFixed(2)}
🛵 Didi Food: $${didiSales.toFixed(2)}

──────────────
*MOVIMIENTOS DE CAJA*

${movementsText}

──────────────
*RESUMEN FINAL*

➕ Ingresos extra: $${cashIn.toFixed(2)}
📤 Gastos / Retiros: $${cashOut.toFixed(2)}

💵 Efectivo esperado: $${expectedCash.toFixed(2)}
💵 Efectivo contado: $${counted.toFixed(2)}
⚠️ Diferencia: $${cutDifference.toFixed(2)}
${cutDifference !== 0 ? `📝 Motivo: ${differenceReason.trim()}` : ""}

✅ Corte finalizado correctamente.`;

  const confirmed = confirm(
    `¿Cerrar turno y enviar corte por WhatsApp?\n\nFolio: ${cutFolio}\nEsperado: $${expectedCash.toFixed(
      2
    )}\nContado: $${counted.toFixed(2)}\nDiferencia: $${cutDifference.toFixed(2)}`
  );

  if (!confirmed) return;

  const phone = getOwnerWhatsapp();
  if (!phone) {
    alert("Configura el WhatsApp del dueño en Configuración → Empresa y propietario.");
    window.location.href = "/configuracion/empresa";
    return;
  }
  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(
    message
  )}`;

  window.open(whatsappUrl, "_blank");

  const closedAt = new Date().toISOString();
  const currentUser = getCurrentUser();
  const closedBy = currentUser?.name || "Usuario del sistema";
  const otherSales = Math.max(0, totalSales - counterSales - whatsappSales - uberSales - didiSales);
  const cutRecord = {
    id: `close-${shift.sessionId}`,
    folio: cutFolio,
    shiftSessionId: shift.sessionId,
    openedAt: shift.openedAt,
    closedAt,
    openedBy: shift.openedBy || "No registrado",
    closedBy,
    openingCash: shift.openingCash,
    countedCash: counted,
    expectedCash,
    difference: cutDifference,
    differenceReason: cutDifference !== 0 ? differenceReason.trim() : undefined,
    totalSales,
    orderCount: shiftOrders.length,
    salesByPayment: { cash: cashSales, card: cardSales, transfer: transferSales },
    salesByChannel: { counter: counterSales, whatsapp: whatsappSales, uber: uberSales, didi: didiSales, other: otherSales },
    cashIn,
    cashOut,
    movements: shift.movements,
    shoppingListSent: shoppingListWasSentForShift(shift.openedAt),
    whatsappPhone: phone,
    cutMessage: message,
    cutSentAt: closedAt,
  };
  saveCashCloseRecord(cutRecord);
  addAuditEvent({
    category: "Caja",
    action: "cash.closed",
    description: `Caja cerrada. Ventas $${totalSales.toFixed(2)}, diferencia $${cutDifference.toFixed(2)}.`,
    userName: closedBy,
    entityId: shift.sessionId,
    metadata: { folio: cutFolio, expectedCash, countedCash: counted, difference: cutDifference, differenceReason: cutRecord.differenceReason },
  });
  if (cutDifference !== 0) {
    addAuditEvent({
      category: "Caja",
      action: "cash.difference.recorded",
      description: `${cutDifference < 0 ? "Faltante" : "Sobrante"} de $${Math.abs(cutDifference).toFixed(2)} registrado: ${differenceReason.trim()}`,
      userName: closedBy,
      entityId: shift.sessionId,
      metadata: { difference: cutDifference, reason: differenceReason.trim() },
    });
  }

  clearLowStockAfterShiftClose();
  saveShift(null);
  setCashCounted("");
  setDifferenceReason("");
}

  return (
    <AppShell
      title="Caja"
      subtitle="Apertura, movimientos, efectivo esperado y cierre de turno."
    >
      <div className="mb-6 flex justify-end">
        <Link href="/caja/historial" className="rounded-2xl border border-orange-500/40 px-5 py-3 font-black text-orange-300 hover:bg-orange-500/10">
          Historial de cortes
        </Link>
      </div>
      {!shift ? (
        <section className="mx-auto max-w-xl rounded-3xl border border-zinc-800 bg-zinc-950 p-8">
          <p className="text-sm font-bold text-orange-500">Caja cerrada</p>
          <h2 className="mt-2 text-3xl font-black">Abrir turno</h2>
          <p className="mt-2 text-zinc-400">
            Captura el fondo inicial antes de comenzar a vender.
          </p>

          <label className="mt-8 block">
            <span className="mb-2 block text-sm font-bold text-zinc-400">
              Fondo inicial
            </span>
            <input
              type="number"
              value={openingCash}
              onChange={(event) => setOpeningCash(event.target.value)}
              placeholder="Ej. 1500"
              className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-4 text-2xl font-black text-white placeholder:text-zinc-700"
            />
          </label>

          <button
            onClick={openShift}
            className="mt-6 w-full rounded-2xl bg-orange-500 py-4 font-black text-black"
          >
            Abrir caja
          </button>
        </section>
      ) : (
        <section className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <Metric title="Estado" value="Abierta" />
            <Metric
              title="Fondo inicial"
              value={`$${shift.openingCash.toFixed(2)}`}
            />
            <Metric title="Pedidos del turno" value={shift.orderCounter.toString()} />
            <Metric title="Ventas turno" value={`$${totalSales.toFixed(2)}`} />
            <Metric
              title="Efectivo esperado"
              value={`$${expectedCash.toFixed(2)}`}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Metric title="Efectivo" value={`$${cashSales.toFixed(2)}`} />
            <Metric title="Tarjeta" value={`$${cardSales.toFixed(2)}`} />
            <Metric
              title="Transferencia"
              value={`$${transferSales.toFixed(2)}`}
            />
          </div>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-black">Movimientos de caja</h2>
            <p className="mt-2 text-zinc-400">
              Registra gastos, retiros o ingresos extra durante el turno.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[180px_1fr_2fr_auto]">
              <select
                value={movementType}
                onChange={(event) =>
                  setMovementType(event.target.value as CashMovement["type"])
                }
                className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
              >
                <option>Gasto</option>
                <option>Retiro</option>
                <option>Ingreso extra</option>
              </select>

              <input
                type="number"
                value={movementAmount}
                onChange={(event) => setMovementAmount(event.target.value)}
                placeholder="Monto"
                className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
              />

              <input
                value={movementReason}
                onChange={(event) => setMovementReason(event.target.value)}
                placeholder="Motivo obligatorio"
                className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
              />

              <button
                onClick={addMovement}
                className="rounded-2xl bg-orange-500 px-6 py-3 font-black text-black"
              >
                Agregar
              </button>
            </div>

            <div className="mt-6 space-y-3">
              {shift.movements.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
                  Sin movimientos registrados.
                </div>
              ) : (
                shift.movements.map((movement) => (
                  <div
                    key={movement.id}
                    className="flex flex-col justify-between gap-3 rounded-2xl border border-zinc-800 bg-black p-4 md:flex-row md:items-center"
                  >
                    <div>
                      <p className="font-black">{movement.type}</p>
                      <p className="text-sm text-zinc-400">
                        {movement.reason}
                      </p>
                      <p className="text-xs text-zinc-600">
                        {new Date(movement.createdAt).toLocaleString()}
                      </p>
                    </div>

                    <p
                      className={`text-xl font-black ${
                        movement.type === "Ingreso extra"
                          ? "text-green-400"
                          : "text-red-400"
                      }`}
                    >
                      {movement.type === "Ingreso extra" ? "+" : "-"}$
                      {movement.amount.toFixed(2)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          {pendingLowStock.length > 0 && (
            <section className="rounded-3xl border border-yellow-400/50 bg-yellow-400/10 p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-black text-yellow-300">🟡 Lista de faltantes pendiente</h2>
                  <p className="mt-2 text-sm text-yellow-100/80">
                    No podrás cerrar caja hasta enviar la lista de compras por WhatsApp.
                  </p>
                  <p className="mt-2 text-sm font-bold text-yellow-200">
                    {pendingLowStock.map((item) => item.name).join(", ")}
                  </p>
                </div>
                <button
                  onClick={sendShoppingList}
                  className="rounded-2xl bg-yellow-300 px-6 py-4 font-black text-black"
                >
                  {shoppingListSent ? "Lista enviada ✓" : "Enviar lista por WhatsApp"}
                </button>
              </div>
            </section>
          )}

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-black">Cerrar turno</h2>
            <p className="mt-2 text-zinc-400">
              Captura el efectivo contado para calcular diferencia.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              <label>
                <span className="mb-2 block text-sm font-bold text-zinc-400">
                  Efectivo contado
                </span>
                <input
                  type="number"
                  value={cashCounted}
                  onChange={(event) => setCashCounted(event.target.value)}
                  placeholder="Ej. 2320"
                  className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-4 text-white"
                />
              </label>

              <Metric title="Esperado" value={`$${expectedCash.toFixed(2)}`} />
              <Metric title="Diferencia" value={`$${difference.toFixed(2)}`} />
            </div>

            {difference !== 0 && (
              <label className="mt-5 block">
                <span className="mb-2 block text-sm font-bold text-yellow-300">Motivo del faltante o sobrante</span>
                <textarea
                  value={differenceReason}
                  onChange={(event) => setDifferenceReason(event.target.value)}
                  placeholder="Ej. Faltante pendiente de revisión"
                  className="min-h-24 w-full rounded-2xl border border-yellow-500/30 bg-black px-4 py-3 text-white"
                />
              </label>
            )}

            <button
              onClick={() => void closeShift()}
              className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/10 px-6 py-4 font-black text-red-400"
            >
              Cerrar caja
            </button>
          </section>
        </section>
      )}
    </AppShell>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <p className="text-sm text-zinc-400">{title}</p>
      <p className="mt-2 text-2xl font-black text-orange-500">{value}</p>
    </div>
  );
}