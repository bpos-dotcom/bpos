/**
 * Códigos de barras en SVG para las etiquetas de precio, sin librerías.
 *   ean13Svg("7501055300075")  EAN-13 con barras guía (si el código es válido)
 *   code128Svg("ABC-123")      Code 128 B (cualquier texto ASCII)
 *   barcodeSvg(code)           EAN-13 si se puede; si no, Code 128
 */

export type BarcodeSvgOptions = {
  /** Alto de las barras (unidades del SVG) */
  height?: number;
  /** Ancho de la barra más delgada (unidades del SVG) */
  moduleWidth?: number;
};

// Anchos barra/espacio de los 107 símbolos de Code 128 (0-105) + parada (106)
const CODE128 = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const STOP = 106;

/** Valores Code 128 B del texto (caracteres fuera de ASCII 32-127 → "?") */
export function code128Values(text: string): number[] {
  return [...text].map((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 32 && c <= 127 ? c - 32 : "?".charCodeAt(0) - 32;
  });
}

/** Dígito de control de Code 128 B: (104 + Σ valor × posición) mod 103 */
export function code128Checksum(text: string): number {
  return code128Values(text).reduce((sum, v, i) => sum + v * (i + 1), START_B) % 103;
}

/** Módulos (1 barra, 0 espacio) de Code 128 B: inicio, datos, control, parada */
export function code128Modules(text: string): string {
  const symbols = [START_B, ...code128Values(text), code128Checksum(text), STOP];
  let out = "";
  for (const s of symbols) {
    const widths = CODE128[s];
    for (let i = 0; i < widths.length; i++) out += (i % 2 === 0 ? "1" : "0").repeat(Number(widths[i]));
  }
  return out;
}

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const R = L.map((p) => [...p].map((b) => (b === "1" ? "0" : "1")).join(""));
const G = R.map((p) => [...p].reverse().join(""));
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

const ean13Valid = (code: string) => {
  if (!/^\d{13}$/.test(code)) return false;
  const sum = [...code.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
};

/**
 * Módulos de EAN-13 (95) y qué módulos son barras guía (más largas).
 * null si el código no es un EAN-13 válido.
 */
export function ean13Modules(code: string): { modules: string; guard: boolean[] } | null {
  if (!ean13Valid(code)) return null;
  const d = [...code].map(Number);
  const parity = PARITY[d[0]];
  let modules = "101";
  for (let i = 1; i <= 6; i++) modules += (parity[i - 1] === "L" ? L : G)[d[i]];
  modules += "01010";
  for (let i = 7; i <= 12; i++) modules += R[d[i]];
  modules += "101";
  const guard = [...modules].map((_, i) => i < 3 || (i >= 45 && i < 50) || i >= 92);
  return { modules, guard };
}

function render(modules: string, opts: BarcodeSvgOptions, quiet: number, guard?: boolean[]): string {
  const h = opts.height ?? 60;
  const mw = opts.moduleWidth ?? 2;
  const guardExtra = guard ? Math.round(h * 0.1) : 0;
  const width = (modules.length + quiet * 2) * mw;
  const height = h + guardExtra;
  const rects: string[] = [];
  let i = 0;
  while (i < modules.length) {
    if (modules[i] !== "1") {
      i++;
      continue;
    }
    const isGuard = guard?.[i] ?? false;
    let j = i;
    while (j < modules.length && modules[j] === "1" && (guard?.[j] ?? false) === isGuard) j++;
    rects.push(`<rect x="${(quiet + i) * mw}" y="0" width="${(j - i) * mw}" height="${isGuard ? h + guardExtra : h}"/>`);
    i = j;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none" shape-rendering="crispEdges">` +
    `<rect width="${width}" height="${height}" fill="#fff"/><g fill="#000">${rects.join("")}</g></svg>`
  );
}

/** SVG Code 128 B del texto */
export function code128Svg(text: string, opts: BarcodeSvgOptions = {}): string {
  return render(code128Modules(text), opts, 10);
}

/** SVG EAN-13 con barras guía; null si el código no es un EAN-13 válido */
export function ean13Svg(code: string, opts: BarcodeSvgOptions = {}): string | null {
  const ean = ean13Modules(code);
  return ean ? render(ean.modules, opts, 9, ean.guard) : null;
}

/** EAN-13 si el código es válido; si no, Code 128 B */
export function barcodeSvg(code: string, opts: BarcodeSvgOptions = {}): string {
  return ean13Svg(code, opts) ?? code128Svg(code, opts);
}
