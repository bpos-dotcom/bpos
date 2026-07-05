"use client";

import { useState } from "react";

export type PaymentMethod = "Efectivo" | "Tarjeta" | "Transferencia" | "Mixto";

type CheckoutModalProps = {
  total: number;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: {
    paymentMethod: PaymentMethod;
    cashReceived: number;
    cardAmount: number;
    transferAmount: number;
    discount: number;
  }) => void;
};

export function CheckoutModal({
  total,
  isOpen,
  onClose,
  onConfirm,
}: CheckoutModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Efectivo");
  const [cashReceived, setCashReceived] = useState("");
  const [cardAmount, setCardAmount] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [discount, setDiscount] = useState("");

  if (!isOpen) return null;

  const discountNumber = Number(discount) || 0;
  const finalTotal = Math.max(total - discountNumber, 0);
  const cashNumber = Number(cashReceived) || 0;
  const cardNumber = Number(cardAmount) || 0;
  const transferNumber = Number(transferAmount) || 0;

  const paidTotal =
    paymentMethod === "Efectivo"
      ? cashNumber
      : paymentMethod === "Tarjeta"
      ? finalTotal
      : paymentMethod === "Transferencia"
      ? finalTotal
      : cashNumber + cardNumber + transferNumber;

  const change =
    paymentMethod === "Efectivo" || paymentMethod === "Mixto"
      ? Math.max(paidTotal - finalTotal, 0)
      : 0;

  const canConfirm = paidTotal >= finalTotal;

  function confirmCheckout() {
    if (!canConfirm) {
      alert("El pago no cubre el total.");
      return;
    }

    onConfirm({
      paymentMethod,
      cashReceived: cashNumber,
      cardAmount: cardNumber,
      transferAmount: transferNumber,
      discount: discountNumber,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur">
      <section className="w-full max-w-xl rounded-3xl border border-zinc-800 bg-zinc-950 p-6 text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-orange-500">Cobro</p>
            <h2 className="text-3xl font-black">Finalizar pedido</h2>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl border border-zinc-800 bg-black px-4 py-2 font-black"
          >
            ✕
          </button>
        </div>

        <div className="mt-6 rounded-3xl border border-zinc-800 bg-black p-5">
          <div className="flex justify-between">
            <span className="text-zinc-400">Total original</span>
            <span className="font-black">${total.toFixed(2)}</span>
          </div>

          <div className="mt-3">
            <label className="mb-2 block text-sm font-bold text-zinc-400">
              Descuento
            </label>
            <input
              type="number"
              value={discount}
              onChange={(event) => setDiscount(event.target.value)}
              placeholder="0"
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white"
            />
            <p className="mt-2 text-xs text-red-400">
              Si agregas descuento, se pedirá autorización Admin al confirmar.
            </p>
          </div>

          <div className="mt-4 flex justify-between border-t border-zinc-800 pt-4">
            <span className="text-zinc-400">Total a pagar</span>
            <span className="text-3xl font-black text-orange-500">
              ${finalTotal.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="mt-6">
          <label className="mb-2 block text-sm font-bold text-zinc-400">
            Método de pago
          </label>

          <select
            value={paymentMethod}
            onChange={(event) =>
              setPaymentMethod(event.target.value as PaymentMethod)
            }
            className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
          >
            <option>Efectivo</option>
            <option>Tarjeta</option>
            <option>Transferencia</option>
            <option>Mixto</option>
          </select>
        </div>

        {(paymentMethod === "Efectivo" || paymentMethod === "Mixto") && (
          <div className="mt-4">
            <label className="mb-2 block text-sm font-bold text-zinc-400">
              Efectivo recibido
            </label>
            <input
              type="number"
              value={cashReceived}
              onChange={(event) => setCashReceived(event.target.value)}
              placeholder="0"
              className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
            />
          </div>
        )}

        {paymentMethod === "Mixto" && (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-bold text-zinc-400">
                Tarjeta
              </label>
              <input
                type="number"
                value={cardAmount}
                onChange={(event) => setCardAmount(event.target.value)}
                placeholder="0"
                className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-zinc-400">
                Transferencia
              </label>
              <input
                type="number"
                value={transferAmount}
                onChange={(event) => setTransferAmount(event.target.value)}
                placeholder="0"
                className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
              />
            </div>
          </div>
        )}

        <div className="mt-6 rounded-3xl border border-zinc-800 bg-black p-5">
          <div className="flex justify-between">
            <span className="text-zinc-400">Pagado</span>
            <span className="font-black">${paidTotal.toFixed(2)}</span>
          </div>

          <div className="mt-3 flex justify-between">
            <span className="text-zinc-400">Cambio</span>
            <span className="text-3xl font-black text-green-400">
              ${change.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          <button
            onClick={onClose}
            className="rounded-2xl border border-zinc-800 bg-black py-4 font-black"
          >
            Cancelar
          </button>

          <button
            onClick={confirmCheckout}
            disabled={!canConfirm}
            className="rounded-2xl bg-orange-500 py-4 font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cobrar
          </button>
        </div>
      </section>
    </div>
  );
}