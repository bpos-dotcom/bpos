/**
 * Mudanza de datos de "Supabase" a la nube de Cloudflare (aquí las dos son
 * nubes de prueba): tablas con sus números, usuarios con su contraseña,
 * fotos y sus direcciones, y una caja que ya tenía sesión sigue entrando
 * sin volver a escribir su contraseña.
 *   npx tsx scripts/test-nube-mudanza.ts
 */
import { createClient } from "@supabase/supabase-js";
import { handleNubeRequest } from "../nube/router";
import { handleStorage, type BucketLike } from "../nube/storage";
import { COPY_ORDER } from "../nube/migrate";
import { ANON, SERVICE, checker, makeHarness, seedBusiness } from "./nube-harness";

const { check, done } = checker();

function memoryBucket(): BucketLike & { map: Map<string, Uint8Array> } {
  const map = new Map<string, Uint8Array>();
  return {
    map,
    async put(key, value) {
      map.set(key, value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer));
    },
    async get(key) {
      const d = map.get(key);
      return d ? { body: new Blob([d.slice().buffer as ArrayBuffer]).stream(), arrayBuffer: async () => d.slice().buffer as ArrayBuffer, httpMetadata: { contentType: "image/webp" } } : null;
    },
    async head(key) {
      return map.has(key) ? {} : null;
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) map.delete(k);
    },
  };
}

async function main() {
  // ---------------------------------------------------------------- "Supabase" con datos
  const src = await makeHarness();
  // "Supabase" firma sus sesiones con otra llave que la nube nueva
  src.deps.auth = { ...src.deps.auth, jwtSecret: "llave-de-supabase-distinta-0987654321" };
  const srcFiles = memoryBucket();
  src.deps.storage = (request, path, auth) => handleStorage(request, path, auth, { db: src.db, bucket: srcFiles });
  // La lista de Storage de Supabase (POST /object/list/<bucket>) para la prueba
  const srcFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const m = /\/storage\/v1\/object\/list\/([^/?]+)/.exec(url);
    if (m) {
      const { prefix } = JSON.parse(String(init?.body || "{}")) as { prefix: string };
      const base = `${m[1]}/${prefix ? `${prefix}/` : ""}`;
      const names = new Map<string, boolean>();
      for (const key of srcFiles.map.keys()) {
        if (!key.startsWith(base)) continue;
        const rest = key.slice(base.length);
        const [first, ...more] = rest.split("/");
        names.set(first, more.length === 0);
      }
      return new Response(JSON.stringify([...names].map(([name, file]) => ({ name, id: file ? crypto.randomUUID() : null, metadata: file ? { mimetype: "image/webp" } : null }))), { headers: { "content-type": "application/json" } });
    }
    return handleNubeRequest(new Request(url, init), src.deps);
  }) as typeof fetch;

  const a = await seedBusiness(src, "dueno@prueba.mx", "Burger Planet");
  const sa = await src.signIn("dueno@prueba.mx", "secreta123");
  const oldPhoto = `http://nube.test/sb/storage/v1/object/public/bpos-media/${a.businessId}/productos/f1.webp`;
  await srcFiles.put(`bpos-media/${a.businessId}/productos/f1.webp`, new Uint8Array([9, 9, 9]));
  const records = Array.from({ length: 1203 }, (_, i) => ({ business_id: a.businessId, scope: "business", collection: "bpos_products", record_id: String(i + 1), data: { id: i + 1, name: `P${i + 1}`, ...(i === 0 ? { image: oldPhoto } : {}) }, deleted: false }));
  for (let i = 0; i < records.length; i += 300) {
    const r = await sa.from("sync_records").upsert(records.slice(i, i + 300));
    if (r.error) throw r.error;
  }
  await sa.from("audit_events").insert({ business_id: a.businessId, event_id: "e1", category: "Venta", action: "sale.created", happened_at: new Date().toISOString() });
  const srcSeq = Number((await sa.from("sync_heads").select("seq").eq("business_id", a.businessId).single()).data?.seq);
  // Sesión que la caja ya tenía antes del cambio
  const oldSession = (await sa.auth.getSession()).data.session!;

  // ---------------------------------------------------------------- nube nueva vacía
  const dst = await makeHarness();
  const dstFiles = memoryBucket();
  dst.deps.storage = (request, path, auth) => handleStorage(request, path, auth, { db: dst.db, bucket: dstFiles });
  dst.deps.migrate = { key: "llave-mudanza", source: { url: "http://nube.test/sb", key: SERVICE, fetch: srcFetch }, bucket: dstFiles };
  dst.deps.auth = { ...dst.deps.auth, legacy: { url: "http://nube.test/sb", anonKey: ANON, fetch: srcFetch } };
  const step = async (name: string, body: unknown, key = "llave-mudanza") => {
    const r = await handleNubeRequest(new Request(`http://nube.test/sb/_mudanza/${name}`, { method: "POST", headers: { "x-mudanza": key, "content-type": "application/json" }, body: JSON.stringify(body) }), dst.deps);
    return { status: r.status, body: r.status === 200 ? await r.json() : null };
  };

  check("sin la llave de la mudanza no copia nada", (await step("tabla", { table: "businesses", offset: 0 }, "mala")).status === 403);
  for (const table of COPY_ORDER) {
    let offset = 0;
    for (let guard = 0; guard < 100; guard++) {
      const r = await step("tabla", { table, offset, pageSize: 500 });
      if (r.status !== 200) throw new Error(`falló ${table}: ${r.status}`);
      offset = (r.body as { next: number }).next;
      if ((r.body as { done: boolean }).done) break;
    }
  }
  let uo = 0;
  for (;;) {
    const r = await step("usuarios", { offset: uo });
    uo = (r.body as { next: number }).next;
    if ((r.body as { done: boolean }).done) break;
  }
  const seqs = await step("secuencias", {});
  const queue = [""];
  let photos = 0;
  while (queue.length) {
    const r = await step("fotos", { prefix: queue.shift() });
    photos += (r.body as { copied: number }).copied;
    queue.push(...(r.body as { folders: string[] }).folders);
  }
  check("fotos copiadas a R2", photos === 1 && dstFiles.map.has(`bpos-media/${a.businessId}/productos/f1.webp`), photos);
  const newBase = "https://bpos-nube.test/sb/storage/v1/object/public/bpos-media/";
  const rw = await step("direcciones", { oldBase: "http://nube.test/sb/storage/v1/object/public/bpos-media/", newBase });
  check("direcciones de fotos cambiadas", (rw.body as { records: number }).records === 1, rw.body);

  const count = (await step("conteo", {})).body as Record<string, number>;
  check("todos los registros copiados (1203 + 0)", count.sync_records === 1203, count.sync_records);
  check("negocio, sucursal, miembro, bitácora y usuario", count.businesses === 1 && count.branches === 1 && count.business_members === 1 && count.audit_events === 1 && count.nube_users === 1, count);
  check("el número de cambios sigue después del más alto", Number((seqs.body as { seq: number }).seq) >= srcSeq, [seqs.body, srcSeq]);

  // ---------------------------------------------------------------- todo funciona en la nube nueva
  const da = await dst.signIn("dueno@prueba.mx", "secreta123");
  check("el dueño entra con su misma contraseña", Boolean((await da.auth.getUser()).data.user));
  const { data: p1 } = await da.from("sync_records").select("data, seq").eq("record_id", "1").single();
  check("la foto ya apunta a la nube nueva y con número nuevo (las cajas la bajan)", (p1?.data as { image: string })?.image === `${newBase}${a.businessId}/productos/f1.webp` && Number(p1?.seq) > srcSeq, p1);
  const { data: p2 } = await da.from("sync_records").select("seq").eq("record_id", "2").single();
  const { data: p2src } = await sa.from("sync_records").select("seq").eq("record_id", "2").single();
  check("los demás conservan su número (la caja sigue desde donde iba)", Number(p2?.seq) === Number(p2src?.seq));
  const w = await da.from("sync_records").upsert([{ business_id: a.businessId, scope: "business", collection: "bpos_products", record_id: "9999", data: { id: 9999 }, deleted: false }]).select("seq");
  check("un cambio nuevo lleva número más alto que todo lo copiado", Number(w.data?.[0]?.seq) > Number(p1?.seq), w);
  const again = await step("tabla", { table: "businesses", offset: 0 });
  check("se puede repetir la copia sin duplicar", again.status === 200 && ((await step("conteo", {})).body as Record<string, number>).businesses === 1);

  // ---------------------------------------------------------------- la caja que ya tenía sesión
  const caja = createClient("http://nube.test/sb", ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: ((input: RequestInfo | URL, init?: RequestInit) => handleNubeRequest(new Request(String(input), init), dst.deps)) as typeof fetch },
  });
  await caja.auth.setSession({ access_token: oldSession.access_token, refresh_token: oldSession.refresh_token });
  const { data: viaOld, error: oldErr } = await caja.from("branches").select("id");
  check("con la sesión de antes del cambio sigue viendo sus datos", !oldErr && viaOld?.length === 1, oldErr || viaOld);
  const swapped = await caja.auth.refreshSession();
  check("al renovar, la sesión vieja se cambia por una de la nube", !swapped.error && Boolean(swapped.data.session?.access_token) && swapped.data.session?.refresh_token !== oldSession.refresh_token, swapped.error?.message);
  const { data: viaNew } = await caja.from("branches").select("id");
  check("y con la nueva también", viaNew?.length === 1);

  // ---------------------------------------------------------------- regreso a Supabase (lo nuevo de la nube)
  const cut = Number((seqs.body as { seq: number }).seq);
  await da.from("sync_records").upsert([{ business_id: a.businessId, scope: a.branchId, collection: "bpos_orders", record_id: "501", data: { id: 501, total: 250 }, deleted: false }]);
  let off = 0;
  for (;;) {
    const r = await step("regresar", { table: "sync_records", offset: off, sinceSeq: cut });
    off = (r.body as { next: number }).next;
    if ((r.body as { done: boolean }).done) break;
  }
  const { data: back } = await sa.from("sync_records").select("data, seq").eq("collection", "bpos_orders").eq("record_id", "501").maybeSingle();
  check("regreso: la venta hecha en la nube ya está en Supabase", (back?.data as { total: number })?.total === 250 && Number(back?.seq) > srcSeq, back);
  check("regreso: solo lo nuevo (desde el cambio)", off <= 5, off);

  done();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
