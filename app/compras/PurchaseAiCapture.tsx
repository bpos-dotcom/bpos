"use client";
/**
 * Compras → Foto de ticket. Plan Max: la IA de B-POS lee el ticket y llena la
 * compra. Cada renglón del ticket tiene que quedar relacionado antes de
 * usarlo: a qué insumo corresponde y cuánto trae cada uno (o "a granel": lo
 * que pesó), o marcado como que no va al inventario. Lo que ya tiene
 * equivalencia guardada sale listo; lo nuevo se confirma una vez y queda
 * aprendido para el siguiente ticket de ese proveedor. Otros planes:
 * invitación a Max y la captura manual de siempre.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AiPurchaseTicket } from "@/app/api/ai/purchase/route";
import {
  AI_REASON_TEXT,
  aiFetch,
  getAiStatus,
  type AiStatus,
} from "@/lib/ai/client";
import { getAdminIngredients, saveAdminIngredients } from "@/lib/admin";
import { addAuditEvent } from "@/lib/audit";
import { getInventory } from "@/lib/inventory";
import { findPurchaseAlias, getPurchaseAliases } from "@/lib/purchases";
import { UNITS, compatibleUnits, unitFactor, type Unit } from "@/lib/units";
import { SUGGESTED_CATEGORIES, SUGGESTED_PACKAGING_CATEGORIES, isPackaging, type Ingredient } from "@/data/inventory";

export type AiPurchaseResult = {
  supplier: string;
  invoice: string;
  imageName: string;
  lines: {
    ingredientId: number;
    ticketName: string;
    presentations: number;
    inventoryQuantity: number;
    lineTotal: number;
    byWeight: boolean;
  }[];
};

type Props = {
  onReady: (result: AiPurchaseResult) => void;
  onManual: () => void;
};

const MAX_SIDE = 1800;

/** Foto más ligera (JPG de máximo 1800 px) para que suba rápido y quepa en la nube. */
async function compress(
  file: File,
): Promise<{ mediaType: string; data: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("No se pudo abrir la foto."));
      i.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("El navegador no pudo procesar la foto.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return {
      mediaType: "image/jpeg",
      data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1],
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * conocido = ya tenía equivalencia; revisar = falta confirmarlo (la IA solo
 * sugiere); listo = confirmado aquí; fuera = no va al inventario (bolsas...).
 * qty: lo que trae cada uno, o el peso total si es a granel, en `unit`.
 * draftNew: el insumo no existe y se está dando de alta desde el ticket
 * (como ingrediente de receta o como packaging/empaque).
 */
type Status = "conocido" | "revisar" | "listo" | "fuera";
type Row = AiPurchaseTicket["lines"][number] & {
  key: string;
  status: Status;
  qty: string;
  unit: Unit;
  draftNew?: { name: string; unit: Unit; category: string; packaging: boolean };
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Lo que entra al inventario por ese renglón, en la unidad del insumo */
function rowTotal(r: Row, inventory: Ingredient[]) {
  const ing = inventory.find((i) => i.id === r.ingredientId);
  if (!ing) return 0;
  const q = (Number(r.qty) || 0) * (unitFactor(r.unit, ing.unit) || 1);
  return round3(
    r.byWeight ? q : q * (r.presentations > 0 ? r.presentations : 1),
  );
}

/** Ya se puede usar: fuera del inventario, o con insumo y cantidad (y confirmado si era sugerencia) */
const rowReady = (r: Row, inventory: Ingredient[]) =>
  r.status === "fuera" ||
  (r.status !== "revisar" &&
    r.ingredientId !== null &&
    rowTotal(r, inventory) > 0);

export default function PurchaseAiCapture({ onReady, onManual }: Props) {
  const [ai, setAi] = useState<AiStatus | null | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [supplier, setSupplier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ticket, setTicket] = useState<AiPurchaseTicket | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [inventory, setInventory] = useState<Ingredient[]>([]);

  useEffect(() => {
    void getAiStatus().then(setAi);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- inventario del navegador: solo después de montar
    setInventory(getInventory());
  }, []);
  useEffect(
    () => () => void (preview && URL.revokeObjectURL(preview)),
    [preview],
  );

  function pick(next: File) {
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(URL.createObjectURL(next));
    setTicket(null);
    setRows([]);
    setError("");
  }

  async function read() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const image = await compress(file);
      const r = await aiFetch("/api/ai/purchase", {
        method: "POST",
        body: JSON.stringify({
          image,
          supplier,
          ingredients: inventory.map((i) => ({
            id: i.id,
            name: i.name,
            unit: i.unit,
          })),
          aliases: getPurchaseAliases().map((a) => ({
            ticketName: a.ticketName,
            supplier: a.supplier,
            ingredientId: a.ingredientId,
            quantity: a.quantity,
          })),
        }),
      });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.success)
        throw new Error(b?.error || "No se pudo leer el ticket.");
      const t = b.ticket as AiPurchaseTicket;
      setTicket(t);
      if (t.supplier && !supplier) setSupplier(t.supplier);
      // Equivalencia guardada (Ingredientes → Cómo viene en el ticket): manda sobre lo que calculó la IA
      // ej. 3 x CASABLANCA de 108 rebanadas = 324 pza
      const unitOf = (id: number | null) =>
        inventory.find((x) => x.id === id)?.unit || "pza";
      setRows(
        t.lines.map((l, i): Row => {
          const a = findPurchaseAlias(
            l.ticketName,
            supplier.trim() || t.supplier,
          );
          const pres = l.presentations > 0 ? l.presentations : 1;
          if (a && inventory.some((x) => x.id === a.ingredientId)) {
            const unit = unitOf(a.ingredientId);
            if (a.byWeight) {
              // A granel: el insumo ya se sabe, el peso lo lee la IA de este ticket
              const q =
                l.ingredientId === a.ingredientId ? l.inventoryQuantity : 0;
              return {
                ...l,
                ingredientId: a.ingredientId,
                byWeight: true,
                key: `ai-${i}`,
                status: q > 0 ? "conocido" : "revisar",
                qty: q > 0 ? String(round3(q)) : "",
                unit,
              };
            }
            return {
              ...l,
              ingredientId: a.ingredientId,
              byWeight: false,
              key: `ai-${i}`,
              status: "conocido",
              qty: String(a.quantity),
              unit,
            };
          }
          // Sin equivalencia: lo que sugiera la IA, para confirmar
          const per =
            l.ingredientId === null || !(l.inventoryQuantity > 0)
              ? 0
              : l.byWeight
                ? l.inventoryQuantity
                : l.inventoryQuantity / pres;
          return {
            ...l,
            key: `ai-${i}`,
            status: "revisar",
            qty: per > 0 ? String(round3(per)) : "",
            unit: unitOf(l.ingredientId),
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el ticket.");
    } finally {
      setBusy(false);
    }
  }

  function update(key: string, patch: Partial<Row>) {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  /** Cambiar el insumo: la cantidad se escribe en su unidad; "fuera" = no va al inventario */
  function chooseIngredient(r: Row, value: string) {
    if (value === "fuera")
      return update(r.key, { status: "fuera", draftNew: undefined });
    if (value === "nuevo" || value === "nuevo-packaging") {
      // Nombre del ticket más legible: "QUESO OAXACA LALA" → "Queso oaxaca lala"
      const name = r.ticketName
        .toLowerCase()
        .replace(/^./, (c) => c.toUpperCase())
        .slice(0, 60);
      return update(r.key, {
        ingredientId: null,
        draftNew: { name, unit: r.byWeight ? "kg" : "pza", category: "", packaging: value === "nuevo-packaging" },
      });
    }
    const id = value ? Number(value) : null;
    update(r.key, {
      ingredientId: id,
      unit: inventory.find((i) => i.id === id)?.unit || "pza",
      status: "revisar",
      draftNew: undefined,
    });
  }

  /** Da de alta el insumo que no existía (existencia 0: la compra se la suma) y lo deja elegido en el renglón */
  function createIngredient(r: Row) {
    const d = r.draftNew;
    if (!d) return;
    const name = d.name.trim().replace(/\s+/g, " ");
    if (!name) return setError(d.packaging ? "Escribe el nombre del empaque nuevo." : "Escribe el nombre del ingrediente nuevo.");
    const all = getAdminIngredients();
    const same = all.find(
      (i) => i.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (same) {
      setError("");
      return update(r.key, {
        ingredientId: same.id,
        unit: same.unit,
        draftNew: undefined,
      });
    }
    const ingredient: Ingredient = {
      id: Date.now(),
      name,
      unit: d.unit,
      stock: 0,
      minimum: 0,
      ...(d.category.trim()
        ? { category: d.category.trim().slice(0, 40) }
        : {}),
      ...(d.packaging ? { kind: "packaging" as const } : {}),
    };
    saveAdminIngredients([...all, ingredient]);
    addAuditEvent({
      category: "Inventario",
      action: "ingredient.created",
      description: `${d.packaging ? "Empaque" : "Ingrediente"} ${name} (${d.unit}) creado desde un ticket de compra: "${r.ticketName}"`,
      metadata: { ingredientId: ingredient.id },
    });
    setInventory(getInventory());
    setError("");
    update(r.key, {
      ingredientId: ingredient.id,
      unit: ingredient.unit,
      draftNew: undefined,
    });
  }

  /** Categorías para el insumo nuevo: las de su tipo (ingredientes o empaques) y las sugeridas */
  const categoriesFor = (packaging: boolean) =>
    [
      ...new Set(
        [
          ...inventory.filter((i) => isPackaging(i) === packaging).map((i) => i.category?.trim() || ""),
          ...(packaging ? SUGGESTED_PACKAGING_CATEGORIES : SUGGESTED_CATEGORIES),
        ].filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, "es"));

  const pending = rows.filter((r) => !rowReady(r, inventory));
  const lineSum =
    Math.round(rows.reduce((t, r) => t + (r.lineTotal || 0), 0) * 100) / 100;

  function use() {
    if (pending.length) {
      const one = pending.length === 1;
      setError(
        one
          ? 'Falta 1 artículo del ticket: dile a qué insumo corresponde y cuánto trae, o márcalo como "No va al inventario".'
          : `Faltan ${pending.length} artículos del ticket: dile a qué insumo corresponde cada uno y cuánto trae, o márcalos como "No va al inventario".`,
      );
      return;
    }
    const ready = rows.filter((r) => r.status !== "fuera");
    if (!ready.length) {
      setError("Ningún artículo de este ticket va al inventario.");
      return;
    }
    onReady({
      supplier: supplier.trim() || ticket?.supplier || "",
      invoice: ticket?.invoice || "",
      imageName: file?.name || "",
      lines: ready.map((r) => ({
        ingredientId: r.ingredientId as number,
        ticketName: r.ticketName,
        presentations: r.presentations,
        inventoryQuantity: rowTotal(r, inventory),
        lineTotal: r.lineTotal,
        byWeight: r.byWeight,
      })),
    });
  }

  if (ai === undefined) {
    return (
      <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-500">
        Revisando tu plan...
      </section>
    );
  }

  if (!ai?.available) {
    const notMax = !ai || ai.plan !== "max";
    return (
      <section className="rounded-3xl border border-orange-500/40 bg-gradient-to-br from-orange-500/15 to-zinc-950 p-8">
        <p className="text-4xl">🤖</p>
        <h2 className="mt-3 text-2xl font-black text-orange-400">
          {notMax
            ? "¿Quieres capturar tus tickets con IA? ¡Pásate a Max!"
            : "Captura con IA no disponible"}
        </h2>
        <p className="mt-2 max-w-2xl text-zinc-300">
          {notMax
            ? "Con el plan Max solo tomas la foto del ticket y la IA de B-POS lee al proveedor, cada artículo, cantidades y precios, y llena la compra por ti."
            : AI_REASON_TEXT[ai?.reason || "plan"]}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {notMax && (
            <Link
              href="/configuracion/plan"
              className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black hover:bg-orange-400"
            >
              Ver plan Max
            </Link>
          )}
          <button
            onClick={onManual}
            className="rounded-2xl border border-zinc-700 px-5 py-3 font-black hover:border-orange-500"
          >
            🧾 Capturar a mano
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h2 className="text-xl font-black text-orange-500">🤖 Ticket con IA</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Toma una foto clara del ticket completo. La IA lo lee y tú revisas
          antes de guardar.
        </p>
        {/* Dos entradas: con capture el celular abre directo la cámara y no deja elegir de la galería */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) pick(e.target.files[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) pick(e.target.files[0]);
            e.target.value = "";
          }}
        />
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="rounded-2xl border border-zinc-700 bg-black px-3 py-3 font-black hover:border-orange-500"
          >
            📷 Tomar foto
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-2xl border border-zinc-700 bg-black px-3 py-3 font-black hover:border-orange-500"
          >
            🖼️ Elegir de la galería
          </button>
        </div>
        <button
          type="button"
          aria-label="Elegir foto del ticket"
          onClick={() => inputRef.current?.click()}
          className="mt-3 flex h-64 w-full items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed border-zinc-700 bg-black hover:border-orange-500"
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- vista previa local
            <img
              src={preview}
              alt="Ticket"
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="text-center">
              <span className="block text-6xl">📷</span>
              <span className="mt-3 block font-black">
                {"Aquí se ve la foto del ticket"}
              </span>
            </span>
          )}
        </button>
        <input
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          placeholder="Proveedor (opcional, la IA lo lee del ticket)"
          className="mt-4 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3"
        />
        <button
          type="button"
          disabled={!file || busy}
          onClick={() => void read()}
          className="mt-4 w-full rounded-2xl bg-orange-500 py-3 font-black text-black disabled:opacity-40"
        >
          {busy ? "Leyendo ticket con IA..." : "Leer ticket con IA"}
        </button>
        {error && (
          <p className="mt-3 text-sm font-bold text-red-300">{error}</p>
        )}
      </section>

      {ticket ? (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-black">Revisa la compra</h2>
            <p className="text-sm text-zinc-400">
              {ticket.supplier || "Proveedor sin leer"}
              {ticket.invoice ? ` · Folio ${ticket.invoice}` : ""}
              {ticket.date ? ` · ${ticket.date}` : ""} · Total del ticket{" "}
              <b className="text-white">${ticket.total.toFixed(2)}</b>
            </p>
          </div>
          {ticket.warnings.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-3 pl-7 text-sm text-yellow-100">
              {ticket.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className="mt-4 space-y-3">
            {rows.map((r) => {
              const ing = inventory.find((i) => i.id === r.ingredientId);
              const total = rowTotal(r, inventory);
              const units = ing ? compatibleUnits(ing.unit) : [];
              const ready = rowReady(r, inventory);
              return (
                <div
                  key={r.key}
                  className={`rounded-2xl border p-3 ${ready ? "border-zinc-800" : "border-yellow-500/60 bg-yellow-500/5"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-black">{r.ticketName}</p>
                      <label className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                        Compraste
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={r.presentations || ""}
                          onChange={(e) =>
                            update(r.key, {
                              presentations: Number(e.target.value) || 0,
                            })
                          }
                          className="w-16 rounded-lg border border-zinc-800 bg-black px-2 py-1 text-white"
                          aria-label={`Cuántos ${r.ticketName}`}
                        />
                        {r.byWeight ? "(a granel)" : "pieza(s) o paquete(s)"}
                      </label>
                    </div>
                    <label className="text-xs text-zinc-400">
                      Importe $
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={r.lineTotal || ""}
                        onChange={(e) =>
                          update(r.key, {
                            lineTotal: Number(e.target.value) || 0,
                          })
                        }
                        className="mt-1 block w-28 rounded-xl border border-zinc-800 bg-black px-3 py-2 text-white"
                      />
                    </label>
                  </div>

                  {r.status === "revisar" ? (
                    <div className="mt-3 space-y-2 rounded-xl border border-zinc-800 bg-black p-3">
                      <p className="text-xs font-black text-yellow-300">
                        {r.ingredientId !== null
                          ? "Revisa a qué corresponde y cuánto trae, y confírmalo:"
                          : "¿A qué insumo de tu inventario corresponde?"}
                      </p>
                      <select
                        value={r.draftNew ? (r.draftNew.packaging ? "nuevo-packaging" : "nuevo") : (r.ingredientId ?? "")}
                        onChange={(e) => chooseIngredient(r, e.target.value)}
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2"
                        aria-label="Insumo"
                      >
                        <option value="">Elige el insumo…</option>
                        <optgroup label="🧂 Ingredientes">
                          {inventory
                            .filter((i) => !isPackaging(i))
                            .map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} ({i.unit})
                              </option>
                            ))}
                        </optgroup>
                        {inventory.some(isPackaging) && (
                          <optgroup label="📦 Packaging">
                            {inventory.filter(isPackaging).map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} ({i.unit})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <option value="nuevo">
                          ➕ Crear ingrediente nuevo…
                        </option>
                        <option value="nuevo-packaging">
                          ➕ Crear empaque nuevo (packaging)…
                        </option>
                        <option value="fuera">
                          🚫 No va al inventario (limpieza, otros…)
                        </option>
                      </select>
                      {r.draftNew && (
                        <div className="space-y-2 rounded-xl border border-orange-500/40 bg-orange-500/5 p-3">
                          <div className="flex overflow-hidden rounded-xl border border-zinc-800 text-xs font-black" role="group" aria-label="Tipo de insumo nuevo">
                            <button
                              type="button"
                              onClick={() => update(r.key, { draftNew: { ...r.draftNew!, packaging: false, category: "" } })}
                              aria-pressed={!r.draftNew.packaging}
                              className={`flex-1 px-3 py-2 ${!r.draftNew.packaging ? "bg-orange-500 text-black" : "bg-zinc-950 text-zinc-400"}`}
                            >
                              🧂 Ingrediente
                            </button>
                            <button
                              type="button"
                              onClick={() => update(r.key, { draftNew: { ...r.draftNew!, packaging: true, category: "" } })}
                              aria-pressed={r.draftNew.packaging}
                              className={`flex-1 px-3 py-2 ${r.draftNew.packaging ? "bg-orange-500 text-black" : "bg-zinc-950 text-zinc-400"}`}
                            >
                              📦 Packaging
                            </button>
                          </div>
                          <p className="text-xs font-black text-orange-300">
                            {r.draftNew.packaging ? "Empaque nuevo: se agrega a Tu negocio → Packaging" : "Ingrediente nuevo: se agrega a Tu negocio → Ingredientes"}
                          </p>
                          <input
                            value={r.draftNew.name}
                            onChange={(e) =>
                              update(r.key, {
                                draftNew: {
                                  ...r.draftNew!,
                                  name: e.target.value,
                                },
                              })
                            }
                            placeholder="Nombre (ej. Queso oaxaca)"
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-white"
                            aria-label="Nombre del ingrediente nuevo"
                          />
                          <div className="grid gap-2 sm:grid-cols-2">
                            <select
                              value={r.draftNew.unit}
                              onChange={(e) =>
                                update(r.key, {
                                  draftNew: {
                                    ...r.draftNew!,
                                    unit: e.target.value as Unit,
                                  },
                                })
                              }
                              className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2"
                              aria-label="Unidad del ingrediente nuevo"
                            >
                              {UNITS.map((u) => (
                                <option key={u.value} value={u.value}>
                                  {u.label}
                                </option>
                              ))}
                            </select>
                            <select
                              value={r.draftNew.category}
                              onChange={(e) =>
                                update(r.key, {
                                  draftNew: {
                                    ...r.draftNew!,
                                    category: e.target.value,
                                  },
                                })
                              }
                              className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2"
                              aria-label="Categoría del ingrediente nuevo"
                            >
                              <option value="">Sin categoría</option>
                              {categoriesFor(r.draftNew.packaging).map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </div>
                          <p className="text-[11px] text-zinc-500">
                            {r.draftNew.packaging
                              ? "El empaque casi siempre va en pza (1 contenedor, 1 bolsa). Después pones en cada producto cuánto lleva, en su recuadro Packaging."
                              : "La unidad es en la que lo vas a contar y gastar en tus recetas (ej. queso en pza si usas rebanadas, carne en g o kg)."}
                          </p>
                          <button
                            type="button"
                            onClick={() => createIngredient(r)}
                            className="w-full rounded-xl bg-orange-500 py-2 font-black text-black"
                          >
                            {r.draftNew.packaging ? "Crear empaque" : "Crear ingrediente"}
                          </button>
                        </div>
                      )}
                      {ing && (
                        <>
                          <div
                            className="flex overflow-hidden rounded-xl border border-zinc-800 text-xs font-black"
                            role="group"
                            aria-label="Cómo se compra"
                          >
                            <button
                              type="button"
                              onClick={() => update(r.key, { byWeight: false })}
                              aria-pressed={!r.byWeight}
                              className={`flex-1 px-3 py-2 ${!r.byWeight ? "bg-orange-500 text-black" : "bg-zinc-950 text-zinc-400"}`}
                            >
                              📦 Por pieza o paquete
                            </button>
                            <button
                              type="button"
                              onClick={() => update(r.key, { byWeight: true })}
                              aria-pressed={r.byWeight}
                              className={`flex-1 px-3 py-2 ${r.byWeight ? "bg-orange-500 text-black" : "bg-zinc-950 text-zinc-400"}`}
                            >
                              ⚖️ A granel (por peso)
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-bold text-zinc-400">
                              {r.byWeight
                                ? "En este ticket pesó"
                                : "Cada uno trae"}
                            </span>
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={r.qty}
                              onChange={(e) =>
                                update(r.key, { qty: e.target.value })
                              }
                              placeholder={r.byWeight ? "1.25" : "108"}
                              className="w-28 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-white"
                              aria-label={
                                r.byWeight
                                  ? "Cuánto pesó"
                                  : "Cuánto trae cada uno"
                              }
                            />
                            {units.length > 1 ? (
                              <select
                                value={r.unit}
                                onChange={(e) =>
                                  update(r.key, {
                                    unit: e.target.value as Unit,
                                  })
                                }
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-2"
                                aria-label="Unidad"
                              >
                                {units.map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="font-bold">{ing.unit}</span>
                            )}
                            {total > 0 && (
                              <span className="text-xs text-zinc-400">
                                ={" "}
                                <b className="text-white">
                                  {total} {ing.unit}
                                </b>{" "}
                                al inventario
                              </span>
                            )}
                          </div>
                        </>
                      )}
                      {!r.draftNew && (
                        <button
                          type="button"
                          disabled={!ing || total <= 0}
                          onClick={() => update(r.key, { status: "listo" })}
                          className="w-full rounded-xl bg-emerald-500 py-2 font-black text-black disabled:opacity-30"
                        >
                          ✓ Así es
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black px-3 py-2 text-sm">
                      {r.status === "fuera" ? (
                        <span className="text-zinc-400">
                          🚫 No va al inventario
                        </span>
                      ) : (
                        <span className="min-w-0">
                          <span className="text-emerald-400">✓ </span>
                          <b>{ing?.name}</b>
                          <span className="text-zinc-400">
                            {r.byWeight
                              ? ` · a granel, ${r.qty} ${r.unit}`
                              : ` · ${r.qty} ${r.unit} c/u`}{" "}
                            →{" "}
                            <b className="text-white">
                              {total} {ing?.unit}
                            </b>
                          </span>
                          {r.status === "conocido" && (
                            <span className="ml-1 text-xs text-zinc-500">
                              (equivalencia guardada)
                            </span>
                          )}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => update(r.key, { status: "revisar" })}
                        className="text-xs font-black text-orange-400"
                      >
                        Cambiar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {ticket.total > 0 && Math.abs(lineSum - ticket.total) >= 1 && (
            <p className="mt-3 text-xs text-yellow-300">
              Los renglones suman ${lineSum.toFixed(2)} y el ticket dice $
              {ticket.total.toFixed(2)}. Revisa si falta algún artículo o un
              importe.
            </p>
          )}
          <button
            onClick={use}
            className={`mt-5 w-full rounded-2xl py-3 font-black ${pending.length ? "border border-yellow-500/60 bg-yellow-500/10 text-yellow-200" : "bg-orange-500 text-black hover:bg-orange-400"}`}
          >
            {pending.length
              ? `${pending.length === 1 ? "Falta" : "Faltan"} ${pending.length} de ${rows.length} por relacionar`
              : "Usar en la compra →"}
          </button>
          <p className="mt-2 text-xs text-zinc-500">
            Lo que confirmes se guarda como equivalencia
            {supplier.trim() || ticket.supplier
              ? ` de ${supplier.trim() || ticket.supplier}`
              : ""}
            : la próxima vez esos artículos salen listos solos.
          </p>
        </section>
      ) : (
        <section className="flex items-center justify-center rounded-3xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">
          Toma la foto del ticket y presiona “Leer ticket con IA”. Aquí vas a
          revisar cada artículo antes de guardarlo.
        </section>
      )}
    </div>
  );
}
