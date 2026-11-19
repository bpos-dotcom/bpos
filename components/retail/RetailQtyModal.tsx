"use client";
/**
 * Caja de tienda: cuánto se lleva de un artículo a granel (250 g, 1.5 kg,
 * "$20 de jitomate", 3.5 m de cable) o el importe de un artículo de precio
 * libre ("Varios").
 */
import { useEffect, useRef, useState } from "react";
import type { Product } from "@/data/products";
import { bulkQuantity, formatQty, isBulk, smallUnitOf, unitOf, unitShort } from "@/lib/retail";

const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

export type RetailQtyResult = { quantity: number; price: number; comment?: string };

export function RetailQtyModal({ product, onClose, onConfirm }: { product: Product; onClose: () => void; onConfirm: (r: RetailQtyResult) => void }) {
  const bulk = isBulk(product) && !product.openPrice;
  const unit = unitOf(product);
  const small = smallUnitOf(unit);
  const [mode, setMode] = useState<"chica" | "unidad" | "dinero">(small ? "chica" : "unidad");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const amount = Number(value.replace(",", "."));
  const quantity = bulk ? bulkQuantity(product, { amount, mode }) : 0;
  const total = bulk ? Math.round(quantity * product.price * 100) / 100 : amount;
  const ok = bulk ? quantity > 0 : amount > 0;

  function confirm() {
    if (!ok) return;
    if (bulk) onConfirm({ quantity, price: product.price });
    else onConfirm({ quantity: 1, price: Math.round(amount * 100) / 100, ...(note.trim() ? { comment: note.trim() } : {}) });
  }

  const quick = bulk ? (mode === "dinero" ? [10, 20, 50, 100] : mode === "chica" ? (unit === "m" ? [50, 100, 150, 200] : [100, 250, 500, 750]) : [0.5, 1, 1.5, 2]) : [5, 10, 20, 50];
  const modes: { id: typeof mode; label: string }[] = [
    ...(small ? [{ id: "chica" as const, label: small }] : []),
    { id: "unidad", label: unitShort(unit) },
    { id: "dinero", label: "$ dinero" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-orange-500">{bulk ? `A granel · ${money(product.price)} / ${unitShort(unit)}` : "Precio libre"}</p>
            <h2 className="text-2xl font-black">
              {product.emoji} {product.name}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-xl border border-zinc-800 px-3 py-1 font-black">
            ✕
          </button>
        </div>

        {bulk && (
          <div className="mt-4 flex gap-2">
            {modes.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setMode(m.id);
                  setValue("");
                }}
                className={`flex-1 rounded-2xl border py-2 font-black ${mode === m.id ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 text-zinc-300"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-bold text-zinc-400">
            {bulk ? (mode === "dinero" ? "¿Cuánto dinero?" : `¿Cuántos ${mode === "chica" ? small : unitShort(unit)}?`) : "Importe"}
          </span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && confirm()}
            inputMode="decimal"
            placeholder="0"
            className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-4 text-center text-4xl font-black text-white"
          />
        </label>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {quick.map((q) => (
            <button key={q} onClick={() => setValue(String(q))} className="rounded-xl border border-zinc-800 bg-black py-2 font-black text-zinc-200 hover:border-orange-500">
              {bulk && mode !== "dinero" ? q : `$${q}`}
            </button>
          ))}
        </div>
        {!bulk && (
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={60} placeholder="¿Qué es? (opcional)" className="mt-3 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white" />
        )}

        <div className="mt-5 flex items-end justify-between rounded-2xl bg-black p-4">
          <span className="text-zinc-400">{bulk ? (ok ? formatQty(quantity, unit) : "—") : "Total"}</span>
          <span className="text-3xl font-black text-orange-500">{ok ? money(total) : "$0.00"}</span>
        </div>
        <button onClick={confirm} disabled={!ok} className="mt-4 w-full rounded-2xl bg-orange-500 py-4 text-lg font-black text-black disabled:opacity-40">
          Agregar
        </button>
      </div>
    </div>
  );
}
