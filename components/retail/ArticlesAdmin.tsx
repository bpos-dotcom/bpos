"use client";
/**
 * Tienda y ferretería → Artículos: alta con el lector de código de barras,
 * precio, costo, existencias, a granel y mayoreo. Cada artículo con
 * existencias tiene su insumo en el inventario (lib/retail.ts), así que
 * Inventario, Compras e Inventario ciego funcionan igual que en el restaurante.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Product, RetailUnit } from "@/data/products";
import type { Ingredient } from "@/data/inventory";
import { getAdminIngredients, getAdminProducts, getAdminRecipes, saveAdminProducts } from "@/lib/admin";
import { getSessionUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { addAuditEvent } from "@/lib/audit";
import { recordStockEdit } from "@/lib/inventory";
import { addToGallery, photoName } from "@/lib/photo-gallery";
import { GalleryPicker } from "@/components/products/GalleryPicker";
import { lookupBarcode, generateInternalBarcode, normalizeBarcode } from "@/lib/barcode-lookup";
import { BarcodeLabels } from "@/components/inventory/BarcodeLabels";
import { downloadXlsx, readSpreadsheet } from "@/lib/xlsx";
import { useBusinessType } from "@/lib/business-type";
import {
  RETAIL_UNITS,
  SUGGESTED_RETAIL_CATEGORIES,
  codesOf,
  duplicateCode,
  findByBarcode,
  formatQty,
  isBulk,
  margin,
  removeStockItem,
  stockOf,
  syncStockItems,
  unitOf,
  unitShort,
} from "@/lib/retail";
import { RETAIL_HEADERS, planRetailImport, type RetailPlanned } from "@/lib/retail-import";

const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white placeholder:text-zinc-600";
const labelCls = "mb-1 block text-sm font-bold text-zinc-400";
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Draft = Product & { stockText: string; minimumText: string; extraCodesText: string };

function toDraft(p: Product, ingredients: Ingredient[]): Draft {
  const item = stockOf(p, ingredients);
  return {
    ...p,
    stockText: item ? String(item.stock) : "",
    minimumText: item ? String(item.minimum || "") : "",
    extraCodesText: (p.extraBarcodes || []).join(", "),
  };
}

export function ArticlesAdmin() {
  const type = useBusinessType();
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState("");
  const [picking, setPicking] = useState(false);
  const [labels, setLabels] = useState<Product[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [onlyLow, setOnlyLow] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const [canPrice] = useState(() => hasPermission(getSessionUser(), "prices.manage"));
  const [canDelete] = useState(() => hasPermission(getSessionUser(), "products.delete"));

  useEffect(() => {
    const load = () => {
      setProducts(getAdminProducts());
      setIngredients(getAdminIngredients());
    };
    load();
    // Desde la caja: "?codigo=750..." (escaneado y no dado de alta) abre su alta
    const wanted = new URLSearchParams(window.location.search).get("codigo")?.replace(/\s+/g, "");
    if (wanted) {
      const hit = findByBarcode(getAdminProducts(), wanted);
      if (hit) select(hit);
      else newArticle(wanted);
    }
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === "bpos_products" || e.key === "bpos_inventory") load();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("bpos:inventory-updated", load);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("bpos:inventory-updated", load);
    };
  }, []);

  const categories = useMemo(() => {
    const own = [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    return own;
  }, [products]);
  const suggestions = useMemo(
    () => [...new Set([...categories, ...(type === "ferreteria" ? SUGGESTED_RETAIL_CATEGORIES.ferreteria : SUGGESTED_RETAIL_CATEGORIES.tienda)])],
    [categories, type]
  );
  const suppliers = useMemo(() => [...new Set(products.map((p) => p.supplier?.trim()).filter(Boolean) as string[])].sort(), [products]);

  const isLow = (p: Product) => {
    const item = stockOf(p, ingredients);
    return Boolean(item && Number(item.minimum) > 0 && Number(item.stock) <= Number(item.minimum));
  };
  const visible = products.filter((p) => {
    if (p.notSoldAlone) return false;
    if (category && p.category !== category) return false;
    if (onlyLow && !isLow(p)) return false;
    const q = plain(query.trim());
    if (!q) return true;
    return plain(`${p.name} ${p.category} ${codesOf(p).join(" ")} ${p.supplier || ""}`).includes(q);
  });
  const lowCount = products.filter(isLow).length;

  function select(p: Product) {
    setDraft(toDraft(p, getAdminIngredients()));
  }

  function newArticle(barcode = "", name = "") {
    const p: Product = {
      id: Date.now(),
      name: name || "Nuevo artículo",
      category: category || categories[0] || (type === "ferreteria" ? "Varios" : "Abarrotes"),
      price: 0,
      emoji: type === "ferreteria" ? "🔩" : "🏷️",
      station: "Cocina",
      sellBy: "pieza",
      unit: "pza",
      ...(barcode ? { barcode } : {}),
    };
    setDraft({ ...p, stockText: "0", minimumText: "", extraCodesText: "" });
    if (barcode) void fillFromBarcode(barcode, p.id);
    window.setTimeout(() => document.getElementById("ficha-articulo")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  /** Datos públicos del código (nombre y foto) si existen */
  async function fillFromBarcode(code: string, forId?: number) {
    setBusy("Buscando el artículo por su código...");
    const info = await lookupBarcode(code);
    setBusy("");
    if (!info?.name) return;
    setDraft((d) => {
      if (!d || (forId !== undefined && d.id !== forId)) return d;
      const fresh = d.name === "Nuevo artículo" || !d.name.trim();
      return { ...d, ...(fresh ? { name: info.name! } : {}), ...(!d.image && info.image ? { image: info.image } : {}) };
    });
  }

  /** Lector de código de barras (escribe el código y un Enter) o búsqueda */
  function onScan() {
    const code = normalizeBarcode(query);
    if (!code) return;
    const hit = findByBarcode(products, code);
    if (hit) {
      select(hit);
      setQuery("");
      return;
    }
    if (/^\d{6,14}$/.test(code)) {
      newArticle(code);
      setQuery("");
    }
  }

  function save() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return alert("Escribe el nombre del artículo.");
    const price = Number(draft.price);
    if (!Number.isFinite(price) || price < 0) return alert("Escribe un precio válido.");
    const stored = products.find((p) => p.id === draft.id);
    if (!canPrice && stored && stored.price > 0 && stored.price !== price) return alert("No tienes permiso para cambiar precios.");
    const extraBarcodes = draft.extraCodesText
      .split(/[,\s]+/)
      .map((c) => c.trim())
      .filter((c) => c && c !== draft.barcode);
    const { stockText, minimumText, extraCodesText: _e, ...rest } = draft;
    void _e;
    const product: Product = {
      ...rest,
      name,
      price: Math.round(price * 100) / 100,
      category: draft.category.trim() || "Varios",
      barcode: draft.barcode?.trim() || undefined,
      extraBarcodes: extraBarcodes.length ? [...new Set(extraBarcodes)] : undefined,
      supplier: draft.supplier?.trim() || undefined,
      cost: Number(draft.cost) > 0 ? Math.round(Number(draft.cost) * 100) / 100 : undefined,
      wholesale: draft.wholesale && draft.wholesale.minQty > 0 && draft.wholesale.price > 0 ? draft.wholesale : undefined,
      station: draft.station || "Cocina",
    };
    if (product.openPrice) product.noStock = true;
    product.sellBy = draft.sellBy || "pieza";
    // Producto de cuando era restaurante con receta: llevar existencias reemplaza su receta
    if (!product.noStock && !stored?.sellBy && stored) {
      const recipe = getAdminRecipes().filter((r) => Number(r.productId) === Number(product.id));
      const ownStock = recipe.length === 1 && Number(recipe[0].ingredientId) === Number(stored.stockItemId);
      if (recipe.length && !ownStock && !confirm(`"${product.name}" tiene una receta de restaurante. Si lleva existencias como artículo, su receta se reemplaza. ¿Continuar? (Cancelar = guardarlo sin existencias)`)) product.noStock = true;
    }
    const dup = duplicateCode(getAdminProducts(), product);
    if (dup) return alert(`El código ${dup.code} ya es de "${dup.product.name}".`);
    const list = getAdminProducts();
    const exists = list.some((p) => p.id === product.id);
    const next = exists ? list.map((p) => (p.id === product.id ? product : p)) : [...list, product];
    const edits = new Map<number, { stock?: number; minimum?: number }>();
    if (!product.noStock) {
      const stock = stockText.trim() === "" ? undefined : Number(stockText);
      const minimum = minimumText.trim() === "" ? 0 : Number(minimumText);
      if (stock !== undefined && !Number.isFinite(stock)) return alert("La existencia debe ser un número.");
      edits.set(product.id, { ...(stock !== undefined ? { stock } : {}), minimum: Number.isFinite(minimum) ? minimum : 0 });
    }
    const { products: synced, stockChanges } = syncStockItems(next, edits);
    saveAdminProducts(synced);
    for (const c of stockChanges) recordStockEdit(c.ingredient, c.previous, `${product.name} (artículo)`);
    if (stored && stored.price !== product.price) {
      const user = getSessionUser();
      addAuditEvent({ category: "Productos", action: "product.price", description: `${user?.name || "Usuario"} cambió el precio de ${product.name}: ${money(stored.price)} → ${money(product.price)}`, userName: user?.name, entityId: String(product.id) });
    }
    setProducts(synced);
    const fresh = getAdminIngredients();
    setIngredients(fresh);
    setDraft(toDraft(synced.find((p) => p.id === product.id)!, fresh));
    setBusy("Guardado ✓");
    window.setTimeout(() => setBusy(""), 1500);
    scanRef.current?.focus();
  }

  function remove() {
    if (!draft || !canDelete) return;
    if (!products.some((p) => p.id === draft.id)) return setDraft(null);
    if (!confirm(`¿Eliminar "${draft.name}"? Se quita de la caja y su existencia del inventario. Las ventas pasadas no cambian.`)) return;
    const next = getAdminProducts().filter((p) => p.id !== draft.id);
    saveAdminProducts(next);
    removeStockItem(draft);
    const user = getSessionUser();
    addAuditEvent({ category: "Productos", action: "product.deleted", description: `${user?.name || "Usuario"} eliminó el artículo ${draft.name}`, userName: user?.name, entityId: String(draft.id) });
    setProducts(next);
    setIngredients(getAdminIngredients());
    setDraft(null);
  }

  async function uploadPhoto(file: File | undefined) {
    if (!file || !draft) return;
    setBusy("Subiendo foto...");
    try {
      const { url } = await addToGallery(file, draft.name || photoName(file.name), false);
      setDraft((d) => (d ? { ...d, image: url } : d));
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo subir la foto.");
    }
    setBusy("");
  }

  function generateCode() {
    if (!draft) return;
    const all = products.flatMap(codesOf);
    setDraft({ ...draft, barcode: generateInternalBarcode(all) });
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const m = draft ? margin({ price: Number(draft.price), cost: Number(draft.cost) }) : null;
  const unit = draft ? unitOf(draft) : "pza";
  const isNew = draft ? !products.some((p) => p.id === draft.id) : false;

  return (
    <div>
      {/* Lector: con el cursor aquí, escanear busca el artículo o abre uno nuevo con ese código */}
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-3xl border border-orange-500/40 bg-orange-500/5 p-4">
        <span className="text-3xl">📷</span>
        <input
          ref={scanRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onScan()}
          placeholder="Escanea un código de barras o busca por nombre"
          className={`${input} min-w-0 flex-1 text-lg`}
        />
        <button onClick={() => newArticle()} className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black hover:bg-orange-400">
          + Artículo nuevo
        </button>
        <button onClick={() => setImporting(true)} className="rounded-2xl border border-zinc-700 px-4 py-3 font-black text-zinc-200 hover:border-orange-500">
          📥 Excel
        </button>
        <button
          onClick={() => setLabels(visible.filter((p) => p.barcode))}
          className="rounded-2xl border border-zinc-700 px-4 py-3 font-black text-zinc-200 hover:border-orange-500"
          title="Etiquetas de precio con código de barras de los artículos de la lista"
        >
          🏷️ Etiquetas
        </button>
        {busy && <span className="w-full text-sm text-orange-300">{busy}</span>}
        <p className="w-full text-xs text-zinc-500">
          Con el lector conectado: pon el cursor aquí y escanea. Si el artículo ya existe se abre; si no, se da de alta con ese código y B-POS
          busca su nombre y foto.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[400px_1fr]">
        <section className="flex max-h-[75vh] flex-col rounded-3xl border border-zinc-800 bg-zinc-950 p-5 xl:sticky xl:top-36">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black text-orange-500">Artículos ({products.filter((p) => !p.notSoldAlone).length})</h2>
            {lowCount > 0 && (
              <button onClick={() => setOnlyLow(!onlyLow)} className={`rounded-xl px-3 py-1 text-xs font-black ${onlyLow ? "bg-red-500 text-white" : "border border-red-500/60 text-red-300"}`}>
                ⚠️ {lowCount} por acabarse
              </button>
            )}
          </div>
          <div className="bpos-scroll mt-3 flex gap-2 overflow-x-auto pb-1">
            {["", ...categories].map((c) => (
              <button key={c || "todas"} onClick={() => setCategory(c)} className={`shrink-0 rounded-xl border px-3 py-1.5 text-xs font-black ${category === c ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 text-zinc-300"}`}>
                {c || "Todas"}
              </button>
            ))}
          </div>
          <div className="bpos-scroll mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
            {visible.length === 0 && <p className="p-4 text-center text-sm text-zinc-500">No hay artículos{query ? " con esa búsqueda" : ""}.</p>}
            {visible.map((p) => {
              const item = stockOf(p, ingredients);
              return (
                <button
                  key={p.id}
                  onClick={() => select(p)}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left ${draft?.id === p.id ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 bg-black hover:border-zinc-600"}`}
                >
                  {p.image ? <img src={p.image} alt="" className="h-10 w-10 rounded-xl object-cover" /> : <span className="text-2xl">{p.emoji}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-black">{p.name}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {p.category}
                      {p.barcode ? ` · ${p.barcode}` : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-black text-orange-400">
                      {money(p.price)}
                      {isBulk(p) ? `/${unitShort(p.unit)}` : ""}
                    </span>
                    {item && <span className={`block text-xs ${isLow(p) ? "font-black text-red-400" : "text-zinc-500"}`}>{formatQty(Number(item.stock), unitOf(p))}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section id="ficha-articulo" className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          {!draft ? (
            <div className="p-10 text-center text-zinc-500">
              <p className="text-5xl">🏷️</p>
              <p className="mt-3">Escanea un artículo o elige uno de la lista.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                {draft.image ? <img src={draft.image} alt="" className="h-20 w-20 rounded-2xl object-cover" /> : <span className="text-6xl">{draft.emoji}</span>}
                <div>
                  <p className="text-xs font-black uppercase text-zinc-500">{isNew ? "Artículo nuevo" : "Artículo"}</p>
                  <h2 className="text-3xl font-black">{draft.name || "Sin nombre"}</h2>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="md:col-span-2">
                  <span className={labelCls}>Código de barras</span>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={draft.barcode || ""}
                      onChange={(e) => set({ barcode: e.target.value.replace(/\s+/g, "") })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (draft.barcode) void fillFromBarcode(draft.barcode, draft.id);
                        }
                      }}
                      placeholder="Escanéalo aquí con el lector"
                      inputMode="numeric"
                      className={`${input} min-w-0 flex-1 font-mono text-lg`}
                    />
                    <button type="button" disabled={!draft.barcode} onClick={() => draft.barcode && fillFromBarcode(draft.barcode, draft.id)} className="rounded-2xl border border-zinc-700 px-4 font-black text-zinc-200 disabled:opacity-40">
                      🔎 Buscar datos
                    </button>
                    <button type="button" onClick={generateCode} className="rounded-2xl border border-zinc-700 px-4 font-black text-zinc-200" title="Para lo que no trae código (a granel, hecho aquí)">
                      ➕ Crear código
                    </button>
                  </div>
                </label>
                <label className="md:col-span-2">
                  <span className={labelCls}>Nombre</span>
                  <input value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} className={input} placeholder={type === "ferreteria" ? "Ej. Tornillo 1/4 x 2" : "Ej. Coca-Cola 600 ml"} />
                </label>
                <label>
                  <span className={labelCls}>Categoría</span>
                  <input value={draft.category} onChange={(e) => set({ category: e.target.value })} list="categorias-articulos" maxLength={40} className={input} placeholder="Abarrotes, Carnicería, Varios..." />
                  <datalist id="categorias-articulos">
                    {suggestions.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </label>
                <div>
                  <span className={labelCls}>Se vende por</span>
                  <div className="flex gap-2">
                    <select
                      value={draft.sellBy === "granel" ? unit : "pza"}
                      onChange={(e) => {
                        const u = e.target.value as RetailUnit;
                        set({ unit: u, sellBy: u === "pza" ? "pieza" : "granel" });
                      }}
                      className={input}
                    >
                      {RETAIL_UNITS.map((u) => (
                        <option key={u.value} value={u.value}>
                          {u.value === "pza" ? "Pieza" : `A granel · por ${u.label.toLowerCase()}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  {draft.sellBy === "granel" && <span className="mt-1 block text-xs text-zinc-500">Al venderlo, la caja pregunta cuánto (ej. 250 g o $20).</span>}
                </div>
                <label>
                  <span className={labelCls}>Precio{draft.sellBy === "granel" ? ` por ${unitShort(unit)}` : ""}</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.price}
                    disabled={draft.openPrice}
                    onChange={(e) => set({ price: Number(e.target.value) })}
                    className={`${input} text-xl font-black`}
                  />
                </label>
                <label>
                  <span className={labelCls}>Costo{draft.sellBy === "granel" ? ` por ${unitShort(unit)}` : ""} (lo que te cuesta)</span>
                  <input type="number" min={0} step="0.01" value={draft.cost ?? ""} onChange={(e) => set({ cost: e.target.value === "" ? undefined : Number(e.target.value) })} className={input} />
                  {m && (
                    <span className={`mt-1 block text-xs font-bold ${m.profit > 0 ? "text-green-400" : "text-red-400"}`}>
                      Ganas {money(m.profit)} ({m.percent}%)
                    </span>
                  )}
                </label>
              </div>

              {!draft.openPrice && (
                <div className="rounded-2xl border border-zinc-800 bg-black p-4">
                  <p className="font-black">📦 Existencias</p>
                  <label className="mt-2 flex items-center gap-2 text-sm text-zinc-300">
                    <input type="checkbox" checked={!draft.noStock} onChange={(e) => set({ noStock: !e.target.checked })} />
                    Llevar existencias (cada venta descuenta y cada compra suma)
                  </label>
                  {!draft.noStock && (
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      <label>
                        <span className={labelCls}>Hay ahora ({unitShort(unit)})</span>
                        <input type="number" step="any" value={draft.stockText} onChange={(e) => set({ stockText: e.target.value })} className={`${input} text-xl font-black`} />
                      </label>
                      <label>
                        <span className={labelCls}>Avisar cuando queden ({unitShort(unit)})</span>
                        <input type="number" min={0} step="any" value={draft.minimumText} onChange={(e) => set({ minimumText: e.target.value })} placeholder="Ej. 6" className={input} />
                      </label>
                    </div>
                  )}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-zinc-800 bg-black p-4">
                  <p className="font-black">💼 Mayoreo (opcional)</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label>
                      <span className="text-xs text-zinc-500">Desde ({unitShort(unit)})</span>
                      <input type="number" min={0} step="any" value={draft.wholesale?.minQty ?? ""} onChange={(e) => set({ wholesale: { minQty: Number(e.target.value) || 0, price: draft.wholesale?.price || 0 } })} placeholder="12" className={input} />
                    </label>
                    <label>
                      <span className="text-xs text-zinc-500">Precio c/u</span>
                      <input type="number" min={0} step="0.01" value={draft.wholesale?.price ?? ""} onChange={(e) => set({ wholesale: { minQty: draft.wholesale?.minQty || 0, price: Number(e.target.value) || 0 } })} placeholder="15.50" className={input} />
                    </label>
                  </div>
                </div>
                <label className="rounded-2xl border border-zinc-800 bg-black p-4">
                  <span className="font-black">🚚 Proveedor</span>
                  <input value={draft.supplier || ""} onChange={(e) => set({ supplier: e.target.value })} list="proveedores-articulos" maxLength={60} placeholder="Ej. Coca-Cola FEMSA" className={`${input} mt-2`} />
                  <datalist id="proveedores-articulos">
                    {suppliers.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                  <span className="mt-1 block text-xs text-zinc-500">Para armar el pedido sugerido por proveedor.</span>
                </label>
              </div>

              <details className="rounded-2xl border border-zinc-800 bg-black p-4">
                <summary className="cursor-pointer font-black">Más opciones</summary>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="md:col-span-2">
                    <span className={labelCls}>Otros códigos del mismo artículo (separados por coma)</span>
                    <input value={draft.extraCodesText} onChange={(e) => set({ extraCodesText: e.target.value })} className={`${input} font-mono`} />
                  </label>
                  <label className="flex items-start gap-2 text-sm text-zinc-300 md:col-span-2">
                    <input type="checkbox" className="mt-1" checked={Boolean(draft.openPrice)} onChange={(e) => set({ openPrice: e.target.checked, ...(e.target.checked ? { noStock: true } : {}) })} />
                    <span>
                      <b>Precio libre</b> (ej. &quot;Varios&quot;): al venderlo se escribe el importe. No lleva existencias.
                    </span>
                  </label>
                  <label>
                    <span className={labelCls}>Ícono</span>
                    <input value={draft.emoji} onChange={(e) => set({ emoji: e.target.value })} maxLength={4} className={input} />
                  </label>
                  <div>
                    <span className={labelCls}>Foto (menú digital)</span>
                    <div className="flex flex-wrap gap-2">
                      <label className="cursor-pointer rounded-2xl border border-orange-500 px-4 py-3 text-sm font-black text-orange-300">
                        Subir
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadPhoto(e.target.files?.[0])} />
                      </label>
                      <button type="button" onClick={() => setPicking(true)} className="rounded-2xl border border-zinc-700 px-4 py-3 text-sm font-black">
                        Galería
                      </button>
                      {draft.image && (
                        <button type="button" onClick={() => set({ image: undefined })} className="rounded-2xl border border-zinc-700 px-4 py-3 text-sm font-black text-zinc-400">
                          Quitar
                        </button>
                      )}
                    </div>
                  </div>
                  <label className="md:col-span-2">
                    <span className={labelCls}>Descripción (menú digital)</span>
                    <input value={draft.description || ""} onChange={(e) => set({ description: e.target.value })} maxLength={200} className={input} />
                  </label>
                </div>
              </details>

              <div className="flex flex-wrap gap-3">
                <button onClick={save} className="flex-1 rounded-2xl bg-orange-500 py-4 text-lg font-black text-black hover:bg-orange-400">
                  Guardar
                </button>
                {draft.barcode && !isNew && (
                  <button onClick={() => setLabels([draft])} className="rounded-2xl border border-zinc-700 px-5 font-black">
                    🏷️ Etiqueta
                  </button>
                )}
                {canDelete && !isNew && (
                  <button onClick={remove} className="rounded-2xl border border-red-500/60 px-5 font-black text-red-300">
                    Eliminar
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {picking && draft && (
        <GalleryPicker
          current={draft.image}
          onPick={(url) => {
            set({ image: url });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {labels && <BarcodeLabels items={labels.filter((p) => p.barcode).map((p) => ({ name: p.name, price: p.price, barcode: p.barcode! }))} onClose={() => setLabels(null)} />}
      {importing && (
        <RetailImportModal
          products={getAdminProducts()}
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            setProducts(getAdminProducts());
            setIngredients(getAdminIngredients());
          }}
        />
      )}
    </div>
  );
}

function RetailImportModal({ products, onClose, onDone }: { products: Product[]; onClose: () => void; onDone: () => void }) {
  const [lines, setLines] = useState<RetailPlanned[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const rows = await readSpreadsheet(file);
      if (rows.length > 5001) throw new Error("Máximo 5,000 artículos por archivo.");
      const plan = planRetailImport(rows, products);
      if (plan.error) throw new Error(plan.error);
      setLines(plan.lines);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo.");
    }
    setBusy(false);
  }

  const toSave = (lines || []).filter((l) => l.product && (l.status === "nuevo" || l.status === "cambia"));
  const count = (s: RetailPlanned["status"]) => (lines || []).filter((l) => l.status === s).length;

  function confirmImport() {
    const byId = new Map<number, Product>();
    const edits = new Map<number, { stock?: number; minimum?: number }>();
    for (const l of toSave) {
      byId.set(l.product!.id, l.product!);
      if (l.stock !== undefined || l.minimum !== undefined) edits.set(l.product!.id, { ...edits.get(l.product!.id), ...(l.stock !== undefined ? { stock: l.stock } : {}), ...(l.minimum !== undefined ? { minimum: l.minimum } : {}) });
    }
    const current = getAdminProducts();
    const next = [...current.map((p) => byId.get(p.id) || p), ...[...byId.values()].filter((p) => !current.some((c) => c.id === p.id))];
    const { products: synced, stockChanges } = syncStockItems(next, edits);
    saveAdminProducts(synced);
    for (const c of stockChanges) recordStockEdit(c.ingredient, c.previous, "Importado de Excel");
    const user = getSessionUser();
    addAuditEvent({ category: "Productos", action: "products.import", description: `${user?.name || "Usuario"} importó artículos de Excel: ${count("nuevo")} nuevo(s) y ${count("cambia")} actualizado(s)`, userName: user?.name });
    alert(`Listo: ${count("nuevo")} nuevo(s) y ${count("cambia")} actualizado(s).`);
    onDone();
  }

  const template = () =>
    downloadXlsx("plantilla-articulos-bpos", [
      {
        name: "Artículos",
        rows: [RETAIL_HEADERS, ["7501055300075", "Coca-Cola 355 ml", 18, 12.5, "Bebidas", 24, 6, "pza", "Coca-Cola FEMSA", 16, 12], ["", "Jitomate", 32, 22, "Frutas y verduras", 10, 2, "kg", "", "", ""]],
      },
    ]);
  const exportCurrent = () => {
    const ingredients = getAdminIngredients();
    downloadXlsx("articulos-bpos", [
      {
        name: "Artículos",
        rows: [
          RETAIL_HEADERS,
          ...products
            .filter((p) => !p.notSoldAlone)
            .map((p) => {
              const item = stockOf(p, ingredients);
              return [p.barcode || "", p.name, p.price, p.cost ?? "", p.category, item ? item.stock : "", item ? item.minimum : "", unitOf(p), p.supplier || "", p.wholesale?.price ?? "", p.wholesale?.minQty ?? ""];
            }),
        ],
      },
    ]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-black text-orange-500">Subir artículos desde Excel</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Columnas: Código, Nombre, Precio, Costo, Categoría, Existencia, Mínimo, Unidad (pza, kg, L, m), Proveedor, Precio mayoreo, Mayoreo desde.
          Solo Nombre y Precio son obligatorias. Si el código o el nombre ya existe, se actualiza.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <label className="cursor-pointer rounded-2xl bg-orange-500 px-5 py-3 font-black text-black">
            {busy ? "Leyendo..." : "Elegir archivo"}
            <input type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          <button onClick={template} className="rounded-2xl border border-zinc-700 px-4 py-3 font-black">
            Plantilla
          </button>
          <button onClick={exportCurrent} className="rounded-2xl border border-zinc-700 px-4 py-3 font-black">
            Descargar los míos
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {lines && (
          <>
            <p className="mt-4 text-sm font-black">
              {count("nuevo")} nuevo(s) · {count("cambia")} cambian · {count("igual")} igual · {count("error")} con error
            </p>
            <div className="bpos-scroll mt-2 flex-1 space-y-1 overflow-y-auto">
              {lines.map((l) => (
                <p key={l.line} className={`rounded-xl px-3 py-2 text-sm ${l.status === "error" ? "bg-red-500/10 text-red-300" : l.status === "igual" ? "text-zinc-500" : "bg-zinc-900"}`}>
                  Renglón {l.line}: <b>{l.name}</b> · {l.status} · {l.detail}
                  {l.stock !== undefined ? ` · hay ${l.stock}` : ""}
                </p>
              ))}
            </div>
          </>
        )}
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-2xl border border-zinc-800 py-3 font-black">
            Cancelar
          </button>
          <button disabled={!toSave.length} onClick={confirmImport} className="flex-1 rounded-2xl bg-orange-500 py-3 font-black text-black disabled:opacity-40">
            Guardar {toSave.length || ""}
          </button>
        </div>
      </div>
    </div>
  );
}
