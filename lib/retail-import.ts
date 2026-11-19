/**
 * Tienda: subir el catálogo desde Excel o CSV. Columnas (en cualquier orden,
 * con o sin acentos): Código, Nombre, Precio, Costo, Categoría, Existencia,
 * Mínimo, Unidad, Proveedor, Precio mayoreo, Mayoreo desde.
 * Se reconoce un artículo por su código y, sin código, por su nombre.
 */
import type { Product, RetailUnit } from "@/data/products";

export const RETAIL_HEADERS = ["Código", "Nombre", "Precio", "Costo", "Categoría", "Existencia", "Mínimo", "Unidad", "Proveedor", "Precio mayoreo", "Mayoreo desde"];

type Field = "code" | "name" | "price" | "cost" | "category" | "stock" | "minimum" | "unit" | "supplier" | "wholesalePrice" | "wholesaleMin";

const plain = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const HEADER_FIELD: [RegExp, Field][] = [
  [/^(codigo|codigo de barras|clave|sku|ean|upc|barcode)$/, "code"],
  [/^(nombre|articulo|producto|descripcion)$/, "name"],
  [/^(precio mayoreo|mayoreo)$/, "wholesalePrice"],
  [/^(mayoreo desde|cantidad mayoreo|desde)$/, "wholesaleMin"],
  [/^(precio|precio venta|precio publico|pv)$/, "price"],
  [/^(costo|precio compra|costo unitario)$/, "cost"],
  [/^(categoria|departamento|linea|familia)$/, "category"],
  [/^(existencia|existencias|stock|inventario|cantidad)$/, "stock"],
  [/^(minimo|stock minimo|existencia minima)$/, "minimum"],
  [/^(unidad|unidad de medida|um)$/, "unit"],
  [/^(proveedor)$/, "supplier"],
];

export function unitFromText(text: string): { unit: RetailUnit; bulk: boolean } | null {
  const t = plain(text).replace(/\./g, "");
  if (!t) return null;
  if (/^(pza|pz|pieza|piezas|unidad|u|und|caja|paquete)$/.test(t)) return { unit: "pza", bulk: false };
  if (/^(kg|kilo|kilos|kilogramo|kilogramos)$/.test(t)) return { unit: "kg", bulk: true };
  if (/^(g|gr|gramo|gramos)$/.test(t)) return { unit: "g", bulk: true };
  if (/^(l|lt|lts|litro|litros)$/.test(t)) return { unit: "L", bulk: true };
  if (/^(m|mt|mts|metro|metros)$/.test(t)) return { unit: "m", bulk: true };
  return null;
}

const num = (text: string) => {
  const clean = String(text || "").replace(/[$,\s]/g, "");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
};

export type RetailPlanned = {
  line: number;
  name: string;
  status: "nuevo" | "cambia" | "igual" | "error";
  detail: string;
  product?: Product;
  stock?: number;
  minimum?: number;
};

/** Lo que haría el archivo (no cambia nada hasta confirmar) */
export function planRetailImport(rows: string[][], catalog: Product[], { firstId = Date.now() }: { firstId?: number } = {}) {
  const headerIndex = rows.findIndex((r) => r.some((c) => HEADER_FIELD.some(([re, f]) => f === "name" && re.test(plain(c)))));
  if (headerIndex < 0) return { lines: [] as RetailPlanned[], error: 'No encontré la columna "Nombre". Usa la plantilla.' };
  const header = rows[headerIndex].map(plain);
  const col = new Map<Field, number>();
  header.forEach((h, i) => {
    const hit = HEADER_FIELD.find(([re]) => re.test(h));
    if (hit && !col.has(hit[1])) col.set(hit[1], i);
  });
  const get = (row: string[], f: Field) => (col.has(f) ? String(row[col.get(f)!] ?? "").trim() : "");
  let nextId = firstId;
  const byCode = new Map<string, Product>();
  const byName = new Map<string, Product>();
  for (const p of catalog) {
    if (p.barcode) byCode.set(p.barcode, p);
    for (const c of p.extraBarcodes || []) byCode.set(c, p);
    byName.set(plain(p.name), p);
  }
  const lines: RetailPlanned[] = [];
  rows.slice(headerIndex + 1).forEach((row, i) => {
    const line = headerIndex + i + 2;
    const name = get(row, "name").slice(0, 80);
    const code = get(row, "code").replace(/\s+/g, "").slice(0, 40);
    if (!name && !code) return;
    const price = num(get(row, "price"));
    if (!name) return lines.push({ line, name: code, status: "error", detail: "Falta el nombre" });
    const existing = (code && byCode.get(code)) || byName.get(plain(name));
    if (!existing && (price === null || price < 0)) return lines.push({ line, name, status: "error", detail: "Falta el precio" });
    const base: Product = existing ? { ...existing } : { id: nextId++, name, category: "Varios", price: price ?? 0, emoji: "🏷️", station: "Cocina", sellBy: "pieza", unit: "pza" };
    const changes: string[] = [];
    const set = <K extends keyof Product>(k: K, v: Product[K], label: string) => {
      if (v === undefined || v === "" || base[k] === v) return;
      base[k] = v;
      if (existing) changes.push(label);
    };
    set("name", name, "nombre");
    if (price !== null && price >= 0) set("price", Math.round(price * 100) / 100, "precio");
    if (code) set("barcode", code, "código");
    const cost = num(get(row, "cost"));
    if (cost !== null && cost >= 0 && get(row, "cost")) set("cost", Math.round(cost * 100) / 100, "costo");
    const category = get(row, "category").slice(0, 40);
    if (category) set("category", category, "categoría");
    const supplier = get(row, "supplier").slice(0, 60);
    if (supplier) set("supplier", supplier, "proveedor");
    const unit = unitFromText(get(row, "unit"));
    if (unit) {
      set("unit", unit.unit, "unidad");
      set("sellBy", unit.bulk ? "granel" : "pieza", "unidad");
    }
    const wPrice = num(get(row, "wholesalePrice"));
    const wMin = num(get(row, "wholesaleMin"));
    if (wPrice && wPrice > 0 && wMin && wMin > 0 && (base.wholesale?.price !== wPrice || base.wholesale?.minQty !== wMin)) {
      base.wholesale = { price: wPrice, minQty: wMin };
      if (existing) changes.push("mayoreo");
    }
    const stockText = get(row, "stock");
    const minText = get(row, "minimum");
    const stock = stockText ? num(stockText) : null;
    const minimum = minText ? num(minText) : null;
    if (stock !== null || minimum !== null) changes.push("existencias");
    const extra = { ...(stock !== null ? { stock } : {}), ...(minimum !== null ? { minimum } : {}) };
    if (!existing) {
      // Repetido más abajo en el mismo archivo: cuenta como el mismo artículo
      if (base.barcode) byCode.set(base.barcode, base);
      byName.set(plain(base.name), base);
    }
    if (!existing) return lines.push({ line, name, status: "nuevo", detail: `$${base.price}${code ? ` · ${code}` : ""}`, product: base, ...extra });
    if (!changes.length) return lines.push({ line, name, status: "igual", detail: "Sin cambios" });
    lines.push({ line, name, status: "cambia", detail: [...new Set(changes)].join(", "), product: base, ...extra });
  });
  return { lines, error: "" };
}
