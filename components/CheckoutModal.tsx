"use client";

import { useEffect, useState } from "react";
import { getEnabledPaymentMethods } from "@/lib/payment-methods";
import { AmountInput, cashQuickAmounts } from "@/components/AmountInput";
import { checkCoupon, normalizeCode } from "@/lib/coupons";
import { DRIVERS_EVENT, getDrivers, type Driver } from "@/lib/drivers";

export type PaymentMethod = string;

type CheckoutModalProps = {
  total: number;
  /** Saldo de cashback del socio del club (0 = no hay) */
  clubCashback?: number;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: {
    paymentMethod: PaymentMethod;
    cashReceived: number;
    cardAmount: number;
    transferAmount: number;
    discount: number;
    couponCode?: string;
    clubCashback?: number;
    address?: string;
    driver?: Driver;
    deliveryFee?: number;
    /** A domicilio en espera: se manda a preparar y se cobra cuando regrese el repartidor */
    pending?: boolean;
  }) => void;
  /** Pedido a domicilio: se pide la dirección y el repartidor aquí */
  delivery?: { address: string };
  /** Cobro de una cuenta en espera: encabezado con su folio */
  heading?: string;
};

export function CheckoutModal({
  total,
  clubCashback = 0,
  isOpen,
  onClose,
  onConfirm,
  delivery,
  heading,
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
  const [useClub, setUseClub] = useState(false);
  const [availableMethods, setAvailableMethods] = useState<string[]>(["Efectivo","Tarjeta","Transferencia","Mixto"]);
  const [address, setAddress] = useState("");
  const [driverId, setDriverId] = useState("");
  const [deliveryFee, setDeliveryFee] = useState("");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const isDelivery = Boolean(delivery);
  const deliveryAddress = delivery ? delivery.address : "";

  // Al abrir un cobro a domicilio: la dirección que ya tenga el pedido y los repartidores activos
  useEffect(() => {
    if (!isOpen || !isDelivery) return;
    const sync = () => setDrivers(getDrivers().filter((d) => d.active));
    const t = window.setTimeout(() => {
      setAddress(deliveryAddress);
      setDriverId("");
      setDeliveryFee("");
      sync();
    }, 0);
    window.addEventListener(DRIVERS_EVENT, sync);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener(DRIVERS_EVENT, sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir
  }, [isOpen, isDelivery]);

  useEffect(() => {
    const load = () => setAvailableMethods(getEnabledPaymentMethods().filter((item) => item.channel !== "platform").map((item) => item.name));
    load();
    window.addEventListener("bpos:payment-methods-updated", load);
    return () => window.removeEventListener("bpos:payment-methods-updated", load);
  }, []);

  if (!isOpen) return null;

  const baseDiscount = coupon ? coupon.discount : Number(discount) || 0;
  /** Saldo del club que se usa (lo que alcance a cubrir) */
  const clubUsed = useClub && clubCashback > 0 ? Math.round(Math.min(clubCashback, Math.max(0, total - baseDiscount)) * 100) / 100 : 0;
  const discountNumber = baseDiscount + clubUsed;

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
    setUseClub(false);
    onClose();
  }
  const feeNumber = isDelivery ? Math.max(0, Number(deliveryFee) || 0) : 0;
  const finalTotal = Math.max(total - discountNumber, 0) + feeNumber;
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

  const missingAddress = isDelivery && address.trim() === "";
  const canConfirm = paidTotal >= finalTotal && !missingAddress;

  function confirmCheckout() {
    if (missingAddress) {
      alert("Escribe la dirección a donde se lleva el pedido.");
      return;
    }
    if (!canConfirm) {
      alert("El pago no cubre el total.");
      return;
    }

    const driver = drivers.find((d) => d.id === driverId);
    onConfirm({
      ...(isDelivery ? { address: address.trim(), deliveryFee: feeNumber } : {}),
      ...(driver ? { driver } : {}),
      paymentMethod,
      cashReceived: cashNumber,
      cardAmount: cardNumber,
      transferAmount: transferNumber,
      discount: discountNumber,
      ...(coupon ? { couponCode: coupon.code } : {}),
      ...(clubUsed > 0 ? { clubCashback: clubUsed } : {}),
    });
    setCoupon(null);
    setCouponInput("");
    setUseClub(false);
  }

  /** A domicilio: se prepara ya y el repartidor trae el dinero */
  function confirmPending() {
    if (missingAddress) {
      alert("Escribe la dirección a donde se lleva el pedido.");
      return;
    }
    const driver = drivers.find((d) => d.id === driverId);
    onConfirm({
      address: address.trim(),
      deliveryFee: feeNumber,
      pending: true,
      ...(driver ? { driver } : {}),
      paymentMethod,
      cashReceived: 0,
      cardAmount: 0,
      transferAmount: 0,
      discount: discountNumber,
      ...(coupon ? { couponCode: coupon.code } : {}),
      ...(clubUsed > 0 ? { clubCashback: clubUsed } : {}),
    });
    setCoupon(null);
    setCouponInput("");
    setUseClub(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur">
      <section className="w-full max-w-xl rounded-3xl border border-zinc-800 bg-zinc-950 p-6 text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-orange-500">Cobro</p>
            <h2 className="text-3xl font-black">{heading || "Finalizar pedido"}</h2>
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

          {clubCashback > 0 && (
            <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
              <span className="font-black text-emerald-300">⭐ Usar saldo del club (${clubCashback.toFixed(2)})</span>
              <input type="checkbox" checked={useClub} onChange={(e) => setUseClub(e.target.checked)} className="h-5 w-5 accent-emerald-500" />
            </label>
          )}
          {clubUsed > 0 && <p className="mt-1 text-xs text-emerald-400">Se usan ${clubUsed.toFixed(2)} de su saldo.</p>}

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

          {feeNumber > 0 && (
            <div className="mt-3 flex justify-between">
              <span className="text-zinc-400">Envío</span>
              <span className="font-black">+${feeNumber.toFixed(2)}</span>
            </div>
          )}

          <div className="mt-4 flex justify-between border-t border-zinc-800 pt-4">
            <span className="text-zinc-400">Total a pagar</span>
            <span className="text-3xl font-black text-orange-500">
              ${finalTotal.toFixed(2)}
            </span>
          </div>
        </div>

        {isDelivery && (
          <div className="mt-6 rounded-2xl border border-orange-500/40 bg-orange-500/5 p-4">
            <p className="text-sm font-black text-orange-400">🛵 A domicilio</p>
            <div className="mt-2 grid gap-3 md:grid-cols-[1fr_120px_200px]">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-zinc-400">Dirección</span>
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={2}
                  placeholder="Calle, número y referencia"
                  className="w-full rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-zinc-400">Costo de envío</span>
                <input
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={deliveryFee}
                  onChange={(e) => setDeliveryFee(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-zinc-400">Repartidor</span>
                <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className="w-full rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-white">
                  <option value="">Elegir después</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-zinc-500">{drivers.length ? "Se le manda el pedido por WhatsApp al cobrar." : "Agrega repartidores en Configuración → Reparto."}</span>
              </label>
            </div>
            <button
              onClick={confirmPending}
              disabled={missingAddress}
              className="mt-3 w-full rounded-2xl border border-yellow-500/50 bg-yellow-500/10 py-3 font-black text-yellow-200 hover:bg-yellow-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ⏳ Mandar a preparar · cobrar cuando regrese el repartidor
            </button>
            <p className="mt-1 text-center text-[11px] text-zinc-500">El pedido queda &quot;por cobrar&quot; en el historial hasta que marques que ya pagó.</p>
          </div>
        )}

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