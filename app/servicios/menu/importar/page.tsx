"use client";
/**
 * Importar el menú desde Excel o CSV (Soft Restaurant u otro punto de venta):
 * sube el archivo, B-POS reconoce las columnas (lib/menu-import.ts), el
 * dueño las revisa, ve cómo quedan los productos y los da de alta de un
 * jalón. Los que ya existen con el mismo nombre se actualizan o se brincan.
 * Sirve para el menú digital (B-POS Servicios) y para B-POS completo.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import RequirePermission from "@/components/auth/RequirePermission";
import { AppShell } from "@/components/layout/AppShell";
import type { Product } from "@/data/products";
import { getAdminProducts, saveAdminProducts } from "@/lib/admin";
import { readSpreadsheet } from "@/lib/xlsx";
import { IMPORT_FIELDS, findHeaderRow, guessColumns, guessEmoji, readRows, type ColumnMap, type ImportField } from "@/lib/menu-import";
import { addAuditEvent } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** "HAMBURGUESAS" → "Hamburguesas" (las categorías de otros sistemas suelen venir en mayúsculas) */
const tidy = (s: string) => (s && s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : s);
const mxn = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function MenuImportPage() {
  const [file, setFile] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [map, setMap] = useState<ColumnMap>({});
  const [existing, setExisting] = useState<"update" | "skip">("update");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ created: number; updated: number; skipped: number } | null>(null);

  async function load(f: File | undefined) {
    if (!f) return;
    setError("");
    setDone(null);
    try {
      const data = await readSpreadsheet(f);
      if (!data.length) throw new Error("El archivo está vacío.");
      const h = findHeaderRow(data);
      setRows(data);
      setHeaderIndex(h);
      setMap(guessColumns(data[h] || []));
      setFile(f.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo.");
    }
  }

  const header = rows[headerIndex] || [];
  const parsed = useMemo(() => (rows.length ? readRows(rows, headerIndex, map) : []), [rows, headerIndex, map]);
  const products = useMemo(() => getAdminProducts(), [done]); // eslint-disable-line react-hooks/exhaustive-deps -- se relee al terminar de importar
  const good = parsed.filter((r) => !r.problem);
  const bad = parsed.filter((r) => r.problem);
  const repeated = good.filter((r) => products.some((p) => sameName(p.name, r.name)));
  const missingRequired = IMPORT_FIELDS.filter((f) => f.required && map[f.field] === undefined);

  function run() {
    const list = getAdminProducts();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let nextId = Date.now();
    const seen = new Set<string>();
    for (const r of good) {
      const key = r.name.trim().toLowerCase();
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
      const category = tidy(r.category) || "Sin categoría";
      const i = list.findIndex((p) => sameName(p.name, r.name));
      if (i >= 0) {
        if (existing === "skip") {
          skipped += 1;
          continue;
        }
        list[i] = { ...list[i], price: r.price!, ...(r.category ? { category } : {}), ...(r.description ? { description: r.description } : {}) };
        updated += 1;
      } else {
        const p: Product = { id: nextId++, name: r.name, category, price: r.price!, emoji: guessEmoji(category, r.name), station: "Cocina", ...(r.description ? { description: r.description } : {}) };
        list.push(p);
        created += 1;
      }
    }
    saveAdminProducts(list);
    const user = getCurrentUser();
    addAuditEvent({ category: "Productos", action: "products.imported", description: `${user?.name || "Usuario"} importó el menú desde ${file}: ${created} nuevos, ${updated} actualizados, ${skipped} brincados`, userId: user?.id ? String(user.id) : undefined, userName: user?.name, metadata: { file, created, updated, skipped } });
    setDone({ created, updated, skipped });
  }

  return (
    <RequirePermission permission="products.manage">
      <AppShell title="Importar menú" subtitle="Sube tu catálogo de Soft Restaurant u otro punto de venta en Excel o CSV.">
        <div className="max-w-6xl space-y-5">
          <section className="rounded-3xl border border-orange-500/40 bg-zinc-950 p-5">
            <p className="text-lg font-black">📥 1. Sube tu archivo</p>
            <p className="mt-1 text-sm text-zinc-400">
              En Soft Restaurant: Catálogos → Productos → Exportar a Excel. Sirve cualquier Excel (.xlsx) o CSV con el nombre y el precio de cada producto. Si tu archivo es .xls viejo, ábrelo y guárdalo como .xlsx.
            </p>
            <label className="mt-4 inline-block cursor-pointer rounded-2xl bg-orange-500 px-5 py-3 font-black text-black">
              {file ? "Cambiar archivo" : "Elegir archivo"}
              <input type="file" accept=".xlsx,.csv,text/csv" className="hidden" onChange={(e) => void load(e.target.files?.[0])} />
            </label>
            {file && <span className="ml-3 text-sm text-zinc-300">{file}</span>}
            {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
          </section>

          {rows.length > 0 && !done && (
            <>
              <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
                <p className="text-lg font-black">2. Revisa qué columna es cada cosa</p>
                <label className="mt-2 block text-sm text-zinc-400">
                  Los encabezados están en el renglón{" "}
                  <select value={headerIndex} onChange={(e) => { const h = Number(e.target.value); setHeaderIndex(h); setMap(guessColumns(rows[h] || [])); }} className="rounded-xl border border-zinc-800 bg-black px-2 py-1 text-white">
                    {rows.slice(0, 15).map((r, i) => (
                      <option key={i} value={i}>
                        {i + 1}: {r.filter(Boolean).slice(0, 4).join(" · ").slice(0, 60)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {IMPORT_FIELDS.map((f) => (
                    <label key={f.field} className="text-xs font-bold text-zinc-400">
                      {f.label}
                      {f.required ? " *" : ""}
                      <select
                        value={map[f.field] ?? ""}
                        onChange={(e) => setMap((m) => ({ ...m, [f.field]: e.target.value === "" ? undefined : Number(e.target.value) }) as Record<ImportField, number>)}
                        className={`mt-1 w-full rounded-xl border bg-black px-2 py-2 text-sm text-white ${f.required && map[f.field] === undefined ? "border-red-500" : "border-zinc-800"}`}
                      >
                        <option value="">— No usar —</option>
                        {header.map((h, i) => (
                          <option key={i} value={i}>
                            {h || `Columna ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-lg font-black">3. Así quedan tus productos</p>
                  <p className="text-sm text-zinc-400">
                    <b className="text-emerald-300">{good.length}</b> listos · <b className="text-yellow-300">{repeated.length}</b> ya existen · <b className="text-red-300">{bad.length}</b> con problema
                  </p>
                </div>
                <div className="mt-3 max-h-[28rem] overflow-auto rounded-2xl border border-zinc-800">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="sticky top-0 bg-zinc-900 text-xs text-zinc-400">
                      <tr>
                        <th className="p-2">Renglón</th>
                        <th className="p-2">Producto</th>
                        <th className="p-2">Categoría</th>
                        <th className="p-2 text-right">Precio</th>
                        <th className="p-2">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.slice(0, 300).map((r) => {
                        const exists = !r.problem && products.some((p) => sameName(p.name, r.name));
                        return (
                          <tr key={r.line} className="border-t border-zinc-800">
                            <td className="p-2 text-zinc-500">{r.line}</td>
                            <td className="p-2 font-bold">
                              {guessEmoji(r.category, r.name)} {r.name || "—"}
                              {r.description && <span className="block text-xs font-normal text-zinc-500">{r.description}</span>}
                            </td>
                            <td className="p-2 text-zinc-300">{tidy(r.category) || "Sin categoría"}</td>
                            <td className="p-2 text-right font-black">{r.price === null ? "—" : mxn(r.price)}</td>
                            <td className={`p-2 text-xs font-bold ${r.problem ? "text-red-300" : exists ? "text-yellow-300" : "text-emerald-300"}`}>{r.problem || (exists ? (existing === "update" ? "Se actualiza" : "Se brinca") : "Nuevo")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {parsed.length > 300 && <p className="mt-2 text-xs text-zinc-500">Se muestran los primeros 300 de {parsed.length}; se importan todos.</p>}
                {repeated.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 text-sm">
                    <span className="text-zinc-400">Los que ya existen (mismo nombre):</span>
                    {(["update", "skip"] as const).map((v) => (
                      <button key={v} onClick={() => setExisting(v)} className={`rounded-xl border px-3 py-1 font-black ${existing === v ? "border-orange-500 bg-orange-500/15 text-orange-200" : "border-zinc-700 text-zinc-400"}`}>
                        {v === "update" ? "Actualizar precio y categoría" : "Dejarlos como están"}
                      </button>
                    ))}
                  </div>
                )}
                <button disabled={!good.length || missingRequired.length > 0} onClick={run} className="mt-4 rounded-2xl bg-orange-500 px-6 py-3 font-black text-black disabled:opacity-40">
                  {missingRequired.length ? `Falta elegir: ${missingRequired.map((f) => f.label).join(", ")}` : `Importar ${good.length} producto${good.length === 1 ? "" : "s"}`}
                </button>
              </section>
            </>
          )}

          {done && (
            <section className="rounded-3xl border border-emerald-500/40 bg-emerald-500/10 p-5">
              <p className="text-lg font-black text-emerald-200">✅ Menú importado</p>
              <p className="mt-1 text-sm text-zinc-300">
                {done.created} nuevos · {done.updated} actualizados · {done.skipped} brincados. Revisa fotos, opciones y la estación de cocina de cada uno en Productos.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/configuracion/productos" className="rounded-2xl bg-orange-500 px-5 py-2.5 font-black text-black">
                  Ver productos
                </Link>
                <Link href="/configuracion/menu-digital" className="rounded-2xl border border-zinc-700 px-5 py-2.5 font-black text-zinc-200">
                  Ir a mi menú digital
                </Link>
                <button onClick={() => { setDone(null); setRows([]); setFile(""); }} className="rounded-2xl border border-zinc-700 px-5 py-2.5 font-black text-zinc-400">
                  Importar otro archivo
                </button>
              </div>
            </section>
          )}
        </div>
      </AppShell>
    </RequirePermission>
  );
}
