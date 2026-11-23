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

  // Mudanza a la nube de Cloudflare (22 nov 2026): la llave de servidor cambia,
  // pero las claves guardadas con la de Supabase se siguen leyendo
  const env = process.env as Record<string, string | undefined>;
  const reset = () => { for (const k of ["BPOS_SECRETS_KEY", "SUPABASE_ORIGINAL_SERVICE_ROLE_KEY", "SOURCE_SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) delete env[k]; };
  reset();
  env.SUPABASE_SERVICE_ROLE_KEY = "llave-supabase";
  const old = { provider: "gemini" as const, key_cipher: s.encryptKey(JSON.stringify({ gemini: "gem-5678" })) };
  reset();
  env.SUPABASE_SERVICE_ROLE_KEY = "llave-nube";
  env.SUPABASE_ORIGINAL_SERVICE_ROLE_KEY = "llave-supabase";
  check("www con la nube: lee las guardadas con Supabase", s.readKeys(old).gemini === "gem-5678", s.readKeys(old));
  const fromWww = { provider: "gemini" as const, key_cipher: s.encryptKey(JSON.stringify({ gemini: "gem-9999" })) };
  reset();
  env.SUPABASE_SERVICE_ROLE_KEY = "llave-nube";
  env.SOURCE_SUPABASE_SERVICE_KEY = "llave-supabase";
  check("bpos-nube: lee las guardadas con Supabase", s.readKeys(old).gemini === "gem-5678", s.readKeys(old));
  check("bpos-nube: lee las que se guardaron en www", s.readKeys(fromWww).gemini === "gem-9999", s.readKeys(fromWww));
  const fromNube = { provider: "gemini" as const, key_cipher: s.encryptKey(JSON.stringify({ gemini: "gem-1111" })) };
  reset();
  env.SUPABASE_SERVICE_ROLE_KEY = "llave-supabase";
  check("de regreso a Supabase: lee las que se guardaron en la nube", s.readKeys(fromNube).gemini === "gem-1111", s.readKeys(fromNube));
  check("sin llaves repetidas ni vacías", JSON.stringify(s.secretBases({ BPOS_SECRETS_KEY: " ", SOURCE_SUPABASE_SERVICE_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "a" })) === '["a"]');

  console.log(`\n${ok} bien, ${bad} mal`);
  if (bad) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
