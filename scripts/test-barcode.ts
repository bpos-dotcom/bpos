/**
 * Códigos de barras: dígito de control, códigos internos y SVG de etiquetas.
 *   npx tsx scripts/test-barcode.ts
 */
export {};

import { eanCheckDigit, generateInternalBarcode, isValidEan, normalizeBarcode } from "../lib/barcode-lookup";
import { barcodeSvg, code128Checksum, code128Modules, code128Svg, ean13Modules, ean13Svg } from "../lib/barcode-svg";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

// isValidEan
check("EAN-13 Coca-Cola México válido", isValidEan("7501055300075"));
check("EAN-13 Coca-Cola Europa válido", isValidEan("5449000000996"));
check("EAN-13 con dígito malo", !isValidEan("7501055300076"));
check("EAN-8 válido", isValidEan("96385074"));
check("EAN-8 malo", !isValidEan("96385075"));
check("UPC-A válido", isValidEan("036000291452"));
check("UPC-A malo", !isValidEan("036000291453"));
check("GTIN-14 válido", isValidEan("17501055300072"));
check("letras no", !isValidEan("75010553000A5"));
check("largo raro no", !isValidEan("1234567"));
check("con espacios se limpia", isValidEan(" 7501055 300075\n"));
check("normalizeBarcode", normalizeBarcode("  750 1055\t300075 ") === "7501055300075");
check("eanCheckDigit", eanCheckDigit("750105530007") === 5);

// generateInternalBarcode
const first = generateInternalBarcode([]);
check("interno empieza con 20 y es EAN-13", /^20\d{11}$/.test(first), first);
check("interno con dígito de control correcto", isValidEan(first), first);
const existing = [first, "7501055300075"];
const codes = new Set(existing);
let allValid = true;
for (let i = 0; i < 200; i++) {
  const c = generateInternalBarcode([...codes]);
  if (codes.has(c) || !isValidEan(c) || !c.startsWith("20")) allValid = false;
  codes.add(c);
}
check("200 internos seguidos: únicos y válidos", allValid && codes.size === 202);
const high = "2000000005003"; // 20 0000000500 + 3
check("el código alto de ejemplo es válido", isValidEan(high));
const afterHigh = generateInternalBarcode([high]);
check("sigue al más alto", afterHigh.startsWith("200000000501") && isValidEan(afterHigh), afterHigh);

// Code 128 B
check("checksum Code128 'PJJ123C' = 55", code128Checksum("PJJ123C") === 55, code128Checksum("PJJ123C"));
// 104 + 33×1 + 34×2 + 35×3 = 310 → 310 mod 103 = 1
check("checksum Code128 'ABC' = 1", code128Checksum("ABC") === 1, code128Checksum("ABC"));
const m = code128Modules("PJJ123C");
// inicio + 7 datos + control = 9 símbolos × 11 + parada 13
check("Code128 largo en módulos", m.length === 9 * 11 + 13, m.length);
check("Code128 empieza con Start B y termina con Stop", m.startsWith("11010010000") && m.endsWith("1100011101011"));
const svg128 = code128Svg("ABC-123", { height: 40, moduleWidth: 1 });
check("Code128 SVG", svg128.startsWith("<svg") && svg128.includes('height="40"'));

// EAN-13
const ean = ean13Modules("7501055300075");
check("EAN-13 95 módulos", ean?.modules.length === 95, ean?.modules.length);
const svg13 = ean13Svg("7501055300075")!;
const bars = (svg13.match(/<rect x=/g) || []).length;
check("EAN-13 SVG tiene 30 barras", bars === 30, bars);
check("EAN-13 inválido → null", ean13Svg("7501055300076") === null);
check("barcodeSvg elige EAN-13 si es válido", barcodeSvg("7501055300075") === svg13);
check("barcodeSvg usa Code128 si no", barcodeSvg("ABC-1") === code128Svg("ABC-1"));
// 5449000000996 empieza con 5 → paridad LGGLLG: segundo dígito (4) en L = 0100011
check("EAN-13 paridad del primer dígito", ean13Modules("5449000000996")?.modules.slice(3, 10) === "0100011");

console.log(`\n${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
