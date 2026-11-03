"use client";
/**
 * Ventana de cobro del POS:
 *   - cupón, descuento, saldo del club, envío (a domicilio)
 *   - propina opcional (Configuración → Métodos de pago)
 *   - método: efectivo, tarjeta, transferencia o mixto (cuánto con cada uno)
 *   - cuentas en espera / de mesa: dividir entre personas o por productos
 * Regresa cuánto se pagó con cada método (sin propina) y la propina aparte.
 */
import { useEffect, useRef, useState } from "react";
import { getEnabledPaymentMethods } from "@/lib/payment-methods";
import { AmountInput, cashQuickAmounts } from "@/components/AmountInput";
import { checkCoupon, normalizeCode } from "@/lib/coupons";
import { DRIVERS_EVENT, getDrivers, type Driver } from "@/lib/drivers";
import { getBusinessSettings } from "@/lib/business-settings";
import { allocate } from "@/lib/sale-payments";
import { openCashDrawer } from "@/lib/localService";

export type PaymentMethod = string;

/** Renglón de una cuenta que se puede dividir por productos */
export type SplitLine = { key: string; name: string; price: number; quantity: number };

export type CheckoutResult = {
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
  /** Venta (sin propina) por método, ya con el cambio descontado */
  payments: Record<string, number>;
  tip: number;
  tipPayments: Record<string, number>;
  /** Cuenta dividida entre personas: esta parte (venta, sin propina) */
  splitAmount?: number;
  /** Cuenta dividida por productos: qué se paga ahora */
  splitItems?: { key: string; quantity: number }[];
  /** El cajón ya se abrió al abrir el cobro (no volver a abrirlo con el ticket) */
  drawerOpened?: boolean;
};

type CheckoutModalProps = {
  /** Lo que falta por pagar (venta, sin propina) */
  total: number;
  /** Saldo de cashback del socio del club (0 = no hay) */
  clubCashback?: number;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: CheckoutResult) => void;
  /** Pedido a domicilio: se pide la dirección y el repartidor aquí */
  delivery?: { address: string };
  /** Cobro de una cuenta en espera: encabezado con su folio */
  heading?: string;
  /** Cuenta en espera o de mesa: se puede dividir */
  split?: { lines: SplitLine[]; fullTotal: number; partsPaid: number };
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${n.toFixed(2)}`;

export function CheckoutModal({ total, clubCashback = 0, isOpen, onClose, onConfirm, delivery, heading, split }: CheckoutModalProps) {
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
  const [availableMethods, setAvailableMethods] = useState<string[]>(["Efectivo", "Tarjeta", "Transferencia", "Mixto"]);
  const [address, setAddress] = useState("");
  const [driverId, setDriverId] = useState("");
  const [deliveryFee, setDeliveryFee] = useState("");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  // Propina
  const [tips, setTips] = useState({ enabled: false, suggestions: [10, 15, 20] });
  const [tipPct, setTipPct] = useState<number | null>(null);
  const [tipCustom, setTipCustom] = useState("");
  // Dividir
  const [splitMode, setSplitMode] = useState<"none" | "persons" | "items">("none");
  const [persons, setPersons] = useState(2);
  const [picked, setPicked] = useState<Record<string, number>>({});
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
    const loadTips = () => {
      const s = getBusinessSettings();
      setTips({ enabled: s.tipsEnabled, suggestions: s.tipSuggestions });
    };
    load();
    loadTips();
    window.addEventListener("bpos:payment-methods-updated", load);
    window.addEventListener("bpos:business-settings-updated", loadTips);
    return () => {
      window.removeEventListener("bpos:payment-methods-updated", load);
      window.removeEventListener("bpos:business-settings-updated", loadTips);
    };
  }, []);

  // El cajón se abre en cuanto el cobro es en efectivo (o mixto), una vez por cobro,
  // sin esperar a capturar el pago ni a que salga el ticket.
  // (Va antes del `return null`: los hooks deben correr en cada render.)
  const drawerOpened = useRef(false);
  const wantsDrawer = paymentMethod === "Efectivo" || paymentMethod === "Mixto";
  useEffect(() => {
    if (!isOpen) {
      drawerOpened.current = false;
      return;
    }
    if (!wantsDrawer || drawerOpened.current || total <= 0) return;
    drawerOpened.current = true;
    void openCashDrawer().then((opened) => {
      if (!opened) drawerOpened.current = false; // Agent viejo o sin cajón: se abrirá con el ticket
    });
  }, [isOpen, wantsDrawer, total]);

  if (!isOpen) return null;

  // ----- Cuánto se cobra ahora -----
  const lines = split?.lines || [];
  const pickedSum = round2(lines.reduce((s, l) => s + l.price * Math.min(l.quantity, picked[l.key] || 0), 0));
  const perPerson = split ? round2(split.fullTotal / Math.max(1, persons)) : 0;
  const base = !split || splitMode === "none" ? total : splitMode === "persons" ? Math.min(total, perPerson) : Math.min(total, pickedSum);

  const baseDiscount = coupon ? coupon.discount : Number(discount) || 0;
  /** Saldo del club que se usa (lo que alcance a cubrir) */
  const clubUsed = useClub && clubCashback > 0 ? round2(Math.min(clubCashback, Math.max(0, base - baseDiscount))) : 0;
  const discountNumber = baseDiscount + clubUsed;
  const feeNumber = isDelivery ? Math.max(0, Number(deliveryFee) || 0) : 0;
  /** Venta a cobrar (sin propina) */
  const finalTotal = round2(Math.max(base - discountNumber, 0) + feeNumber);
  const tip = tips.enabled ? round2(tipPct !== null ? (finalTotal * tipPct) / 100 : Math.max(0, Number(tipCustom) || 0)) : 0;
  const toPay = round2(finalTotal + tip);

  function applyCoupon() {
    const check = checkCoupon(couponInput, base, "pos");
    if (!check.ok) {
      setCouponError(check.error);
      return;
    }
    setCouponError("");
    setCoupon({ code: check.coupon.code, discount: check.discount });
  }

  function resetAll() {
    setCoupon(null);
    setCouponInput("");
    setCouponError("");
    setUseClub(false);
    setTipPct(null);
    setTipCustom("");
    setCashReceived("");
    setCardAmount("");
    setTransferAmount("");
    setDiscount("");
    setPicked({});
  }
  function close() {
    resetAll();
    setSplitMode("none");
    setPaymentMethod("Efectivo");
    onClose();
  }

  const cashNumber = Number(cashReceived) || 0;
  const cardNumber = Number(cardAmount) || 0;
  const transferNumber = Number(transferAmount) || 0;
  const isCash = paymentMethod === "Efectivo";
  const isMixed = paymentMethod === "Mixto";

  const paidTotal = isCash ? cashNumber : isMixed ? round2(cashNumber + cardNumber + transferNumber) : toPay;
  const change = isCash || isMixed ? round2(Math.max(paidTotal - toPay, 0)) : 0;

  const missingAddress = isDelivery && address.trim() === "";
  const nothingPicked = Boolean(split) && splitMode === "items" && pickedSum <= 0;
  const canConfirm = paidTotal >= toPay - 0.001 && !missingAddress && !nothingPicked && toPay > 0;

  /** Venta y propina por método: en mixto primero tarjeta, luego transferencia y el resto efectivo */
  function breakdown() {
    if (!isMixed) {
      const m = paymentMethod;
      return { payments: finalTotal > 0 ? { [m]: finalTotal } : {}, tipPayments: tip > 0 ? { [m]: tip } : {} };
    }
    const payments = allocate(finalTotal, [
      ["Tarjeta", cardNumber],
      ["Transferencia", transferNumber],
      ["Efectivo", Infinity],
    ]);
    const leftCard = round2(cardNumber - (payments.Tarjeta || 0));
    const leftTransfer = round2(transferNumber - (payments.Transferencia || 0));
    const tipPayments = tip > 0 ? allocate(tip, [["Tarjeta", leftCard], ["Transferencia", leftTransfer], ["Efectivo", Infinity]]) : {};
    return { payments, tipPayments };
  }

  function result(extra: Partial<CheckoutResult>): CheckoutResult {
    const driver = drivers.find((d) => d.id === driverId);
    return {
      ...(isDelivery ? { address: address.trim(), deliveryFee: feeNumber } : {}),
      ...(driver ? { driver } : {}),
      paymentMethod,
      drawerOpened: drawerOpened.current,
      cashReceived: cashNumber,
      cardAmount: cardNumber,
      transferAmount: transferNumber,
      discount: discountNumber,
      ...(coupon ? { couponCode: coupon.code } : {}),
      ...(clubUsed > 0 ? { clubCashback: clubUsed } : {}),
      tip,
      ...breakdown(),
      ...(split && splitMode === "persons" ? { splitAmount: finalTotal } : {}),
      ...(split && splitMode === "items" ? { splitItems: lines.filter((l) => (picked[l.key] || 0) > 0).map((l) => ({ key: l.key, quantity: Math.min(l.quantity, picked[l.key]) })) } : {}),
      ...extra,
    };
  }

  function confirmCheckout() {
    if (missingAddress) {
      alert("Escribe la dirección a donde se lleva el pedido.");
      return;
    }
    if (nothingPicked) {
      alert("Marca qué productos se pagan ahora.");
      return;
    }
    if (!canConfirm) {
      alert("El pago no cubre el total.");
      return;
    }
    onConfirm(result({}));
    resetAll();
  }

  /** A domicilio: se prepara ya y el repartidor trae el dinero */
  function confirmPending() {
    if (missingAddress) {
      alert("Escribe la dirección a donde se lleva el pedido.");
      return;
    }
    onConfirm(result({ pending: true, cashReceived: 0, cardAmount: 0, transferAmount: 0, payments: {}, tip: 0, tipPayments: {} }));
    resetAll();
  }

  const partLabel = split && splitMode === "persons" ? `Parte ${split.partsPaid + 1} de ${persons}` : split && splitMode === "items" ? "Estos productos" : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur sm:p-6">
      <section className="max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950 p-5 text-white sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-bold text-orange-500">Cobro</p>
            <h2 className="text-2xl font-black sm:text-3xl">{heading || "Finalizar pedido"}</h2>
          </div>
          <button onClick={close} className="rounded-xl border border-zinc-800 bg-black px-4 py-2 font-black">
            ✕
          </button>
        </div>

        {split && (
          <div className="mt-5 rounded-2xl border border-zinc-800 bg-black p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black text-zinc-300">
                ✂️ Dividir cuenta{split.partsPaid > 0 ? <span className="ml-2 text-xs font-bold text-emerald-400">· {split.partsPaid} {split.partsPaid === 1 ? "parte pagada" : "partes pagadas"}, faltan {money(total)}</span> : null}
              </p>
              <div className="flex gap-1 rounded-xl border border-zinc-800 p-1 text-xs font-black">
                {(["none", "persons", "items"] as const).map((m) => (
                  <button key={m} onClick={() => setSplitMode(m)} className={`rounded-lg px-3 py-1.5 ${splitMode === m ? "bg-orange-500 text-black" : "text-zinc-400 hover:text-white"}`}>
                    {m === "none" ? "Todo" : m === "persons" ? "Entre personas" : "Por productos"}
                  </button>
                ))}
              </div>
            </div>
            {splitMode === "persons" && (
              <div className="mt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-zinc-400">¿Entre cuántos?</span>
                  {[2, 3, 4, 5, 6, 8].map((n) => (
                    <button key={n} onClick={() => setPersons(n)} className={`h-10 w-10 rounded-xl border font-black ${persons === n ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 bg-zinc-900"}`}>
                      {n}
                    </button>
                  ))}
                  <input type="number" min={2} max={30} value={persons} onChange={(e) => setPersons(Math.max(2, Math.min(30, Number(e.target.value) || 2)))} className="h-10 w-16 rounded-xl border border-zinc-800 bg-zinc-900 px-2 text-center font-black" aria-label="Personas" />
                </div>
                <p className="mt-2 text-sm text-zinc-400">
                  Cada quien paga <b className="text-white">{money(perPerson)}</b> (cuenta de {money(split.fullTotal)}). Se cobra una parte a la vez, cada una con su método.
                </p>
              </div>
            )}
            {splitMode === "items" && (
              <div className="mt-3 space-y-1">
                <p className="text-sm text-zinc-400">Marca lo que paga esta persona:</p>
                {lines.map((l) => {
                  const q = Math.min(l.quantity, picked[l.key] || 0);
                  return (
                    <div key={l.key} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${q > 0 ? "border-orange-500/60 bg-orange-500/10" : "border-zinc-800"}`}>
                      <button onClick={() => setPicked({ ...picked, [l.key]: q > 0 ? 0 : l.quantity })} className="min-w-0 flex-1 truncate text-left font-bold">
                        {q > 0 ? "☑" : "☐"} {l.quantity}× {l.name} <span className="text-zinc-500">· {money(l.price)} c/u</span>
                      </button>
                      {l.quantity > 1 && (
                        <div className="flex items-center gap-1">
                          <button onClick={() => setPicked({ ...picked, [l.key]: Math.max(0, q - 1) })} className="h-8 w-8 rounded-lg border border-zinc-700 font-black">
                            −
                          </button>
                          <span className="w-6 text-center font-black">{q}</span>
                          <button onClick={() => setPicked({ ...picked, [l.key]: Math.min(l.quantity, q + 1) })} className="h-8 w-8 rounded-lg border border-zinc-700 font-black">
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <p className="pt-1 text-sm text-zinc-400">
                  Seleccionado: <b className="text-white">{money(pickedSum)}</b>. Lo demás sigue en la cuenta.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="mt-5 rounded-3xl border border-zinc-800 bg-black p-5">
          <div className="flex justify-between">
            <span className="text-zinc-400">{partLabel || "Total original"}</span>
            <span className="font-black">{money(base)}</span>
          </div>

          <div className="mt-3">
            <label className="mb-2 block text-sm font-bold text-zinc-400">🎟️ Cupón</label>
            {coupon ? (
              <div className="flex items-center justify-between rounded-2xl border border-emerald-500/50 bg-emerald-500/10 px-4 py-3">
                <span className="font-black text-emerald-300">
                  {coupon.code} · -{money(coupon.discount)}
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
              <span className="font-black text-emerald-300">⭐ Usar saldo del club ({money(clubCashback)})</span>
              <input type="checkbox" checked={useClub} onChange={(e) => setUseClub(e.target.checked)} className="h-5 w-5 accent-emerald-500" />
            </label>
          )}
          {clubUsed > 0 && <p className="mt-1 text-xs text-emerald-400">Se usan {money(clubUsed)} de su saldo.</p>}

          {!coupon && (
            <div className="mt-3">
              <label className="mb-2 block text-sm font-bold text-zinc-400">Descuento</label>
              <AmountInput label="Descuento" value={discount} onChange={setDiscount} className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white" />
              <p className="mt-2 text-xs text-red-400">Si agregas descuento, se pedirá autorización Admin al confirmar.</p>
            </div>
          )}

          {feeNumber > 0 && (
            <div className="mt-3 flex justify-between">
              <span className="text-zinc-400">Envío</span>
              <span className="font-black">+{money(feeNumber)}</span>
            </div>
          )}

          {tips.enabled && (
            <div className="mt-4 border-t border-zinc-800 pt-4">
              <label className="mb-2 block text-sm font-bold text-zinc-400">💛 Propina (opcional)</label>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setTipPct(null); setTipCustom(""); }} className={`rounded-xl border px-3 py-2 text-sm font-black ${tipPct === null && !tipCustom ? "border-zinc-500 bg-zinc-800" : "border-zinc-800 bg-zinc-950 text-zinc-400"}`}>
                  Sin propina
                </button>
                {tips.suggestions.map((pct) => (
                  <button key={pct} onClick={() => { setTipPct(pct); setTipCustom(""); }} className={`rounded-xl border px-3 py-2 text-sm font-black ${tipPct === pct ? "border-yellow-400 bg-yellow-400 text-black" : "border-zinc-800 bg-zinc-950 text-zinc-300"}`}>
                    {pct}% · {money(round2((finalTotal * pct) / 100))}
                  </button>
                ))}
                <input
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={tipCustom}
                  onChange={(e) => { setTipCustom(e.target.value); setTipPct(null); }}
                  placeholder="Otra $"
                  className="w-24 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white placeholder:text-zinc-600"
                />
              </div>
            </div>
          )}

          <div className="mt-4 flex items-end justify-between border-t border-zinc-800 pt-4">
            <span className="text-zinc-400">
              Total a pagar
              {tip > 0 && <span className="block text-xs text-yellow-300">incluye propina de {money(tip)}</span>}
            </span>
            <span className="text-3xl font-black text-orange-500">{money(toPay)}</span>
          </div>
        </div>

        {isDelivery && (
          <div className="mt-6 rounded-2xl border border-orange-500/40 bg-orange-500/5 p-4">
            <p className="text-sm font-black text-orange-400">🛵 A domicilio</p>
            <div className="mt-2 grid gap-3 md:grid-cols-[1fr_120px_200px]">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-zinc-400">Dirección</span>
                <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} placeholder="Calle, número y referencia" className="w-full rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-zinc-400">Costo de envío</span>
                <input type="number" min={0} inputMode="decimal" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} placeholder="0" className="w-full rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-zinc-400">Repartidor</span>
                <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className="w-full rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-white">
                  <option value="">Elegir después</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-zinc-500">{drivers.length ? "Se le manda el pedido por WhatsApp al cobrar." : "Agrega repartidores en Configuración → Reparto."}</span>
              </label>
            </div>
            <button onClick={confirmPending} disabled={missingAddress} className="mt-3 w-full rounded-2xl border border-yellow-500/50 bg-yellow-500/10 py-3 font-black text-yellow-200 hover:bg-yellow-500/20 disabled:cursor-not-allowed disabled:opacity-40">
              ⏳ Mandar a preparar · cobrar cuando regrese el repartidor
            </button>
            <p className="mt-1 text-center text-[11px] text-zinc-500">El pedido queda &quot;por cobrar&quot; en el historial hasta que marques que ya pagó.</p>
          </div>
        )}

        <div className="mt-6">
          <label className="mb-2 block text-sm font-bold text-zinc-400">Método de pago</label>
          <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)} className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white">
            {availableMethods.map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
        </div>

        {(isCash || isMixed) && (
          <div className="mt-4">
            <label className="mb-2 block text-sm font-bold text-zinc-400">Efectivo recibido</label>
            <AmountInput label="Efectivo recibido" value={cashReceived} onChange={setCashReceived} quick={cashQuickAmounts(toPay)} className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white" />
          </div>
        )}

        {isMixed && (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-bold text-zinc-400">Tarjeta</label>
              <AmountInput label="Tarjeta" value={cardAmount} onChange={setCardAmount} quick={[{ label: "Resto", value: round2(Math.max(0, toPay - cashNumber - transferNumber)) }]} className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold text-zinc-400">Transferencia</label>
              <AmountInput label="Transferencia" value={transferAmount} onChange={setTransferAmount} quick={[{ label: "Resto", value: round2(Math.max(0, toPay - cashNumber - cardNumber)) }]} className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white" />
            </div>
            <p className="text-xs text-zinc-500 md:col-span-2">Pago mixto: se registra cuánto entró con cada método; el cambio sale del efectivo.</p>
          </div>
        )}

        <div className="mt-6 rounded-3xl border border-zinc-800 bg-black p-5">
          <div className="flex justify-between">
            <span className="text-zinc-400">Pagado</span>
            <span className="font-black">{money(paidTotal)}</span>
          </div>
          <div className="mt-3 flex justify-between">
            <span className="text-zinc-400">Cambio</span>
            <span className="text-3xl font-black text-green-400">{money(change)}</span>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          <button onClick={close} className="rounded-2xl border border-zinc-800 bg-black py-4 font-black">
            Cancelar
          </button>
          <button onClick={confirmCheckout} disabled={!canConfirm} className="rounded-2xl bg-orange-500 py-4 font-black text-black disabled:cursor-not-allowed disabled:opacity-40">
            {partLabel ? `Cobrar ${partLabel.toLowerCase()} · ${money(toPay)}` : "Cobrar"}
          </button>
        </div>
      </section>
    </div>
  );
}
