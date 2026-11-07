/**
 * Importar el menú desde un Excel o CSV (Soft Restaurant, otro punto de
 * venta o una hoja hecha a mano): reconoce el renglón de encabezados y qué
 * columna es el nombre, el precio, la categoría y la descripción; el dueño
 * puede corregirlo antes de importar. Sin dependencias del navegador para
 * poder probarlo con archivos de ejemplo.
 *
 * Soft Restaurant exporta su catálogo de productos con columnas como
 * "Clave", "Descripción", "Grupo", "Precio" (o "Precio 1"); otros puntos de
 * venta usan "Producto", "Nombre", "Categoría", "Familia", "Precio venta".
 */
export type ImportField = "name" | "price" | "category" | "description" | "code";

export const IMPORT_FIELDS: { field: ImportField; label: string; required?: boolean }[] = [
  { field: "name", label: "Nombre del producto", required: true },
  { field: "price", label: "Precio", required: true },
  { field: "category", label: "Categoría / grupo" },
  { field: "description", label: "Descripción" },
  { field: "code", label: "Clave (opcional)" },
];

export type ColumnMap = Partial<Record<ImportField, number>>;

const plain = (s: string) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Palabras de cada encabezado, de la más segura a la menos
const HINTS: Record<ImportField, RegExp[]> = {
  name: [/^(nombre|producto|platillo|articulo)( del producto)?$/, /^descripcion( corta)?$/, /^(nombre|producto|platillo|articulo)\b/, /\bnombre\b/],
  price: [/^precio( de)? venta( con iva| con impuesto| neto)?$/, /^precio( 1| publico| con iva| con impuesto| neto)?$/, /^(importe|venta|pvp)$/, /\bprecio\b/],
  category: [/^(grupo|categoria|familia|departamento|seccion|clasificacion)$/, /\b(grupo|categoria|familia|departamento|seccion)\b/],
  description: [/^(descripcion larga|detalle|ingredientes|descripcion del producto)$/, /\b(detalle|ingredientes|descripcion larga)\b/, /^descripcion$/],
  code: [/^(clave|codigo|sku|id|clave producto|codigo de barras)$/, /\b(clave|codigo|sku)\b/],
};

/** Índice del renglón de encabezados: el primero (de los primeros 15) con más encabezados reconocidos */
export function findHeaderRow(rows: string[][]) {
  let best = { index: 0, score: -1 };
  rows.slice(0, 15).forEach((row, index) => {
    const cells = row.map(plain);
    const score = (Object.keys(HINTS) as ImportField[]).filter((f) => cells.some((c) => c && HINTS[f].some((re) => re.test(c)))).length;
    if (score > best.score) best = { index, score };
  });
  return best.index;
}

/** Qué columna parece cada campo (cada columna se usa una sola vez) */
export function guessColumns(header: string[]): ColumnMap {
  const cells = header.map(plain);
  const used = new Set<number>();
  const map: ColumnMap = {};
  // Primero los más claros; "descripción" sola es el nombre en Soft Restaurant, salvo que haya columna "nombre"
  const order: ImportField[] = ["code", "price", "category", "name", "description"];
  for (const field of order) {
    for (const re of HINTS[field]) {
      const i = cells.findIndex((c, idx) => c && !used.has(idx) && re.test(c));
      if (i >= 0) {
        map[field] = i;
        used.add(i);
        break;
      }
    }
  }
  return map;
}

/** "$1,234.50", "1234,50", "MXN 89" → número (null si no es precio) */
export function parsePrice(raw: string): number | null {
  const s = String(raw || "").replace(/[^\d.,-]/g, "");
  if (!s || !/\d/.test(s)) return null;
  const decimalComma = /,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s);
  const n = Number(decimalComma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export type ImportRow = { line: number; name: string; price: number | null; category: string; description: string; code: string; problem?: string };

/** Renglones del archivo como productos (con el problema de cada uno, si lo tiene) */
export function readRows(rows: string[][], headerIndex: number, map: ColumnMap): ImportRow[] {
  const get = (row: string[], f: ImportField) => (map[f] === undefined ? "" : String(row[map[f]!] ?? "").trim());
  return rows
    .slice(headerIndex + 1)
    .map((row, i) => {
      const name = get(row, "name").replace(/\s+/g, " ").slice(0, 80);
      const priceRaw = get(row, "price");
      const price = parsePrice(priceRaw);
      const r: ImportRow = { line: headerIndex + i + 2, name, price, category: get(row, "category").slice(0, 40), description: get(row, "description").slice(0, 300), code: get(row, "code").slice(0, 40) };
      if (!name) r.problem = "Sin nombre";
      else if (price === null) r.problem = priceRaw ? `Precio no válido (${priceRaw})` : "Sin precio";
      return r;
    })
    .filter((r) => r.name || r.price !== null); // renglones vacíos o de totales sin nombre se brincan
}

/** Emoji según la categoría o el nombre (para que el menú no quede sin ícono) */
export function guessEmoji(category: string, name: string) {
  const t = plain(`${category} ${name}`);
  const table: [RegExp, string][] = [
    [/hamburg|burger/, "🍔"],
    [/pizza/, "🍕"],
    [/taco|burrito|quesadilla|gringa/, "🌮"],
    [/alita|boneless|pollo|wings/, "🍗"],
    [/papa|fries|frita/, "🍟"],
    [/hot ?dog|salchicha/, "🌭"],
    [/ensalada|salad/, "🥗"],
    [/sushi|roll/, "🍣"],
    [/cafe|coffee|capuchino|latte|espresso/, "☕"],
    [/cerveza|beer|chela/, "🍺"],
    [/vino|wine/, "🍷"],
    [/coctel|mezcal|tequila|bebida alcoh/, "🍹"],
    [/refresco|soda|agua|bebida|jugo|limonada|malteada|frappe/, "🥤"],
    [/postre|pastel|helado|dulce|pay/, "🍰"],
    [/sopa|caldo|pozole/, "🍲"],
    [/pasta|spaghetti/, "🍝"],
    [/mariscos|camaron|pescado/, "🦐"],
    [/desayuno|huevo|chilaquil|hot ?cake/, "🍳"],
  ];
  return table.find(([re]) => re.test(t))?.[1] || "🍽️";
}
