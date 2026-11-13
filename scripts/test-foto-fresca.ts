/**
 * Fotos de evidencia: solo las recién tomadas (no de la galería).
 *   npx tsx scripts/test-foto-fresca.ts
 */
import { FRESH_PHOTO_MS, isFreshPhoto } from "@/lib/fresh-photo";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}`);
};

const now = new Date(2026, 10, 12, 14, 0).getTime();
check("recién tomada con la cámara: sí", isFreshPhoto({ lastModified: now - 5_000 }, now));
check("de hace 2 minutos: sí", isFreshPhoto({ lastModified: now - 2 * 60_000 }, now));
check("de hace 10 minutos (galería): no", !isFreshPhoto({ lastModified: now - 10 * 60_000 }, now));
check("de ayer (galería): no", !isFreshPhoto({ lastModified: now - 24 * 3600_000 }, now));
check("sin fecha: no", !isFreshPhoto({}, now));
check("con fecha del futuro (reloj movido): no", !isFreshPhoto({ lastModified: now + 10 * 60_000 }, now));
check("el límite es de 3 minutos", FRESH_PHOTO_MS === 180_000);

console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
