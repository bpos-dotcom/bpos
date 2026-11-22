/**
 * Copia los datos de Supabase a la nube de Cloudflare llamando a /sb/_mudanza
 * por pedazos: tablas, usuarios, fotos, números y direcciones de fotos.
 * Al final compara cuántas filas quedaron.
 *
 *   npx tsx scripts/nube-copiar.ts https://bpos-nube.maderorecords.workers.dev
 *
 * La llave de la mudanza se lee de ~/.bpos/nube-secretos.json (nunca de git).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { COPY_ORDER } from "../nube/migrate";

const base = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https:\/\//.test(base)) {
  console.error("Uso: npx tsx scripts/nube-copiar.ts https://<worker>");
  process.exit(1);
}
const secrets = JSON.parse(readFileSync(join(homedir(), ".bpos", "nube-secretos.json"), "utf8")) as { MUDANZA_KEY: string };

async function step(name: string, body: unknown) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${base}/sb/_mudanza/${name}`, { method: "POST", headers: { "x-mudanza": secrets.MUDANZA_KEY, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return res.json();
    const text = await res.text();
    if (attempt === 4) throw new Error(`${name} ${JSON.stringify(body)} → ${res.status} ${text.slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
}

async function main() {
  const started = Date.now();
  for (const table of COPY_ORDER) {
    let offset = 0;
    let total = 0;
    for (;;) {
      // sync_records y respaldos traen documentos grandes: páginas más chicas
      const pageSize = table === "bpos_backups" ? 2 : table === "sync_records" ? 200 : 500;
      const r = (await step("tabla", { table, offset, pageSize })) as { copied: number; done: boolean; next: number };
      total += r.copied;
      offset = r.next;
      if (r.done) break;
    }
    console.log(`${table}: ${total}`);
  }
  let offset = 0;
  let users = 0;
  for (;;) {
    const r = (await step("usuarios", { offset })) as { copied: number; done: boolean; next: number };
    users += r.copied;
    offset = r.next;
    if (r.done) break;
  }
  console.log(`usuarios: ${users}`);
  const queue = [""];
  let photos = 0;
  while (queue.length) {
    const r = (await step("fotos", { prefix: queue.shift() })) as { copied: number; folders: string[] };
    photos += r.copied;
    queue.push(...r.folders);
  }
  console.log(`fotos: ${photos}`);
  console.log("números:", await step("secuencias", {}));
  console.log(
    "direcciones de fotos:",
    await step("direcciones", { oldBase: "https://fhsqwbtkxpzvmqplwqul.supabase.co/storage/v1/object/public/bpos-media/", newBase: `${base}/sb/storage/v1/object/public/bpos-media/` })
  );
  console.log("conteo final:", await step("conteo", {}));
  console.log(`Listo en ${Math.round((Date.now() - started) / 1000)} s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
