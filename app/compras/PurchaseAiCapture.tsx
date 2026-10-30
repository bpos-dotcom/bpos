"use client";
/**
 * Compras → Foto de ticket. Plan Max: la IA de B-POS lee el ticket y llena la
 * compra (se revisa antes de usarla). Otros planes: invitación a Max y la
 * captura manual de siempre.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AiPurchaseTicket } from "@/app/api/ai/purchase/route";
import { AI_REASON_TEXT, aiFetch, getAiStatus, type AiStatus } from "@/lib/ai/client";
import { getInventory } from "@/lib/inventory";
import { getPurchaseAliases } from "@/lib/purchases";
import type { Ingredient } from "@/data/inventory";

export type AiPurchaseResult = {
  supplier: string;
  invoice: string;
  imageName: string;
  lines: { ingredientId: number; ticketName: string; presentations: number; inventoryQuantity: number; lineTotal: number }[];
};

type Props = { onReady: (result: AiPurchaseResult) => void; onManual: () => void };

const MAX_SIDE = 1800;

/** Foto más ligera (JPG de máximo 1800 px) para que suba rápido y quepa en la nube. */
async function compress(file: File): Promise<{ mediaType: string; data: string }> {
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
    return { mediaType: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Row = AiPurchaseTicket["lines"][number] & { key: string };

export default function PurchaseAiCapture({ onReady, onManual }: Props) {
  const [ai, setAi] = useState<AiStatus | null | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
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
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

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
          ingredients: inventory.map((i) => ({ id: i.id, name: i.name, unit: i.unit })),
          aliases: getPurchaseAliases().map((a) => ({ ticketName: a.ticketName, ingredientId: a.ingredientId, quantity: a.quantity })),
        }),
      });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.success) throw new Error(b?.error || "No se pudo leer el ticket.");
      const t = b.ticket as AiPurchaseTicket;
      setTicket(t);
      if (t.supplier && !supplier) setSupplier(t.supplier);
      setRows(t.lines.map((l, i) => ({ ...l, key: `ai-${i}` })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el ticket.");
    } finally {
      setBusy(false);
    }
  }

  function update(key: string, patch: Partial<Row>) {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function use() {
    const ready = rows.filter((r) => r.ingredientId !== null && r.inventoryQuantity > 0);
    if (!ready.length) {
      setError("Elige el insumo y la cantidad de al menos un artículo.");
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
        inventoryQuantity: r.inventoryQuantity,
        lineTotal: r.lineTotal,
      })),
    });
  }

  if (ai === undefined) {
    return <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-500">Revisando tu plan...</section>;
  }

  if (!ai?.available) {
    const notMax = !ai || ai.plan !== "max";
    return (
      <section className="rounded-3xl border border-orange-500/40 bg-gradient-to-br from-orange-500/15 to-zinc-950 p-8">
        <p className="text-4xl">🤖</p>
        <h2 className="mt-3 text-2xl font-black text-orange-400">
          {notMax ? "¿Quieres capturar tus tickets con IA? ¡Pásate a Max!" : "Captura con IA no disponible"}
        </h2>
        <p className="mt-2 max-w-2xl text-zinc-300">
          {notMax
            ? "Con el plan Max solo tomas la foto del ticket y la IA de B-POS lee al proveedor, cada artículo, cantidades y precios, y llena la compra por ti."
            : AI_REASON_TEXT[ai?.reason || "plan"]}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {notMax && (
            <Link href="/configuracion/plan" className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black hover:bg-orange-400">
              Ver plan Max
            </Link>
          )}
          <button onClick={onManual} className="rounded-2xl border border-zinc-700 px-5 py-3 font-black hover:border-orange-500">
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
        <p className="mt-2 text-sm text-zinc-400">Toma una foto clara del ticket completo. La IA lo lee y tú revisas antes de guardar.</p>
        <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-5 flex h-64 w-full items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed border-zinc-700 bg-black hover:border-orange-500"
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- vista previa local
            <img src={preview} alt="Ticket" className="h-full w-full object-contain" />
          ) : (
            <span className="text-center">
              <span className="block text-6xl">📷</span>
              <span className="mt-3 block font-black">Tomar / seleccionar foto</span>
            </span>
          )}
        </button>
        <input
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          placeholder="Proveedor (opcional, la IA lo lee del ticket)"
          className="mt-4 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3"
        />
        <button type="button" disabled={!file || busy} onClick={() => void read()} className="mt-4 w-full rounded-2xl bg-orange-500 py-3 font-black text-black disabled:opacity-40">
          {busy ? "Leyendo ticket con IA..." : "Leer ticket con IA"}
        </button>
        {error && <p className="mt-3 text-sm font-bold text-red-300">{error}</p>}
      </section>

      {ticket ? (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-black">Revisa la compra</h2>
            <p className="text-sm text-zinc-400">
              {ticket.supplier || "Proveedor sin leer"}
              {ticket.invoice ? ` · Folio ${ticket.invoice}` : ""}
              {ticket.date ? ` · ${ticket.date}` : ""} · Total del ticket <b className="text-white">${ticket.total.toFixed(2)}</b>
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
              const unit = inventory.find((i) => i.id === r.ingredientId)?.unit;
              return (
                <div key={r.key} className={`grid gap-2 rounded-2xl border p-3 md:grid-cols-[1.2fr_1.3fr_0.8fr_0.8fr] ${r.ingredientId === null ? "border-yellow-500/50" : "border-zinc-800"}`}>
                  <div>
                    <p className="font-black">{r.ticketName}</p>
                    <p className="text-xs text-zinc-500">{r.presentations} presentación(es)</p>
                  </div>
                  <select
                    value={r.ingredientId ?? ""}
                    onChange={(e) => update(r.key, { ingredientId: e.target.value ? Number(e.target.value) : null })}
                    className="rounded-xl border border-zinc-800 bg-black px-3 py-2"
                  >
                    <option value="">— No entra al inventario —</option>
                    {inventory.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} ({i.unit})
                      </option>
                    ))}
                  </select>
                  <label className="text-xs text-zinc-400">
                    Cantidad {unit ? `(${unit})` : ""}
                    <input
                      type="number"
                      min={0}
                      value={r.inventoryQuantity || ""}
                      onChange={(e) => update(r.key, { inventoryQuantity: Number(e.target.value) || 0 })}
                      className="mt-1 w-full rounded-xl border border-zinc-800 bg-black px-3 py-2 text-white"
                    />
                  </label>
                  <label className="text-xs text-zinc-400">
                    Importe $
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={r.lineTotal || ""}
                      onChange={(e) => update(r.key, { lineTotal: Number(e.target.value) || 0 })}
                      className="mt-1 w-full rounded-xl border border-zinc-800 bg-black px-3 py-2 text-white"
                    />
                  </label>
                </div>
              );
            })}
          </div>
          <button onClick={use} className="mt-5 w-full rounded-2xl bg-orange-500 py-3 font-black text-black hover:bg-orange-400">
            Usar en la compra →
          </button>
          <p className="mt-2 text-xs text-zinc-500">Lo que relaciones se recuerda: la próxima vez esos artículos se reconocen solos.</p>
        </section>
      ) : (
        <section className="flex items-center justify-center rounded-3xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">
          Toma la foto del ticket y presiona “Leer ticket con IA”. Aquí vas a revisar cada artículo antes de guardarlo.
        </section>
      )}
    </div>
  );
}
