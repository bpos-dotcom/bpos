"use client";
import { useEffect, useMemo, useState } from "react";
import type { Ingredient } from "@/data/inventory";
import { getInventory } from "@/lib/inventory";
import {
  getLatestIngredientCost,
  getSuppliers,
  PURCHASES_EVENT,
  registerPurchase,
  saveSupplier,
  type Purchase,
  type Supplier,
} from "@/lib/purchases";

/** Compra precargada desde una foto de ticket o desde sugerencias */
export type PurchasePrefill = {
  key: number;
  supplier?: string;
  invoice?: string;
  source: Purchase["source"];
  ocrText?: string;
  imageName?: string;
  lines: { ingredientId: number; ticketName?: string; presentations: number; inventoryQuantity: number; lineTotal: number }[];
};

type Props = { onPurchaseCreated?: () => void; prefill?: PurchasePrefill | null };
type DraftLine = { id: string; ingredientId: string; presentations: string; inventoryQuantity: string; lineTotal: string; note: string };

const newLine = (): DraftLine => ({
  id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  ingredientId: "",
  presentations: "1",
  inventoryQuantity: "",
  lineTotal: "",
  note: "",
});

export default function PurchaseForm({ onPurchaseCreated, prefill }: Props) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplier, setSupplier] = useState("");
  const [invoice, setInvoice] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [source, setSource] = useState<Purchase["source"]>("manual");
  const [ocrText, setOcrText] = useState<string | undefined>();
  const [imageName, setImageName] = useState<string | undefined>();

  useEffect(() => {
    const load = () => {
      setIngredients(getInventory());
      setSuppliers(getSuppliers().filter((s) => s.active !== false));
    };
    load();
    window.addEventListener(PURCHASES_EVENT, load);
    window.addEventListener("bpos:inventory-updated", load);
    return () => {
      window.removeEventListener(PURCHASES_EVENT, load);
      window.removeEventListener("bpos:inventory-updated", load);
    };
  }, []);

  // Cargar una compra precargada (foto de ticket o sugerencias)
  useEffect(() => {
    if (!prefill) return;
    if (prefill.supplier) setSupplier(prefill.supplier);
    if (prefill.invoice) setInvoice(prefill.invoice);
    setSource(prefill.source);
    setOcrText(prefill.ocrText);
    setImageName(prefill.imageName);
    setLines(
      prefill.lines.length
        ? prefill.lines.map((l) => ({
            ...newLine(),
            ingredientId: String(l.ingredientId),
            presentations: String(l.presentations || 1),
            inventoryQuantity: l.inventoryQuantity ? String(l.inventoryQuantity) : "",
            lineTotal: l.lineTotal ? String(l.lineTotal) : "",
            note: l.ticketName || "",
          }))
        : [newLine()]
    );
  }, [prefill]);

  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.lineTotal) || 0), 0), [lines]);

  function patch(id: string, p: Partial<DraftLine>) {
    setLines((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }
  function remove(id: string) {
    setLines((xs) => (xs.length === 1 ? [newLine()] : xs.filter((x) => x.id !== id)));
  }
  function reset() {
    setSupplier("");
    setInvoice("");
    setPaymentMethod("");
    setNote("");
    setLines([newLine()]);
    setSource("manual");
    setOcrText(undefined);
    setImageName(undefined);
  }

  function save() {
    try {
      const items = lines
        .filter((l) => l.ingredientId)
        .map((l, index) => {
          const ingredient = ingredients.find((x) => x.id === Number(l.ingredientId));
          if (!ingredient) throw new Error(`Selecciona el ingrediente de la línea ${index + 1}.`);
          const inv = Number(l.inventoryQuantity);
          const pres = Number(l.presentations) || 1;
          const cost = Number(l.lineTotal) || 0;
          if (!Number.isFinite(inv) || inv <= 0) throw new Error(`Captura cuánto entra realmente al inventario para ${ingredient.name}.`);
          return {
            id: `item-${Date.now()}-${index}`,
            ticketName: l.note || ingredient.name,
            ingredientId: ingredient.id,
            ingredientName: ingredient.name,
            purchasedQuantity: pres,
            inventoryQuantity: inv,
            unit: ingredient.unit,
            lineTotal: cost,
          };
        });
      if (!items.length) throw new Error("Agrega al menos un ingrediente.");
      if (!supplier.trim()) throw new Error("Captura el proveedor.");

      // Proveedor nuevo → se da de alta solo
      if (!suppliers.some((s) => s.name.trim().toLowerCase() === supplier.trim().toLowerCase())) {
        saveSupplier({ name: supplier.trim() });
      }

      registerPurchase({ supplier: supplier.trim(), invoice, paymentMethod, subtotal: total, tax: 0, total, source, note, items, ocrText, imageName });
      reset();
      onPurchaseCreated?.();
      alert("Compra registrada. Inventario, Kardex y costos actualizados.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo registrar la compra.");
    }
  }

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-orange-500">
            {source === "ocr" ? "Confirmar compra del ticket" : source === "shopping-list" ? "Compra desde sugerencias" : "Registrar compra manual"}
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Revisa cada ingrediente. La entrada real debe expresarse en la unidad que usa Inventario.
          </p>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-right">
          <p className="text-xs text-zinc-500">TOTAL</p>
          <p className="text-xl font-black text-green-400">${total.toFixed(2)}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <input list="bpos-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Proveedor *" className="rounded-2xl border border-zinc-800 bg-black px-4 py-3" />
        <datalist id="bpos-suppliers">
          {suppliers.map((s) => (
            <option key={s.id} value={s.name} />
          ))}
        </datalist>
        <input value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="Factura / Ticket (opcional)" className="rounded-2xl border border-zinc-800 bg-black px-4 py-3" />
        <input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="Método de pago (opcional)" className="rounded-2xl border border-zinc-800 bg-black px-4 py-3" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota general (opcional)" className="rounded-2xl border border-zinc-800 bg-black px-4 py-3" />
      </div>

      <div className="mt-6 space-y-3">
        {lines.map((l, i) => {
          const ing = ingredients.find((x) => x.id === Number(l.ingredientId));
          const last = ing ? getLatestIngredientCost(ing.id) : undefined;
          const inv = Number(l.inventoryQuantity) || 0;
          const cost = Number(l.lineTotal) || 0;
          const unitCost = inv > 0 && cost > 0 ? cost / inv : 0;
          const change = last?.unitCost && unitCost ? (unitCost / last.unitCost - 1) * 100 : 0;
          return (
            <div key={l.id} className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-black">Artículo {i + 1}</p>
                <button onClick={() => remove(l.id)} className="rounded-xl border border-red-500/50 px-3 py-1 text-xs font-black text-red-400">
                  Eliminar
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <select value={l.ingredientId} onChange={(e) => patch(l.id, { ingredientId: e.target.value })} className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3">
                  <option value="">Ingrediente *</option>
                  {ingredients.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({x.unit})
                    </option>
                  ))}
                </select>
                <input type="number" min="0" step="any" value={l.presentations} onChange={(e) => patch(l.id, { presentations: e.target.value })} placeholder="Presentaciones" className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3" />
                <input type="number" min="0" step="any" value={l.inventoryQuantity} onChange={(e) => patch(l.id, { inventoryQuantity: e.target.value })} placeholder={ing ? `Entrada real (${ing.unit})` : "Entrada real"} className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3" />
                <input type="number" min="0" step="0.01" value={l.lineTotal} onChange={(e) => patch(l.id, { lineTotal: e.target.value })} placeholder="Costo total" className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3" />
                <input value={l.note} onChange={(e) => patch(l.id, { note: e.target.value })} placeholder="Presentación / nota" className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3" />
              </div>
              {ing && (
                <p className="mt-2 text-xs text-zinc-500">
                  Inventario trabaja en <b>{ing.unit}</b>. Ej.: si compras 3 cajas de 16.32 kg y el ingrediente está en g, captura 48,960 g.
                  {last?.unitCost ? ` Último costo: $${last.unitCost.toFixed(4)} por ${ing.unit} (${last.supplier}).` : ""}
                </p>
              )}
              {change > 10 && (
                <p className="mt-2 text-xs font-black text-yellow-300">
                  ⚠️ Este precio es {change.toFixed(1)}% más caro que la última compra.
                </p>
              )}
              {change < -10 && (
                <p className="mt-2 text-xs font-black text-green-400">✓ {Math.abs(change).toFixed(1)}% más barato que la última compra.</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button onClick={() => setLines((xs) => [...xs, newLine()])} className="rounded-2xl border border-orange-500 px-5 py-3 font-black text-orange-400">
          + Agregar ingrediente
        </button>
        {source !== "manual" && (
          <button onClick={reset} className="rounded-2xl border border-zinc-700 px-5 py-3 font-black text-zinc-300">
            Limpiar
          </button>
        )}
        <button onClick={save} className="min-w-[260px] flex-1 rounded-2xl bg-orange-500 px-6 py-3 font-black text-black">
          Confirmar compra y actualizar inventario
        </button>
      </div>
    </section>
  );
}
