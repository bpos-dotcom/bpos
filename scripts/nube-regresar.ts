/**
 * Regreso a Supabase: manda de la nube de Cloudflare a Supabase lo que se
 * vendió y cambió después de la noche del cambio. Después se compila B-POS
 * otra vez con la dirección de Supabase (ver docs/mudanza-cloudflare.md).
 *
 *   npx tsx scripts/nube-regresar.ts https://www.bpos.com.mx <seq-de-la-noche-del-cambio>
 *
 * El número (seq) se apunta la noche del cambio (lo da nube-copiar.ts en "números").
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { COPY_ORDER } from "../nube/migrate";

const base = (process.argv[2] || "").replace(/\/$/, "");
const sinceSeq = Number(process.argv[3] || 0);
if (!/^https:\/\//.test(base)) {
  console.error("Uso: npx tsx scripts/nube-regresar.ts https://<worker> <seq>");
  process.exit(1);
}
const secrets = JSON.parse(readFileSync(join(homedir(), ".bpos", "nube-secretos.json"), "utf8")) as { MUDANZA_KEY: string };

async function step(body: unknown) {
  const res = await fetch(`${base}/sb/_mudanza/regresar`, { method: "POST", headers: { "x-mudanza": secrets.MUDANZA_KEY, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${JSON.stringify(body)} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as { copied: number; done: boolean; next: number };
}

async function main() {
  // Lo que cambia con el uso diario; usuarios, negocios y sucursales nuevos casi no
  const tables = COPY_ORDER.filter((t) => !["bpos_license_keys", "platform_admins"].includes(t));
  for (const table of tables) {
    let offset = 0;
    let total = 0;
    for (;;) {
      const r = await step({ table, offset, sinceSeq, pageSize: table === "bpos_backups" ? 1 : 200 });
      total += r.copied;
      offset = r.next;
      if (r.done) break;
    }
    console.log(`${table}: ${total}`);
  }
  console.log("Listo. Ahora compila B-POS con la dirección de Supabase.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
