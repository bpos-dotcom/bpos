/**
 * Lo que lee la cámara: códigos válidos pasan, lecturas borrosas (dígito de
 * control que no cuadra) se ignoran.
 *   npx tsx scripts/test-barcode-camera.ts
 */
import { cleanScannedCode, validCheckDigit } from "../lib/barcode-camera";
import { generateInternalBarcode } from "../lib/barcode-lookup";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

check("EAN-13 de Coca-Cola 600 ml", cleanScannedCode("7501055300075") === "7501055300075");
check("EAN-13 con un dígito mal se ignora", cleanScannedCode("7501055300076") === "");
check("EAN-8 válido", validCheckDigit("96385074") && cleanScannedCode("96385074") === "96385074");
check("UPC-A válido", cleanScannedCode("036000291452") === "036000291452");
check("UPC-A mal se ignora", cleanScannedCode("036000291453") === "");
check("quita espacios y saltos", cleanScannedCode(" 7501055300075\n") === "7501055300075");
check("Code 128 con letras pasa", cleanScannedCode("BP-00123") === "BP-00123");
check("código interno de 10 dígitos pasa (sin dígito de control)", cleanScannedCode("2000000001") === "2000000001");
const internal = generateInternalBarcode([]);
check("el código que crea B-POS (etiquetas) se lee con la cámara", cleanScannedCode(internal) === internal, internal);
check("muy corto no sirve", cleanScannedCode("12") === "");
check("vacío no sirve", cleanScannedCode(undefined) === "");

console.log(`\n${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
