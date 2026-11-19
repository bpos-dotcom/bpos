"use client";
/**
 * Etiquetas de precio con código de barras (tiendas y ferreterías): elegir
 * cuántas de cada producto y el tamaño de la etiqueta, e imprimir. Cada
 * etiqueta lleva el nombre (2 renglones), el precio, el código y sus números.
 */
import { useMemo, useState } from "react";
import { barcodeSvg } from "@/lib/barcode-svg";

export type BarcodeLabelItem = { name: string; price: number; barcode: string };

type Props = {
  items: BarcodeLabelItem[];
  onClose: () => void;
};

const SIZES = [
  { key: "50x25", label: "50 × 25 mm", width: 50, height: 25 },
  { key: "38x25", label: "38 × 25 mm", width: 38, height: 25 },
] as const;
type SizeKey = (typeof SIZES)[number]["key"];

const money = (n: number) => `$${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function labelHtml(item: BarcodeLabelItem) {
  return (
    `<div class="label"><div class="name">${escapeHtml(item.name)}</div>` +
    `<div class="price">${money(item.price)}</div>` +
    `<div class="bars">${barcodeSvg(item.barcode, { height: 50, moduleWidth: 2 })}</div>` +
    `<div class="digits">${escapeHtml(item.barcode)}</div></div>`
  );
}

function printDocument(labels: BarcodeLabelItem[], width: number, height: number) {
  const small = width < 45;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>
@page { size: ${width}mm ${height}mm; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
.label { width: ${width}mm; height: ${height}mm; padding: 1.2mm 1.5mm; display: flex; flex-direction: column; overflow: hidden; page-break-after: always; break-after: page; }
.label:last-child { page-break-after: auto; break-after: auto; }
.name { font-size: ${small ? 6.5 : 7.5}pt; font-weight: 700; line-height: 1.15; max-height: 2.3em; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
.price { font-size: ${small ? 11 : 13}pt; font-weight: 900; line-height: 1.1; margin-top: 0.4mm; }
.bars { flex: 1; min-height: 0; margin-top: 0.5mm; }
.bars svg { display: block; width: 100%; height: 100%; }
.digits { font-size: 6pt; text-align: center; letter-spacing: 0.4pt; line-height: 1.1; }
</style></head><body>${labels.map(labelHtml).join("")}</body></html>`;
}

/** Imprime en un iframe oculto (sin abrir otra ventana) */
function printLabels(labels: BarcodeLabelItem[], width: number, height: number) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", visibility: "hidden" });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(printDocument(labels, width, height));
  doc.close();
  const cleanup = () => setTimeout(() => frame.remove(), 1000);
  win.addEventListener("afterprint", cleanup, { once: true });
  setTimeout(() => {
    win.focus();
    win.print();
    // Por si el navegador no avisa "afterprint"
    setTimeout(() => frame.parentNode && frame.remove(), 60_000);
  }, 250);
}

export function BarcodeLabels({ items, onClose }: Props) {
  const [copies, setCopies] = useState<number[]>(() => items.map(() => 1));
  const [sizeKey, setSizeKey] = useState<SizeKey>("50x25");
  const size = SIZES.find((s) => s.key === sizeKey) ?? SIZES[0];

  const labels = useMemo(() => items.flatMap((item, i) => Array.from({ length: copies[i] ?? 0 }, () => item)), [items, copies]);
  const preview = items.find((item, i) => (copies[i] ?? 0) > 0) ?? items[0];
  const setCopy = (i: number, value: number) =>
    setCopies((prev) => prev.map((c, j) => (j === i ? Math.max(0, Math.min(999, Math.round(value) || 0)) : c)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur sm:p-6" onClick={onClose}>
      <section
        className="max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950 p-5 text-white sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-bold text-orange-500">Inventario</p>
            <h2 className="text-2xl font-black sm:text-3xl">Etiquetas de precio</h2>
          </div>
          <button onClick={onClose} className="rounded-xl border border-zinc-800 bg-black px-4 py-2 font-black" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-400">Tamaño</span>
          <div className="flex gap-1 rounded-xl border border-zinc-800 p-1 text-xs font-black">
            {SIZES.map((s) => (
              <button
                key={s.key}
                onClick={() => setSizeKey(s.key)}
                className={`rounded-lg px-3 py-1.5 ${sizeKey === s.key ? "bg-orange-500 text-black" : "text-zinc-400 hover:text-white"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {preview && (
          <div className="mt-4 flex justify-center rounded-2xl border border-zinc-800 bg-black p-4">
            <div
              className="flex flex-col overflow-hidden rounded bg-white px-2 py-1.5 text-black"
              style={{ width: `${size.width * 4}px`, height: `${size.height * 4}px` }}
            >
              <p className="line-clamp-2 text-[11px] font-bold leading-tight">{preview.name}</p>
              <p className="text-lg font-black leading-tight">{money(preview.price)}</p>
              <div
                className="mt-0.5 min-h-0 flex-1 [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: barcodeSvg(preview.barcode, { height: 50, moduleWidth: 2 }) }}
              />
              <p className="text-center text-[9px] leading-tight tracking-wide">{preview.barcode}</p>
            </div>
          </div>
        )}

        <ul className="mt-4 space-y-2">
          {items.map((item, i) => (
            <li key={`${item.barcode}-${i}`} className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-black p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-black">{item.name}</p>
                <p className="text-xs text-zinc-400">
                  {money(item.price)} · {item.barcode}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setCopy(i, (copies[i] ?? 0) - 1)} className="h-10 w-10 rounded-xl border border-zinc-800 bg-zinc-900 font-black" aria-label="Menos">
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={999}
                  value={copies[i] ?? 0}
                  onChange={(e) => setCopy(i, Number(e.target.value))}
                  className="h-10 w-14 rounded-xl border border-zinc-800 bg-zinc-900 text-center font-black outline-none focus:border-orange-500"
                  aria-label={`Copias de ${item.name}`}
                />
                <button onClick={() => setCopy(i, (copies[i] ?? 0) + 1)} className="h-10 w-10 rounded-xl border border-zinc-800 bg-zinc-900 font-black" aria-label="Más">
                  +
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-2xl border border-zinc-800 bg-black py-3 font-black text-zinc-300">
            Cancelar
          </button>
          <button
            onClick={() => printLabels(labels, size.width, size.height)}
            disabled={labels.length === 0}
            className="flex-[2] rounded-2xl bg-orange-500 py-3 font-black text-black disabled:opacity-40"
          >
            🖨️ Imprimir {labels.length} {labels.length === 1 ? "etiqueta" : "etiquetas"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default BarcodeLabels;
