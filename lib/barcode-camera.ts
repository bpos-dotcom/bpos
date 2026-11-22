/**
 * Lo que lee la cámara se limpia antes de usarlo: sin espacios ni saltos de
 * línea, y los códigos de producto (EAN-13, EAN-8, UPC-A) solo si su dígito
 * de control cuadra, para no agregar un artículo equivocado por una lectura
 * borrosa. "" = no sirve, se sigue leyendo.
 */
export function cleanScannedCode(raw: unknown) {
  const code = String(raw ?? "").replace(/\s+/g, "").trim();
  if (code.length < 4 || code.length > 40) return "";
  if (/^\d+$/.test(code) && [8, 12, 13].includes(code.length) && !validCheckDigit(code)) return "";
  return code;
}

/** Dígito de control de EAN-8, UPC-A (12) y EAN-13 */
export function validCheckDigit(code: string) {
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  // De derecha a izquierda: el primero pesa 3, el siguiente 1, y así
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
