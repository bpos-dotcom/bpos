"use client";

import { useEffect, useState } from "react";
import { getEnabledPaymentMethods } from "@/lib/payment-methods";
import { AmountInput, cashQuickAmounts } from "@/components/AmountInput";
import { checkCoupon, normalizeCode } from "@/lib/coupons";

export type PaymentMethod = string;

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
    couponCode?: string;
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
  /** Cupón aplicado: su descuento no pide autorización */
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [couponError, setCouponError] = useState("");
  const [availableMethods, setAvailableMethods] = useState<string[]>(["Efectivo","Tarjeta","Transferencia","Mixto"]);

  useEffect(() => {
    const load = () => setAvailableMethods(getEnabledPaymentMethods().filter((item) => item.channel !== "platform").map((item) => item.name));
    load();
    window.addEventListener("bpos:payment-methods-updated", load);
    return () => window.removeEventListener("bpos:payment-methods-updated", load);
  }, []);

  if (!isOpen) return null;

  const discountNumber = coupon ? coupon.discount : Number(discount) || 0;

  function applyCoupon() {
    const check = checkCoupon(couponInput, total, "pos");
    if (!check.ok) {
      setCouponError(check.error);
      return;
    }
    setCouponError("");
    setCoupon({ code: check.coupon.code, discount: check.discount });
  }

  function close() {
    setCoupon(null);
    setCouponInput("");
    setCouponError("");
    onClose();
  }
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
      ...(coupon ? { couponCode: coupon.code } : {}),
    });
    setCoupon(null);
    setCouponInput("");
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
            onClick={close}
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
              🎟️ Cupón
            </label>
            {coupon ? (
              <div className="flex items-center justify-between rounded-2xl border border-emerald-500/50 bg-emerald-500/10 px-4 py-3">
                <span className="font-black text-emerald-300">
                  {coupon.code} · -${coupon.discount.toFixed(2)}
                </span>
                <button onClick={() => setCoupon(null)} className="text-xs font-black text-zinc-400 underline">
                  Quitar
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  value={couponInput}
                  onChange={(e) => setCouponInput(normalizeCode(e.target.value))}
                  onKeyDown={(e) => e.key === "Enter" && applyCoupon()}
                  placeholder="Código"
                  className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 font-mono uppercase text-white"
                />
                <button onClick={applyCoupon} disabled={!couponInput} className="rounded-2xl border border-orange-500 px-4 font-black text-orange-300 disabled:opacity-40">
                  Aplicar
                </button>
              </div>
            )}
            {couponError && <p className="mt-1 text-xs font-bold text-red-400">{couponError}</p>}
          </div>

          {!coupon && (
            <div className="mt-3">
              <label className="mb-2 block text-sm font-bold text-zinc-400">
                Descuento
              </label>
              <AmountInput
                label="Descuento"
                value={discount}
                onChange={setDiscount}
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white"
              />
              <p className="mt-2 text-xs text-red-400">
                Si agregas descuento, se pedirá autorización Admin al confirmar.
              </p>
            </div>
          )}

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
            {availableMethods.map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
        </div>

        {(paymentMethod === "Efectivo" || paymentMethod === "Mixto") && (
          <div className="mt-4">
            <label className="mb-2 block text-sm font-bold text-zinc-400">
              Efectivo recibido
            </label>
            <AmountInput
              label="Efectivo recibido"
              value={cashReceived}
              onChange={setCashReceived}
              quick={cashQuickAmounts(finalTotal)}
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
              <AmountInput
                label="Tarjeta"
                value={cardAmount}
                onChange={setCardAmount}
                className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-zinc-400">
                Transferencia
              </label>
              <AmountInput
                label="Transferencia"
                value={transferAmount}
                onChange={setTransferAmount}
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
            onClick={close}
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