"use client";
import { useEffect, useMemo, useState } from "react";
import { isPackaging, type Ingredient } from "@/data/inventory";
import { MERMA_REASONS, adjustInventory, getInventory } from "@/lib/inventory";
import { recentWeeks, weekLabel } from "@/lib/finance";
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
/** damaged: cuánto llegó en mal estado (en la unidad del ingrediente); se registra como merma al confirmar */
type DraftLine = { id: string; ingredientId: string; presentations: string; inventoryQuantity: string; lineTotal: string; note: string; damagedOpen?: boolean; damaged?: string; damagedReason?: string };

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
  // Con qué semana de ingresos se paga (Finanzas la cuenta ahí): esta, por default
  const weeks = recentWeeks(6);
  const [paidWeekOf, setPaidWeekOf] = useState(weeks[0]);
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
          const bad = l.damagedOpen ? Number(l.damaged) || 0 : 0;
          if (bad < 0 || bad > inv) throw new Error(`Lo que llegó en mal estado de ${ingredient.name} no puede ser más de lo que entró (${inv} ${ingredient.unit}).`);
          if (bad > 0 && !l.damagedReason) throw new Error(`Elige el motivo de lo que llegó en mal estado de ${ingredient.name}.`);
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

      const purchase = registerPurchase({ supplier: supplier.trim(), invoice, paymentMethod, subtotal: total, tax: 0, total, source, note, items, ocrText, imageName, paidWeekOf });
      // Lo que llegó en mal estado: entra con la compra (a su costo) y sale como merma con su motivo
      const wasted: string[] = [];
      lines
        .filter((l) => l.ingredientId && l.damagedOpen && Number(l.damaged) > 0)
        .forEach((l) => {
          const ingredient = ingredients.find((x) => x.id === Number(l.ingredientId));
          const inv = Number(l.inventoryQuantity) || 0;
          if (!ingredient || !inv) return;
          const bad = Number(l.damaged);
          const unitCost = (Number(l.lineTotal) || 0) / inv;
          adjustInventory({
            ingredientId: ingredient.id,
            quantity: bad,
            adjustmentType: "Merma",
            reason: `${l.damagedReason} · al recibir la compra ${purchase.folio} (${purchase.supplier})`,
            cost: unitCost * bad,
          });
          wasted.push(`${ingredient.name}: ${bad} ${ingredient.unit} ($${(unitCost * bad).toFixed(2)})`);
        });
      reset();
      onPurchaseCreated?.();
      alert(`Compra registrada. Inventario, Kardex y costos actualizados.${wasted.length ? `\n\nMerma al recibir: ${wasted.join(", ")}.` : ""}`);
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
      <label className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-sm">
        <span className="font-black">💰 Se pagó con los ingresos de</span>
        <select value={paidWeekOf} onChange={(e) => setPaidWeekOf(e.target.value)} className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
          {weeks.map((w, i) => (
            <option key={w} value={w}>
              {i === 0 ? "Esta semana" : i === 1 ? "La semana pasada" : "La semana"} ({weekLabel(w)})
            </option>
          ))}
        </select>
        <span className="text-xs text-zinc-500">Finanzas la cuenta en esa semana. Lo puedes cambiar después en el historial.</span>
      </label>

      <div className="mt-6 space-y-3">
        {lines.map((l, i) => {
          const ing = ingredients.find((x) => x.id === Number(l.ingredientId));
          const last = ing ? getLatestIngredientCost(ing.id) : undefined;
          const inv = Number(l.inventoryQuantity) || 0;
          const cost = Number(l.lineTotal) || 0;
          const unitCost = inv > 0 && cost > 0 ? cost / inv : 0;
          const change = last?.unitCost && unitCost ? (unitCost / last.unitCost - 1) * 100 : 0;
          // Costo por unidad que no cuadra con la unidad (ej. $150 por g): casi siempre la entrada se escribió en kg
          const odd = ing && unitCost > 0 && (((ing.unit === "g" || ing.unit === "ml") && unitCost > 2) || ((ing.unit === "kg" || ing.unit === "L") && unitCost > 2000) || change > 300 || change < -75);
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
                  <option value="">Ingrediente o empaque *</option>
                  {[
                    ["🧂 Ingredientes", ingredients.filter((x) => !isPackaging(x))],
                    ["📦 Packaging", ingredients.filter(isPackaging)],
                  ].map(([label, list]) =>
                    (list as Ingredient[]).length ? (
                      <optgroup key={label as string} label={label as string}>
                        {(list as Ingredient[]).map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name} ({x.unit})
                          </option>
                        ))}
                      </optgroup>
                    ) : null
                  )}
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
              {ing && unitCost > 0 && (
                <p className={`mt-2 text-xs font-black ${odd ? "text-red-300" : "text-zinc-400"}`}>
                  = ${unitCost < 1 ? unitCost.toFixed(4) : unitCost.toFixed(2)} por {ing.unit}
                  {odd
                    ? ` · ⚠️ ¿Seguro? Se ve muy ${change < -75 ? "barato" : "caro"} para 1 ${ing.unit}. Revisa que la entrada real esté en ${ing.unit} (ej. 10 kg = 10,000 g).`
                    : ""}
                </p>
              )}
              {change > 10 && !odd && (
                <p className="mt-2 text-xs font-black text-yellow-300">
                  ⚠️ Este precio es {change.toFixed(1)}% más caro que la última compra.
                </p>
              )}
              {ing && (
                <div className="mt-2">
                  {!l.damagedOpen ? (
                    <button type="button" onClick={() => patch(l.id, { damagedOpen: true, damagedReason: l.damagedReason || "" })} className="text-xs font-black text-zinc-500 underline-offset-2 hover:text-orange-400 hover:underline">
                      ⚠️ ¿Llegó algo en mal estado?
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-2 text-xs">
                      <span className="font-black text-red-300">Llegaron mal</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={l.damaged || ""}
                        onChange={(e) => patch(l.id, { damaged: e.target.value })}
                        placeholder="2"
                        className="w-20 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5"
                        aria-label={`Cuánto llegó en mal estado de ${ing.name}`}
                      />
                      <span className="font-bold text-zinc-400">{ing.unit}</span>
                      <select
                        value={l.damagedReason || ""}
                        onChange={(e) => patch(l.id, { damagedReason: e.target.value })}
                        className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5"
                        aria-label="Motivo"
                      >
                        <option value="">Motivo…</option>
                        {MERMA_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      {Number(l.damaged) > 0 && inv > 0 && (
                        <span className="text-zinc-400">
                          Entran {inv} {ing.unit} y se registra merma de {l.damaged} {ing.unit}
                          {unitCost > 0 ? ` ($${(unitCost * Number(l.damaged)).toFixed(2)})` : ""}: quedan {Math.round((inv - Number(l.damaged)) * 1000) / 1000} {ing.unit}.
                        </span>
                      )}
                      <button type="button" onClick={() => patch(l.id, { damagedOpen: false, damaged: "", damagedReason: "" })} className="ml-auto font-black text-zinc-500 hover:text-white" aria-label="Quitar merma">
                        ✕
                      </button>
                    </div>
                  )}
                </div>
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
