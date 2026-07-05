"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";

type CashMovement = {
  id: number;
  type: "Gasto" | "Retiro" | "Ingreso extra";
  amount: number;
  reason: string;
  createdAt: string;
};

type Shift = {
  openedAt: string;
  openingCash: number;
  status: "open";
  movements: CashMovement[];
};

type SavedOrder = {
  id: number;
  createdAt: string;
  total: number;
  details: {
    paymentMethod: string;
  };
};

const SHIFT_KEY = "bpos_active_shift";
const ORDERS_KEY = "bpos_orders";

export default function CajaPage() {
  const [openingCash, setOpeningCash] = useState("");
  const [cashCounted, setCashCounted] = useState("");
  const [movementType, setMovementType] =
    useState<CashMovement["type"]>("Gasto");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [shift, setShift] = useState<Shift | null>(null);

  useEffect(() => {
    const savedShift = localStorage.getItem(SHIFT_KEY);
    if (savedShift) setShift(JSON.parse(savedShift));
  }, []);

  const shiftOrders = useMemo(() => {
    if (!shift) return [];

    const savedOrders = localStorage.getItem(ORDERS_KEY);
    const orders: SavedOrder[] = savedOrders ? JSON.parse(savedOrders) : [];

    return orders.filter(
      (order) => new Date(order.createdAt) >= new Date(shift.openedAt)
    );
  }, [shift]);

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

  function saveShift(nextShift: Shift | null) {
    setShift(nextShift);

    if (nextShift) {
      localStorage.setItem(SHIFT_KEY, JSON.stringify(nextShift));
    } else {
      localStorage.removeItem(SHIFT_KEY);
    }
  }

  function openShift() {
    const amount = Number(openingCash);

    if (amount <= 0) {
      alert("Captura un fondo inicial válido.");
      return;
    }

    saveShift({
      openedAt: new Date().toISOString(),
      openingCash: amount,
      status: "open",
      movements: [],
    });

    setOpeningCash("");
  }

  function addMovement() {
    if (!shift) return;

    const amount = Number(movementAmount);

    if (amount <= 0) {
      alert("Captura un monto válido.");
      return;
    }

    if (movementReason.trim() === "") {
      alert("Captura un motivo para el movimiento.");
      return;
    }

    const movement: CashMovement = {
      id: Date.now(),
      type: movementType,
      amount,
      reason: movementReason,
      createdAt: new Date().toISOString(),
    };

    saveShift({
      ...shift,
      movements: [...shift.movements, movement],
    });

    setMovementAmount("");
    setMovementReason("");
  }

  function closeShift() {
  if (!shift) return;

  if (cashCounted === "") {
    alert("Captura el efectivo contado antes de cerrar.");
    return;
  }

  const counted = Number(cashCounted);
  const cutDifference = counted - expectedCash;

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

  const message = `🍔 *BURGER PLANET*
📊 *CORTE DE CAJA*

🧾 Folio: ${cutFolio}
👤 Cajero: Gerardo Chavarria
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

✅ Corte finalizado correctamente.`;

  const confirmed = confirm(
    `¿Cerrar turno y enviar corte por WhatsApp?\n\nFolio: ${cutFolio}\nEsperado: $${expectedCash.toFixed(
      2
    )}\nContado: $${counted.toFixed(2)}\nDiferencia: $${cutDifference.toFixed(2)}`
  );

  if (!confirmed) return;

  const phone = "528131241417";
  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(
    message
  )}`;

  window.open(whatsappUrl, "_blank");

  saveShift(null);
  setCashCounted("");
}

  return (
    <AppShell
      title="Caja"
      subtitle="Apertura, movimientos, efectivo esperado y cierre de turno."
    >
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Metric title="Estado" value="Abierta" />
            <Metric
              title="Fondo inicial"
              value={`$${shift.openingCash.toFixed(2)}`}
            />
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

            <button
              onClick={closeShift}
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