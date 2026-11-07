/**
 * Resumen de un reporte (hoja de Excel o CSV) para el Asesor con IA: en lugar
 * de mandar miles de renglones, se mandan los encabezados, cuántos renglones
 * hay, la suma, mínimo, máximo y promedio de las columnas con números, el
 * rango de las fechas, los valores que más se repiten de las de texto y unos
 * renglones de muestra. Así la IA entiende reportes de DiDi, Uber, Rappi o de
 * cualquier punto de venta sin gastar de más. Sin dependencias del navegador.
 */
export type ColumnSummary = {
  columna: string;
  tipo: "numero" | "fecha" | "texto";
  llenos: number;
  suma?: number;
  minimo?: number | string;
  maximo?: number | string;
  promedio?: number;
  masComunes?: { valor: string; veces: number }[];
  /** Texto: lo que suma cada valor en la columna de dinero principal (ej. venta por producto) */
  porMonto?: { valor: string; monto: number }[];
};

export type SheetSummary = { archivo: string; hoja: string; renglones: number; columnas: ColumnSummary[]; muestra: Record<string, string>[] };

const MAX_COLUMNS = 30;
const SAMPLE_ROWS = 8;

/** "$1,234.50", "1.234,50", "-30%", "(45.00)" → número; null si no es número */
export function toNumber(raw: string): number | null {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 25) return null;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/^[^\d-]+/, ""));
  const digits = s.replace(/[^\d.,]/g, "");
  if (!/\d/.test(digits) || /[a-z]{3,}/i.test(s.replace(/mxn|usd|mx\$/gi, ""))) return null;
  const decimalComma = /,\d{1,2}$/.test(digits) && !/\.\d{1,2}$/.test(digits);
  const n = Number(decimalComma ? digits.replace(/\./g, "").replace(",", ".") : digits.replace(/,/g, ""));
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

/** Fecha de un texto ("2026-11-03", "03/11/2026", "3/11/26 14:05") o número de serie de Excel → "AAAA-MM-DD" */
export function toDate(raw: string, header = ""): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; // México: día/mes/año
  }
  // Excel guarda fechas como número de días desde 1899-12-30 (solo si el encabezado dice fecha)
  const n = Number(s);
  if (/fecha|date|dia|día/i.test(header) && Number.isFinite(n) && n > 30000 && n < 80000) return new Date(Math.round((n - 25569) * 86_400_000)).toISOString().slice(0, 10);
  return null;
}

/** Renglón de encabezados: entre los primeros 10, el que tiene más celdas de texto (no números) */
export function headerRow(rows: string[][]) {
  let best = { index: 0, score: -1 };
  rows.slice(0, 10).forEach((row, index) => {
    const score = row.filter((c) => c && toNumber(c) === null).length;
    if (score > best.score) best = { index, score };
  });
  return best.index;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function summarizeSheet(archivo: string, hoja: string, rows: string[][]): SheetSummary {
  const h = headerRow(rows);
  const header = (rows[h] || []).map((c, i) => c || `Columna ${i + 1}`);
  const body = rows.slice(h + 1).filter((r) => r.some(Boolean));
  const columnas: ColumnSummary[] = header.slice(0, MAX_COLUMNS).map((name, col) => {
    const values = body.map((r) => String(r[col] ?? "").trim()).filter(Boolean);
    const numbers = values.map(toNumber).filter((n): n is number => n !== null);
    const dates = values.map((v) => toDate(v, name)).filter((d): d is string => d !== null);
    if (dates.length >= values.length * 0.8 && dates.length > 0) {
      const sorted = [...dates].sort();
      return { columna: name, tipo: "fecha", llenos: values.length, minimo: sorted[0], maximo: sorted[sorted.length - 1] };
    }
    if (numbers.length >= values.length * 0.8 && numbers.length > 0) {
      const suma = numbers.reduce((a, b) => a + b, 0);
      return { columna: name, tipo: "numero", llenos: values.length, suma: round(suma), minimo: round(Math.min(...numbers)), maximo: round(Math.max(...numbers)), promedio: round(suma / numbers.length) };
    }
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v.slice(0, 60), (counts.get(v.slice(0, 60)) || 0) + 1);
    const masComunes = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([valor, veces]) => ({ valor, veces }));
    return { columna: name, tipo: "texto", llenos: values.length, masComunes };
  });
  // Columna de dinero principal (total, importe, venta...): con ella, cuánto suma cada producto, día o app
  const money = columnas
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.tipo === "numero" && /total|importe|venta|monto|subtotal|precio|pagado/i.test(c.columna))
    .sort((a, b) => Math.abs(b.c.suma || 0) - Math.abs(a.c.suma || 0))[0];
  if (money) {
    columnas.forEach((c, col) => {
      if (c.tipo !== "texto" || col === money.i) return;
      const sums = new Map<string, number>();
      for (const r of body) {
        const key = String(r[col] ?? "").trim().slice(0, 60);
        const n = toNumber(String(r[money.i] ?? ""));
        if (key && n !== null) sums.set(key, (sums.get(key) || 0) + n);
      }
      if (sums.size > 1 && sums.size <= 500) c.porMonto = [...sums.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([valor, monto]) => ({ valor, monto: round(monto) }));
    });
  }
  const muestra = body.slice(0, SAMPLE_ROWS).map((r) => Object.fromEntries(header.slice(0, MAX_COLUMNS).map((name, i) => [name, String(r[i] ?? "").slice(0, 60)]).filter(([, v]) => v)));
  return { archivo, hoja, renglones: body.length, columnas, muestra };
}
