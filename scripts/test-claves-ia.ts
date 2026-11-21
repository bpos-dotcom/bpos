/**
 * Claves de IA guardadas cifradas: si cambia la llave del servidor (como al
 * pasar de Vercel a Cloudflare el 18 nov 2026) ya no se pueden abrir. Eso
 * debe verse como "vuelve a pegarla", no como "no disponible" sin razón.
 *   npx tsx scripts/test-claves-ia.ts
 */
export {};

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

async function main() {
  const s = await import("../lib/ai/settings");
  process.env.BPOS_SECRETS_KEY = "llave-de-vercel";
  const row = { provider: "openai" as const, key_cipher: s.encryptKey(JSON.stringify({ openai: "sk-prueba-1234" })) };
  check("con la misma llave se lee", s.readKeys(row).openai === "sk-prueba-1234", s.readKeys(row));
  process.env.BPOS_SECRETS_KEY = "llave-de-cloudflare";
  check("con otra llave no se lee (no truena)", !s.readKeys(row).openai, s.readKeys(row));
  const hints = s.readHints({ provider: "openai", key_hint: JSON.stringify({ openai: "…1234" }) });
  const keys = s.readKeys(row);
  const unreadable = Object.keys(hints).filter((p) => !keys[p as keyof typeof keys]);
  check("la clave queda marcada para volver a pegarla", unreadable.length === 1 && unreadable[0] === "openai", unreadable);
  // Al volver a pegarla con la llave nueva, se lee otra vez
  const again = { provider: "openai" as const, key_cipher: s.encryptKey(JSON.stringify({ openai: "sk-prueba-1234" })) };
  check("vuelta a pegar: se lee con la llave nueva", s.readKeys(again).openai === "sk-prueba-1234");

  console.log(`\n${ok} bien, ${bad} mal`);
  if (bad) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
