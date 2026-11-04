"use client";
/**
 * Configuración → Productos → Importar: alta o cambio de muchos productos
 * desde un Excel (.xlsx) o CSV. Columnas: Nombre y Precio (obligatorias),
 * Categoría, Descripción, Emoji, Estación y Foto (liga https). Si el nombre
 * ya existe se actualiza lo que traiga el archivo; si no, se crea.
 * Primero se ve la vista previa y nada cambia hasta confirmar.
 */
import { useState } from "react";
import type { KitchenStation, Product } from "@/data/products";
import { stationLabel } from "@/lib/kds-config";
import { downloadXlsx, readSpreadsheet } from "@/lib/xlsx";

const STATIONS: KitchenStation[] = ["Parrilla", "Freidora", "Barra", "Cocina"];
const HEADERS = ["Nombre", "Precio", "Categoría", "Descripción", "Emoji", "Estación", "Foto"];

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Columna del archivo → campo del producto */
const FIELD_BY_HEADER: Record<string, keyof Row> = {
  nombre: "name",
  producto: "name",
  platillo: "name",
  precio: "price",
  categoria: "category",
  descripcion: "description",
  emoji: "emoji",
  estacion: "station",
  area: "station",
  foto: "image",
  imagen: "image",
};

type Row = { name: string; price: string; category: string; description: string; emoji: string; station: string; image: string };
type Planned = { line: number; name: string; status: "nuevo" | "cambia" | "igual" | "error"; detail: string; product?: Product };

function parsePrice(text: string) {
  const n = Number(text.replace(/[$\s]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

function stationOf(text: string): KitchenStation | null {
  const t = plain(text);
  if (!t) return null;
  return STATIONS.find((s) => plain(s) === t || plain(stationLabel(s)) === t) || null;
}

/** Lo que se haría con cada renglón (sin guardar nada) */
function plan(rows: string[][], catalog: Product[]): { lines: Planned[]; missing: string } {
  const [head = [], ...body] = rows;
  const fields = head.map((h) => FIELD_BY_HEADER[plain(h)]);
  if (!fields.includes("name") || !fields.includes("price")) return { lines: [], missing: "El archivo necesita columnas «Nombre» y «Precio» en el primer renglón. Descarga la plantilla para ver el formato." };
  const byName = new Map(catalog.map((p) => [plain(p.name), p]));
  const seen = new Set<string>();
  let nextId = Date.now();
  const lines = body.map((cells, i): Planned => {
    const r: Row = { name: "", price: "", category: "", description: "", emoji: "", station: "", image: "" };
    fields.forEach((f, j) => {
      if (f && cells[j] !== undefined && !r[f]) r[f] = String(cells[j]).trim();
    });
    const line = i + 2;
    const name = r.name.replace(/\s+/g, " ").slice(0, 80);
    if (!name) return { line, name: "(sin nombre)", status: "error", detail: "Falta el nombre" };
    const key = plain(name);
    if (seen.has(key)) return { line, name, status: "error", detail: "Repetido en el archivo" };
    seen.add(key);
    const price = parsePrice(r.price);
    const existing = byName.get(key);
    if (r.price && !(price > 0)) return { line, name, status: "error", detail: `Precio no válido: «${r.price}»` };
    if (!existing && !(price > 0)) return { line, name, status: "error", detail: "Falta el precio" };
    const station = stationOf(r.station);
    if (r.station && !station) return { line, name, status: "error", detail: `Estación desconocida: «${r.station}» (usa ${STATIONS.map(stationLabel).join(", ")})` };
    if (r.image && !/^https:\/\/\S+$/i.test(r.image)) return { line, name, status: "error", detail: "La foto debe ser una liga que empiece con https://" };

    const base: Product = existing ? { ...existing } : { id: nextId++, name, category: "General", price, emoji: "🍽️", station: "Cocina" };
    const changes: string[] = [];
    const change = <K extends keyof Product>(k: K, v: Product[K], text: string) => {
      if (base[k] !== v) {
        base[k] = v;
        changes.push(text);
      }
    };
    if (price > 0) change("price", price, `precio $${price.toFixed(2)}`);
    if (r.category) change("category", r.category.slice(0, 40), `categoría ${r.category}`);
    if (r.description) change("description", r.description.slice(0, 160), "descripción");
    if (r.emoji) change("emoji", r.emoji.slice(0, 8), `emoji ${r.emoji}`);
    if (station) change("station", station, `estación ${stationLabel(station)}`);
    if (r.image) change("image", r.image, "foto");
    if (!existing) return { line, name, status: "nuevo", detail: `${base.category} · $${base.price.toFixed(2)}`, product: base };
    return changes.length ? { line, name, status: "cambia", detail: changes.join(", "), product: base } : { line, name, status: "igual", detail: "Sin cambios" };
  });
  return { lines, missing: "" };
}

const STATUS = {
  nuevo: { text: "Nuevo", cls: "bg-emerald-500/15 text-emerald-300" },
  cambia: { text: "Cambia", cls: "bg-orange-500/15 text-orange-300" },
  igual: { text: "Igual", cls: "bg-zinc-800 text-zinc-400" },
  error: { text: "No se importa", cls: "bg-red-500/15 text-red-300" },
} as const;

export function ImportProductsModal({ products, onImport, onClose }: { products: Product[]; onImport: (next: Product[], summary: string) => void; onClose: () => void }) {
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<{ lines: Planned[]; missing: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    setFileName(file.name);
    try {
      const rows = await readSpreadsheet(file);
      if (rows.length < 2) throw new Error("El archivo no tiene productos (solo encabezados o está vacío).");
      if (rows.length > 1001) throw new Error("Máximo 1,000 productos por archivo.");
      setResult(plan(rows, products));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo.");
    } finally {
      setBusy(false);
    }
  }

  const template = () =>
    downloadXlsx("plantilla-productos-bpos", [
      {
        name: "Productos",
        rows: [HEADERS, ["Hamburguesa clásica", 115, "Hamburguesas", "Carne, queso, lechuga y jitomate", "🍔", "Parrilla", ""], ["Papas a la francesa", 55, "Complementos", "", "🍟", "Freidora", ""], ["Refresco", 35, "Bebidas", "", "🥤", "Barra", ""]],
      },
    ]);
  const exportCurrent = () =>
    downloadXlsx("productos-bpos", [
      {
        name: "Productos",
        rows: [HEADERS, ...products.filter((p) => !p.notSoldAlone).map((p) => [p.name, p.price, p.category, p.description || "", p.emoji, stationLabel(p.station || "Cocina"), p.image || ""])],
      },
    ]);

  const lines = result?.lines || [];
  const toSave = lines.filter((l) => l.product && (l.status === "nuevo" || l.status === "cambia"));
  const count = (s: Planned["status"]) => lines.filter((l) => l.status === s).length;

  function confirm() {
    const updated = new Map(toSave.filter((l) => l.status === "cambia").map((l) => [l.product!.id, l.product!]));
    const next = [...products.map((p) => updated.get(p.id) || p), ...toSave.filter((l) => l.status === "nuevo").map((l) => l.product!)];
    onImport(next, `${count("nuevo")} nuevo(s) y ${count("cambia")} actualizado(s).`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-3xl border border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-black">📥 Importar productos desde Excel o CSV</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Columnas: <b>Nombre</b> y <b>Precio</b> (obligatorias), Categoría, Descripción, Emoji, Estación y Foto (liga https). Si el nombre ya existe, se cambia lo que traiga el archivo (precio, categoría...); si no, se crea. Las opciones, recetas y combos se arman después en cada producto.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <label className="cursor-pointer rounded-2xl bg-orange-500 px-4 py-3 font-black text-black">
            {busy ? "Leyendo..." : "📂 Elegir archivo"}
            <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
          </label>
          <button type="button" onClick={template} className="rounded-2xl border border-zinc-700 px-4 py-3 text-sm font-black hover:border-orange-500">
            ⬇️ Plantilla
          </button>
          {products.length > 0 && (
            <button type="button" onClick={exportCurrent} title="Descarga tus productos, cambia precios en Excel y vuelve a importarlo" className="rounded-2xl border border-zinc-700 px-4 py-3 text-sm font-black hover:border-orange-500">
              ⬇️ Mis productos (para cambiar precios)
            </button>
          )}
        </div>
        {fileName && <p className="mt-3 text-xs text-zinc-500">Archivo: {fileName}</p>}
        {error && <p className="mt-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm font-bold text-red-200">{error}</p>}
        {result?.missing && <p className="mt-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm font-bold text-red-200">{result.missing}</p>}

        {lines.length > 0 && (
          <>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-black">
              {(["nuevo", "cambia", "igual", "error"] as const).map((s) =>
                count(s) ? (
                  <span key={s} className={`rounded-full px-3 py-1 ${STATUS[s].cls}`}>
                    {STATUS[s].text}: {count(s)}
                  </span>
                ) : null
              )}
            </div>
            <div className="bpos-scroll mt-3 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-zinc-800">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-zinc-900 text-xs text-zinc-400">
                  <tr>
                    <th className="px-3 py-2">Renglón</th>
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-3 py-2">Qué pasa</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.line} className="border-t border-zinc-900">
                      <td className="px-3 py-2 text-zinc-500">{l.line}</td>
                      <td className="px-3 py-2 font-bold">{l.name}</td>
                      <td className="px-3 py-2">
                        <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-black ${STATUS[l.status].cls}`}>{STATUS[l.status].text}</span>
                        <span className="text-zinc-400">{l.detail}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-2xl border border-zinc-800 py-3 font-black">
            Cancelar
          </button>
          <button onClick={confirm} disabled={toSave.length === 0} className="flex-1 rounded-2xl bg-orange-500 py-3 font-black text-black disabled:opacity-40">
            Importar {toSave.length || ""} producto(s)
          </button>
        </div>
      </div>
    </div>
  );
}
