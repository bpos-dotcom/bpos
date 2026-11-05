/**
 * Errores típicos del OCR (tickets de DiDi que llegan como imagen) en la
 * cantidad del renglón: se come el "1" ("x Boneless Dobles MX$245.72") o lo
 * lee como letra ("lx", "Ix", "|x"). Sin número solo se repara si el renglón
 * trae precio, para no confundir texto normal que empiece con "x".
 */
export function fixOcrQuantity(line: string): string {
  const text = String(line ?? "");
  const letterOne = text.match(/^(\s*)[lI|i!]\s*([xX×])\s+(\S.*)$/);
  if (letterOne) return `${letterOne[1]}1${letterOne[2]} ${letterOne[3]}`;
  const noNumber = text.match(/^(\s*)([xX×])\s+(\S.*(?:MX\$|\$)\s*-?\d[\d,]*(?:\.\d{1,2})?\s*(?:MXN)?\s*)$/i);
  if (noNumber) return `${noNumber[1]}1${noNumber[2]} ${noNumber[3]}`;
  return text;
}
