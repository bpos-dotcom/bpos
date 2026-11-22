/**
 * Celular como escáner: llave secreta, dirección del QR, códigos repetidos
 * y que la caja y el celular se entiendan por el canal de tiempo real
 * (contra la nube de Cloudflare sobre SQLite, igual que en Supabase).
 *   npx tsx scripts/test-celular-escaner.ts
 */
import { cleanScannedCode } from "../lib/barcode-camera";
import { acceptPhoneCode, deviceScanToken, newScanToken, PHONE_SCAN_KEY, scanChannel, scannerUrl, tokenFromHash, validScanToken } from "../lib/phone-scanner";
import { RealtimeHub, type HubSocket } from "../nube/realtime";
// El mismo codificador que usa supabase-js en el navegador
import Serializer from "@supabase/realtime-js/dist/main/lib/serializer";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

// ---------------------------------------------------------------- llave
const t1 = newScanToken();
const t2 = newScanToken();
check("llave de 24 letras", t1.length === 24 && validScanToken(t1), t1);
check("cada llave es distinta", t1 !== t2);
check("llave rara no sirve", !validScanToken("abc") && !validScanToken("../../etc/passwd/abcdefgh") && !validScanToken(null));
check("la llave usa todo el alfabeto (no se adivina)", new Set(Array.from({ length: 200 }, () => newScanToken()).join("")).size > 50);

const mem = new Map<string, string>();
const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
const a = deviceScanToken(store);
check("la caja guarda su llave", mem.get(PHONE_SCAN_KEY) === a);
check("la próxima vez usa la misma (el celular sigue ligado)", deviceScanToken(store) === a);
const b = deviceScanToken(store, true);
check("Cambiar celular crea otra y la guarda", b !== a && mem.get(PHONE_SCAN_KEY) === b);
mem.set(PHONE_SCAN_KEY, "basura");
check("si la guardada está mal, crea una buena", validScanToken(deviceScanToken(store)));
check("sin almacenamiento igual da llave", validScanToken(deviceScanToken(null)));
const broken = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => {} };
check("almacenamiento bloqueado no truena", validScanToken(deviceScanToken(broken)));

// ---------------------------------------------------------------- dirección
const url = scannerUrl("https://www.bpos.com.mx/", t1);
check("dirección del QR con la llave después de #", url === `https://www.bpos.com.mx/escaner#${t1}`, url);
check("el celular lee la llave de la dirección", tokenFromHash(`#${t1}`) === t1);
check("dirección sin llave o cambiada no sirve", tokenFromHash("") === "" && tokenFromHash("#hola") === "" && tokenFromHash(`#${t1}x`) === "");
check("canal propio de esa llave", scanChannel(t1) === `escaner-${t1}`);

// ---------------------------------------------------------------- códigos que llegan a la caja
const seen = new Set<string>();
const club = (raw: unknown) => cleanScannedCode(raw, { checkDigit: false });
const product = (raw: unknown) => cleanScannedCode(raw);
const r1 = acceptPhoneCode(seen, { code: " BP-4K7Q2 ", id: "x1" }, club);
check("código del club llega limpio", r1.use && r1.code === "BP-4K7Q2", r1);
check("el mismo envío repetido (reintento) no se usa dos veces", acceptPhoneCode(seen, { code: "BP-4K7Q2", id: "x1" }, club).reason === "repetido");
check("otra lectura del mismo código sí entra", acceptPhoneCode(seen, { code: "BP-4K7Q2", id: "x2" }, club).use);
check("producto con dígito de control mal no entra", acceptPhoneCode(seen, { code: "7501055300076", id: "x3" }, product).reason === "no-valido");
check("producto bueno entra", acceptPhoneCode(seen, { code: "7501055300075", id: "x4" }, product).use);
check("sin identificador no entra", acceptPhoneCode(seen, { code: "7501055300075" }, product).reason === "sin-id");

// ---------------------------------------------------------------- tiempo real en la nube de Cloudflare
type Sent = Record<string, unknown> | unknown[];
function socket(): HubSocket & { sent: Sent[] } {
  let state = { vsn: "1.0.0", joins: [] as unknown[] } as unknown as ReturnType<HubSocket["state"]>;
  const sent: Sent[] = [];
  return {
    sent,
    send: (text: string) => void sent.push(JSON.parse(text)),
    state: () => state,
    save: (s) => void (state = s),
  } as HubSocket & { sent: Sent[] };
}

async function realtime() {
  const caja = socket();
  const celular = socket();
  const otro = socket();
  const hub = new RealtimeHub({ db: { all: async () => [], first: async () => null, run: async () => ({ changes: 0 }), batch: async () => [] } as never, jwtSecret: "x", serviceKey: "y", sockets: () => [caja, celular, otro] });
  const topic = `realtime:${scanChannel(t1)}`;
  const join = (s: HubSocket, top: string, ref: string) => hub.onMessage(s, JSON.stringify({ topic: top, event: "phx_join", payload: { config: { broadcast: { self: false } } }, ref, join_ref: ref }));
  await join(caja, topic, "1");
  await join(celular, topic, "2");
  await join(otro, `realtime:${scanChannel(t2)}`, "3");
  const joined = (s: { sent: Sent[] }) => s.sent.some((m) => (m as { event?: string; payload?: { status?: string } }).event === "phx_reply" && (m as { payload: { status: string } }).payload.status === "ok");
  check("caja y celular entran al canal sin cuenta", joined(caja) && joined(celular));
  await hub.onMessage(celular, JSON.stringify({ topic, event: "broadcast", payload: { type: "broadcast", event: "codigo", payload: { code: "BP-4K7Q2", id: "z1" } }, ref: "4" }));
  const got = caja.sent.find((m) => (m as { event?: string }).event === "broadcast") as { payload: { event: string; payload: { code: string } } } | undefined;
  check("la caja recibe el código del celular", got?.payload.event === "codigo" && got.payload.payload.code === "BP-4K7Q2", caja.sent);
  check("el celular no recibe su propio envío", !celular.sent.some((m) => (m as { event?: string }).event === "broadcast"));
  check("otra caja (otra llave) no recibe nada", !otro.sent.some((m) => (m as { event?: string }).event === "broadcast"));
  await hub.onMessage(caja, JSON.stringify({ topic, event: "broadcast", payload: { type: "broadcast", event: "recibido", payload: { id: "z1", ok: true, text: "✓" } }, ref: "5" }));
  check("el celular recibe la confirmación", celular.sent.some((m) => (m as { payload?: { event?: string } }).payload?.event === "recibido"));

  // supabase-js de verdad manda el broadcast en binario (realtime-js 2.x): la nube lo debe entender
  const before = caja.sent.length;
  const serializer = new Serializer();
  const binary = await new Promise<ArrayBuffer>((res) =>
    serializer.encode({ join_ref: "2", ref: "6", topic, event: "broadcast", payload: { type: "broadcast", event: "codigo", payload: { code: "Ñandú-7501055300075", id: "z2" } } }, (r) => res(r as ArrayBuffer))
  );
  check("supabase-js lo manda en binario", binary instanceof ArrayBuffer);
  await hub.onMessage(celular, binary);
  const bin = caja.sent.slice(before).find((m) => (m as { event?: string }).event === "broadcast") as { payload: { event: string; payload: { code: string; id: string } } } | undefined;
  check("la caja recibe el código que llegó en binario (con acentos)", bin?.payload.event === "codigo" && bin.payload.payload.code === "Ñandú-7501055300075" && bin.payload.payload.id === "z2", caja.sent.slice(before));
  await hub.onMessage(celular, new Uint8Array([3, 0, 0, 200, 1, 0, 1, 65]));
  await hub.onMessage(celular, new Uint8Array([9, 1, 2, 3]));
  check("binario roto o de otro tipo no truena ni llega", caja.sent.length === before + 1);
}

realtime()
  .then(() => {
    console.log(`\n${ok} bien, ${bad} mal`);
    process.exit(bad ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
