import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/billing/mercadopago";
import { bridgeAuth } from "@/lib/bridge/api-guard";
import { emailConfigured, sendEmail } from "@/lib/email/send";

/**
 * Productividad (lib/productivity.ts) en el servidor:
 *
 * Foto de evidencia con el celular (migración 0036):
 *   POST { accion: "evidencia", title }        caja (sesión) → { token }: el QR lleva a /evidencia/<token>
 *   GET  ?token=<token>                        caja (sesión) → { photo } cuando ya la subieron
 *   GET  ?ver=<token>                          celular, sin sesión → { title, photo }
 *   PUT  ?token=<token>  (cuerpo: la imagen)   celular, sin sesión → la sube a bpos-media/<negocio>/evidencias
 *
 * Lista de tareas con foto por tarea (migración 0041): el folio lleva `items`
 *   POST { accion: "lista", title, items }      caja (sesión) → { token }; GET ?token / ?ver regresan también items
 *   PUT  ?token=<token>&item=<i>                celular, sin sesión → foto de esa tarea (la palomea)
 *   PATCH ?token=<token>&item=<i> { done, by }  celular, sin sesión → palomea una tarea sin foto
 *   POST { accion: "lista-marcar", token, item, done, by, url? }  caja (sesión) → lo que palomearon en la caja
 *
 * Inventario ciego:
 *   POST { accion: "inventario-ciego", to, ... }  caja (sesión) → manda el reporte por correo
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "bpos-media";
/** El QR sirve 2 horas; el de una lista, 12 (un cierre puede tardar) */
const TOKEN_MS = 2 * 60 * 60 * 1000;
const LIST_TOKEN_MS = 12 * 60 * 60 * 1000;
const MAX_ITEMS = 60;
const MAX_BYTES = 6 * 1024 * 1024;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
const fail = (error: string, status = 400) => json({ success: false, error }, status);
const cleanToken = (value: string | null) => String(value || "").replace(/[^a-f0-9]/g, "").slice(0, 64);
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type ListItem = { name: string; photo: boolean; url: string | null; done: boolean; by: string | null; at: string | null };
type EvidenceRow = { token: string; business_id: string; branch_id: string | null; title: string; photo_url: string | null; items: ListItem[] | null; created_at: string };

async function evidence(token: string) {
  if (token.length < 32) return null;
  try {
    const { data } = await supabaseAdmin().from("bpos_task_evidence").select("token, business_id, branch_id, title, photo_url, items, created_at").eq("token", token).maybeSingle();
    if (!data || Date.now() - Date.parse(data.created_at) > (Array.isArray(data.items) ? LIST_TOKEN_MS : TOKEN_MS)) return null;
    return data as EvidenceRow;
  } catch {
    return null;
  }
}

const cleanName = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
const httpsUrl = (v: unknown) => (typeof v === "string" && /^https:\/\//.test(v) ? v.slice(0, 500) : null);

/** Cambia una tarea de la lista (en la base, así dos celulares a la vez no se pisan) */
async function patchItem(row: EvidenceRow, index: number, patch: Partial<ListItem>) {
  const { data, error } = await supabaseAdmin().rpc("bpos_task_evidence_item", { p_token: row.token, p_index: index, p_patch: patch });
  if (error) throw new Error(error.message);
  return (data as ListItem[] | null) || row.items || [];
}

/** Palomear o quitar la palomita (quitarla borra la foto de esa tarea) */
const itemPatch = (done: boolean, by: unknown, url?: string | null): Partial<ListItem> =>
  done ? { done, by: cleanName(by) || null, at: new Date().toISOString(), ...(url ? { url } : {}) } : { done: false, url: null, by: null, at: null };

function itemIndex(row: EvidenceRow, value: unknown) {
  const index = Number(value);
  return row.items && value !== null && value !== "" && Number.isInteger(index) && index >= 0 && index < row.items.length ? index : -1;
}

async function uploadPhoto(request: NextRequest, row: EvidenceRow) {
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!/^image\/(webp|jpeg|png)$/.test(type)) throw new Error("Sube una foto.");
  const body = Buffer.from(await request.arrayBuffer());
  if (!body.length || body.length > MAX_BYTES) throw new Error("La foto pesa demasiado.");
  const ext = type === "image/jpeg" ? "jpg" : type.slice(6);
  const path = `${row.business_id}/evidencias/${row.token.slice(0, 16)}-${Date.now().toString(36)}.${ext}`;
  const admin = supabaseAdmin();
  const { error } = await admin.storage.from(BUCKET).upload(path, body, { contentType: type, cacheControl: "31536000" });
  if (error) throw new Error(error.message);
  return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const view = cleanToken(params.get("ver"));
  if (view) {
    const row = await evidence(view);
    if (!row) return fail("Este QR ya venció. Pide uno nuevo en la caja.", 404);
    return json({ success: true, title: row.title, photo: row.photo_url, items: row.items });
  }
  const auth = await bridgeAuth(request);
  if ("denied" in auth) return auth.denied;
  if (auth.ctx.mode !== "cloud") return fail("La foto con el celular necesita B-POS en la nube.", 503);
  const row = await evidence(cleanToken(params.get("token")));
  if (!row || row.business_id !== auth.ctx.businessId) return fail("Folio no encontrado.", 404);
  return json({ success: true, photo: row.photo_url, items: row.items });
}

export async function PUT(request: NextRequest) {
  const row = await evidence(cleanToken(request.nextUrl.searchParams.get("token")));
  if (!row) return fail("Este QR ya venció. Pide uno nuevo en la caja.", 404);
  // Foto de una tarea de la lista (quien la tomó viene en x-bpos-nombre)
  if (row.items) {
    const index = itemIndex(row, request.nextUrl.searchParams.get("item"));
    if (index < 0) return fail("Esa tarea ya no está en la lista.", 404);
    try {
      const photo = await uploadPhoto(request, row);
      const items = await patchItem(row, index, itemPatch(true, decodeURIComponent(request.headers.get("x-bpos-nombre") || ""), photo));
      return json({ success: true, photo, items });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "No se pudo subir la foto.", 502);
    }
  }
  if (row.photo_url) return fail("Ya se subió la foto de este recordatorio.", 409);
  let photo: string;
  try {
    photo = await uploadPhoto(request, row);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "No se pudo subir la foto.", 502);
  }
  await supabaseAdmin().from("bpos_task_evidence").update({ photo_url: photo, uploaded_at: new Date().toISOString() }).eq("token", row.token);
  return json({ success: true, photo });
}

/** Celular: palomea (o quita) una tarea de la lista; las que piden foto solo se palomean con la foto */
export async function PATCH(request: NextRequest) {
  const row = await evidence(cleanToken(request.nextUrl.searchParams.get("token")));
  if (!row?.items) return fail("Este QR ya venció. Pide uno nuevo en la caja.", 404);
  const index = itemIndex(row, request.nextUrl.searchParams.get("item"));
  if (index < 0) return fail("Esa tarea ya no está en la lista.", 404);
  const body = (await request.json().catch(() => ({}))) as { done?: unknown; by?: unknown };
  if (body.done === true && row.items[index].photo && !row.items[index].url) return fail("Esta tarea necesita foto.");
  try {
    return json({ success: true, items: await patchItem(row, index, itemPatch(body.done === true, body.by)) });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "No se pudo guardar.", 502);
  }
}

type BlindMailRow = { name: string; unit: string; counted: number | null; expected?: number; diff: number; money: number; state: string };

function blindHtml(b: { businessName: string; when: string; by: string; faltante: number; sobrante: number; rows: BlindMailRow[] }) {
  const money = (n: number) => `$${Math.abs(n).toFixed(2)}`;
  const color: Record<string, string> = { falta: "#dc2626", sobra: "#2563eb", cuadra: "#16a34a", "sin contar": "#71717a" };
  const label: Record<string, string> = { falta: "Falta", sobra: "Sobra", cuadra: "Cuadra", "sin contar": "Sin contar" };
  const order = ["falta", "sobra", "sin contar", "cuadra"];
  const rows = b.rows
    .slice()
    .sort((x, y) => order.indexOf(x.state) - order.indexOf(y.state) || x.money - y.money)
    .map(
      (r) => `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e4e4e7">${esc(r.name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e4e4e7;text-align:right">${r.counted === null ? "—" : `${esc(r.counted)} ${esc(r.unit)}`}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e4e4e7;text-align:right">${r.expected === undefined ? "—" : `${esc(Math.round(r.expected * 1000) / 1000)} ${esc(r.unit)}`}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e4e4e7;text-align:right;color:${color[r.state] || "#18181b"};font-weight:bold">${r.state === "falta" || r.state === "sobra" ? `${r.diff > 0 ? "+" : ""}${esc(r.diff)} ${esc(r.unit)}${r.money ? ` (${money(r.money)})` : ""}` : esc(label[r.state] || r.state)}</td>
      </tr>`
    )
    .join("");
  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:24px;color:#18181b">
  <p style="color:#f97316;font-weight:bold;margin:0">B-POS · ${esc(b.businessName)}</p>
  <h2 style="margin:4px 0 4px">Inventario ciego</h2>
  <p style="margin:0 0 16px;color:#52525b">${esc(b.when)} · contó ${esc(b.by)}</p>
  <p style="font-size:16px;margin:0 0 16px"><b style="color:#dc2626">Faltante: ${money(b.faltante)}</b> &nbsp;·&nbsp; <b style="color:#2563eb">Sobrante: ${money(b.sobrante)}</b></p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <thead><tr style="background:#f4f4f5"><th style="padding:6px 8px;text-align:left">Insumo</th><th style="padding:6px 8px;text-align:right">Contaron</th><th style="padding:6px 8px;text-align:right">Sistema</th><th style="padding:6px 8px;text-align:right">Diferencia</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="color:#52525b;font-size:13px;margin-top:16px">"Sistema" es lo que decía B-POS en el momento en que capturaron cada insumo. El inventario no se cambió: si estás de acuerdo con lo contado, entra a la App del dueño → Productividad y dale "Ajustar todo a lo contado".</p>
  <p style="margin-top:20px"><a href="https://www.bpos.com.mx/dueno?vista=productividad" style="background:#f97316;color:#000;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:bold">Abrir App del dueño</a></p>
</div>`;
}

export async function POST(request: NextRequest) {
  const auth = await bridgeAuth(request);
  if ("denied" in auth) return auth.denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.accion === "evidencia") {
    if (auth.ctx.mode !== "cloud") return fail("La foto con el celular necesita B-POS en la nube.", 503);
    const token = randomBytes(24).toString("hex");
    const admin = supabaseAdmin();
    const { error } = await admin.from("bpos_task_evidence").insert({ token, business_id: auth.ctx.businessId, branch_id: auth.ctx.branchId, title: String(body.title || "").slice(0, 200) });
    if (error) return fail(error.message, 502);
    // De paso se borran los folios de más de 2 días
    void admin.from("bpos_task_evidence").delete().lt("created_at", new Date(Date.now() - 2 * 86_400_000).toISOString());
    return json({ success: true, token });
  }

  if (body.accion === "lista") {
    if (auth.ctx.mode !== "cloud") return fail("La lista en el celular necesita B-POS en la nube.", 503);
    // Lo que ya llevaban palomeado en la caja entra tal cual
    const items: ListItem[] = (Array.isArray(body.items) ? body.items : []).slice(0, MAX_ITEMS).map((raw) => {
      const i = (raw || {}) as Record<string, unknown>;
      return { name: String(i.name || "").slice(0, 120), photo: i.photo === true, url: httpsUrl(i.url), done: i.done === true, by: cleanName(i.by) || null, at: typeof i.at === "string" ? i.at.slice(0, 40) : null };
    });
    if (!items.length) return fail("La lista no tiene tareas.");
    const token = randomBytes(24).toString("hex");
    const { error } = await supabaseAdmin().from("bpos_task_evidence").insert({ token, business_id: auth.ctx.businessId, branch_id: auth.ctx.branchId, title: String(body.title || "").slice(0, 200), items });
    if (error) return fail(error.message, 502);
    return json({ success: true, token });
  }

  if (body.accion === "lista-marcar") {
    const row = await evidence(cleanToken(String(body.token || "")));
    if (auth.ctx.mode !== "cloud" || !row?.items || row.business_id !== auth.ctx.businessId) return fail("Folio no encontrado.", 404);
    const index = itemIndex(row, body.item);
    if (index < 0) return fail("Esa tarea ya no está en la lista.", 404);
    try {
      return json({ success: true, items: await patchItem(row, index, itemPatch(body.done === true, body.by, httpsUrl(body.url))) });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "No se pudo guardar.", 502);
    }
  }

  if (body.accion === "inventario-ciego") {
    if (!emailConfigured()) return fail("El envío de correo no está configurado en el servidor.", 503);
    const to = String(body.to || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return fail("Correo no válido.");
    const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 500).map((r) => {
      const row = (r || {}) as Record<string, unknown>;
      return {
        name: String(row.name || "").slice(0, 80),
        unit: String(row.unit || "").slice(0, 8),
        counted: row.counted === null || row.counted === undefined ? null : Number(row.counted),
        expected: row.expected === undefined || row.expected === null ? undefined : Number(row.expected),
        diff: Number(row.diff) || 0,
        money: Number(row.money) || 0,
        state: String(row.state || ""),
      };
    });
    const businessName = String(body.businessName || "Mi negocio").slice(0, 80);
    const when = String(body.when || "").slice(0, 60);
    const by = String(body.by || "").slice(0, 60);
    const faltante = Number(body.faltante) || 0;
    const sobrante = Number(body.sobrante) || 0;
    const ok = await sendEmail({
      to,
      subject: `Inventario ciego · ${businessName}${faltante ? ` · faltante $${faltante.toFixed(2)}` : ""}`,
      html: blindHtml({ businessName, when, by, faltante, sobrante, rows }),
      text: `Inventario ciego de ${businessName} (${when}, contó ${by}). Faltante $${faltante.toFixed(2)}, sobrante $${sobrante.toFixed(2)}.\n\n${rows
        .map((r) => `${r.name}: contaron ${r.counted ?? "—"} ${r.unit}, sistema ${r.expected ?? "—"} (${r.state})`)
        .join("\n")}`,
    });
    if (!ok) return fail("El servicio de correo rechazó el envío.", 502);
    return json({ success: true });
  }

  return fail("Acción desconocida.");
}
