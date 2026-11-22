/**
 * Menú digital (página pública /m/<liga>): menú, pedidos, seguimiento,
 * opiniones, reservaciones y cupones. Mismas reglas que en Supabase
 * (migraciones 0009, 0013, 0014, 0024 y 0044).
 */
import type { Db, Row } from "../db";
import type { RpcFn } from "../rpc-types";
import { RpcError } from "../rpc-types";
import { isMember, branchBusiness, randomFrom, randomHex } from "./common";
import { nowIso } from "../values";

type Link = { slug: string; business_id: string; branch_id: string };

const parse = (s: unknown) => {
  if (s === null || s === undefined) return null;
  if (typeof s !== "string") return s as Row;
  try {
    return JSON.parse(s) as Row;
  } catch {
    return null;
  }
};
const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown) => v === true || v === "true";
const minus = (ms: number) => new Date(Date.now() - ms).toISOString();
const DAY = 86400000;

export async function linkBySlug(db: Db, slug: unknown) {
  return db.first<Link>("SELECT slug, business_id, branch_id FROM bpos_menu_links WHERE slug = ?", [String(slug ?? "").trim().toLowerCase()]);
}

/** Documento de configuración de sync_records (record_id "__doc__") */
export async function syncDoc(db: Db, businessId: string, scope: string, collection: string, recordId = "__doc__") {
  const r = await db.first<{ data: string }>("SELECT data FROM sync_records WHERE business_id = ? AND scope = ? AND collection = ? AND record_id = ? AND deleted = 0", [businessId, scope, collection, recordId]);
  return (parse(r?.data) as Row | null) ?? null;
}

const menuPublic: RpcFn = async ({ db }, args) => {
  const link = await linkBySlug(db, args.p_slug);
  if (!link) return null;
  const settings = await syncDoc(db, link.business_id, "business", "bpos_business_settings");
  const menu = await syncDoc(db, link.business_id, link.branch_id, "bpos_digital_menu");

  // Marcas que solo venden en apps y existencias de la sucursal
  const appsOnly = new Set(
    (await db.all<{ record_id: string }>("SELECT record_id FROM sync_records WHERE business_id = ? AND scope = 'business' AND collection = 'bpos_brands' AND deleted = 0 AND json_type(data, '$.appsOnly') = 'true'", [link.business_id])).map((r) => r.record_id)
  );
  const empty = new Set(
    (
      await db.all<{ record_id: string; stock: unknown }>(
        "SELECT record_id, json_extract(data, '$.stock') AS stock FROM sync_records WHERE business_id = ? AND scope = ? AND collection = 'bpos_inventory' AND deleted = 0",
        [link.business_id, link.branch_id]
      )
    )
      .filter((r) => {
        const n = num(r.stock);
        return n !== null && n <= 0;
      })
      .map((r) => r.record_id)
  );

  const rows = await db.all<{ data: string }>("SELECT data FROM sync_records WHERE business_id = ? AND scope = 'business' AND collection = 'bpos_products' AND deleted = 0 AND json_type(data, '$.id') IS NOT NULL", [link.business_id]);
  const products = rows.map((r) => {
    const p = (parse(r.data) || {}) as Row;
    const text = (v: unknown) => (v === null || v === undefined ? null : typeof v === "string" ? v : String(v));
    return {
      id: num(p.id),
      name: text(p.name),
      category: text(p.category),
      price: num(p.price),
      emoji: text(p.emoji),
      image: text(p.image),
      description: text(p.description),
      station: text(p.station),
      notSoldAlone: bool(p.notSoldAlone) || bool(p.openPrice) || (p.brandId !== undefined && appsOnly.has(String(p.brandId))),
      noOwnTicket: bool(p.noOwnTicket),
      sellBy: text(p.sellBy),
      unit: text(p.unit),
      soldOut: !bool(p.noStock) && p.stockItemId !== undefined && p.stockItemId !== null && empty.has(String(p.stockItemId)),
      modifierGroups: p.modifierGroups ?? null,
      saleSchedule: p.saleSchedule ?? null,
    };
  });

  // Los más pedidos: piezas por producto en los últimos 30 días
  const top = await db.all<{ id: number; qty: number }>(
    `SELECT CAST(json_extract(i.value, '$.id') AS INTEGER) AS id, SUM(COALESCE(CAST(json_extract(i.value, '$.quantity') AS REAL), 1)) AS qty
       FROM sync_records r, json_each(r.data, '$.items') i
      WHERE r.business_id = ? AND r.scope = ? AND r.collection = 'bpos_orders' AND r.deleted = 0
        AND r.updated_at > ? AND json_type(r.data, '$.items') = 'array'
        AND COALESCE(json_type(r.data, '$.cancelled'), '') <> 'true'
        AND json_extract(r.data, '$.createdAt') > ?
        AND CAST(json_extract(i.value, '$.id') AS TEXT) GLOB '[0-9]*' AND CAST(json_extract(i.value, '$.id') AS TEXT) NOT GLOB '*[^0-9]*'
      GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    [link.business_id, link.branch_id, minus(35 * DAY), minus(30 * DAY)]
  );

  const business = await db.first<{ name: string }>("SELECT name FROM businesses WHERE id = ?", [link.business_id]);
  const branch = await db.first<{ name: string }>("SELECT name FROM branches WHERE id = ?", [link.branch_id]);
  return {
    slug: link.slug,
    business: {
      name: (settings?.businessName as string | undefined) ?? business?.name ?? null,
      logo: (settings?.brandLogo as string | undefined) ?? "",
      color: (settings?.brandColor as string | undefined) ?? "#f97316",
    },
    branch: branch?.name ?? null,
    menu: menu ?? {},
    products,
    top: top.map((t) => ({ id: Number(t.id), qty: Number(t.qty) })),
    now: nowIso(),
  };
};

const menuSetSlug: RpcFn = async (ctx, args) => {
  const branchId = String(args.p_branch_id ?? "");
  const business = await branchBusiness(ctx.db, branchId);
  if (!business || !(await isMember(ctx, business))) throw new RpcError("Sucursal no encontrada");
  const slug = String(args.p_slug ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/.test(slug)) throw new RpcError("La liga solo lleva letras, números y guiones (3 a 40).");
  if (await ctx.db.first("SELECT 1 AS ok FROM bpos_menu_links WHERE slug = ? AND branch_id <> ?", [slug, branchId])) throw new RpcError("Esa liga ya la usa otro negocio. Prueba con otra.");
  await ctx.db.batch([
    { sql: "DELETE FROM bpos_menu_links WHERE branch_id = ?", params: [branchId] },
    { sql: "INSERT INTO bpos_menu_links (slug, business_id, branch_id, created_at) VALUES (?, ?, ?, ?)", params: [slug, business, branchId, nowIso()] },
  ]);
  return slug;
};

const FOLIO_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const menuPlaceOrder: RpcFn = async ({ db }, args) => {
  const link = await linkBySlug(db, args.p_slug);
  if (!link) throw new RpcError("Este menú ya no existe.");
  const menu = await syncDoc(db, link.business_id, link.branch_id, "bpos_digital_menu");
  if (!bool(menu?.enabled) || !bool(menu?.acceptOrders)) throw new RpcError("Por ahora este negocio no está recibiendo pedidos en línea.");
  const order = args.p_order as Row | null;
  const lines = order && Array.isArray(order.lines) ? order.lines : null;
  if (!order || !lines || lines.length === 0) throw new RpcError("Tu pedido está vacío.");
  if (lines.length > 60 || JSON.stringify(order).length > 60000) throw new RpcError("El pedido es demasiado grande. Divídelo en dos.");
  const customer = (order.customer || {}) as Row;
  if (String(customer.name ?? "").trim() === "") throw new RpcError("Escribe tu nombre.");
  const pending = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM bpos_online_orders WHERE branch_id = ? AND status = 'nuevo'", [link.branch_id]);
  if (Number(pending?.n) >= 40) throw new RpcError("El negocio tiene muchos pedidos en este momento. Intenta en unos minutos.");

  let folio = "";
  for (let i = 0; i < 50; i++) {
    folio = randomFrom(FOLIO_ALPHABET, 4);
    if (!(await db.first("SELECT 1 AS ok FROM bpos_online_orders WHERE branch_id = ? AND folio = ? AND created_at > ?", [link.branch_id, folio, minus(7 * DAY)]))) break;
  }
  const id = crypto.randomUUID();
  const token = randomHex(16);
  const now = nowIso();
  await db.batch([
    {
      sql: "INSERT INTO bpos_online_orders (id, business_id, branch_id, folio, token, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'nuevo', ?, ?, ?)",
      params: [id, link.business_id, link.branch_id, folio, token, JSON.stringify(order), now, now],
    },
    // Los pedidos de más de 60 días ya no se necesitan
    { sql: "DELETE FROM bpos_online_orders WHERE branch_id = ? AND created_at < ?", params: [link.branch_id, minus(60 * DAY)] },
  ]);
  return { id, token, folio };
};

const menuOrderStatus: RpcFn = async ({ db }, args) => {
  const o = await db.first<Row>("SELECT * FROM bpos_online_orders WHERE id = ? AND token = ?", [String(args.p_id ?? ""), String(args.p_token ?? "")]);
  if (!o) return null;
  const branch = await db.first<{ name: string }>("SELECT name FROM branches WHERE id = ?", [o.branch_id]);
  const review = await db.first<{ stars: number; comment: string }>("SELECT stars, comment FROM bpos_reviews WHERE order_id = ?", [o.id]);
  return {
    folio: o.folio,
    status: o.status,
    eta_minutes: o.eta_minutes ?? null,
    reason: o.reason ?? null,
    created_at: o.created_at,
    updated_at: o.updated_at,
    data: parse(o.data),
    branch: branch?.name ?? null,
    review: review ? { stars: Number(review.stars), comment: review.comment } : null,
  };
};

const onlineClaim: RpcFn = async (ctx, args) => {
  const id = String(args.p_id ?? "");
  const o = await ctx.db.first<{ business_id: string }>("SELECT business_id FROM bpos_online_orders WHERE id = ?", [id]);
  if (!o || !(await isMember(ctx, o.business_id))) return false;
  const r = await ctx.db.first(
    "UPDATE bpos_online_orders SET status = 'aceptando', updated_at = ? WHERE id = ? AND (status = 'nuevo' OR (status = 'aceptando' AND updated_at < ?)) RETURNING id",
    [nowIso(), id, minus(2 * 60000)]
  );
  return Boolean(r);
};

const menuReview: RpcFn = async ({ db }, args) => {
  const o = await db.first<Row>("SELECT * FROM bpos_online_orders WHERE id = ? AND token = ?", [String(args.p_id ?? ""), String(args.p_token ?? "")]);
  if (!o) throw new RpcError("No encontramos tu pedido.");
  if (o.status !== "listo" && o.status !== "entregado") throw new RpcError("Podrás calificar cuando recibas tu pedido.");
  const stars = Number(args.p_stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new RpcError("Elige de 1 a 5 estrellas.");
  const existing = await db.first<{ created_at: string }>("SELECT created_at FROM bpos_reviews WHERE order_id = ?", [o.id]);
  if (existing && Date.parse(existing.created_at) < Date.now() - DAY) throw new RpcError("Ya calificaste este pedido. ¡Gracias!");
  const data = (parse(o.data) || {}) as Row;
  const customer = (data.customer || {}) as Row;
  const now = nowIso();
  const review = await db.first<{ id: string; stars: number }>(
    `INSERT INTO bpos_reviews (id, business_id, branch_id, order_id, folio, stars, comment, customer_name, customer_phone, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'nueva', ?, ?)
     ON CONFLICT (order_id) DO UPDATE SET stars = excluded.stars, comment = excluded.comment,
       status = CASE WHEN excluded.stars <= 3 THEN 'nueva' ELSE bpos_reviews.status END, updated_at = excluded.updated_at
     RETURNING id, stars`,
    [
      crypto.randomUUID(),
      o.business_id,
      o.branch_id,
      o.id,
      o.folio,
      stars,
      String(args.p_comment ?? "").trim().slice(0, 600),
      String(customer.name ?? "").slice(0, 80),
      String(customer.phone ?? "").slice(0, 20),
      now,
      now,
    ]
  );
  const menu = await syncDoc(db, String(o.business_id), String(o.branch_id), "bpos_digital_menu");
  let google = String(menu?.googleReviewUrl ?? "");
  if (!/^https:\/\/\S+$/i.test(google)) google = "";
  return { id: review?.id, stars: Number(review?.stars), google: stars >= 4 ? google : "" };
};

const menuReserve: RpcFn = async ({ db }, args) => {
  const link = await linkBySlug(db, args.p_slug);
  if (!link) throw new RpcError("Este menú ya no existe.");
  const menu = await syncDoc(db, link.business_id, link.branch_id, "bpos_digital_menu");
  const res = ((menu?.reservations as Row) || {}) as Row;
  if (!bool(menu?.enabled) || !bool(res.enabled)) throw new RpcError("Por ahora este negocio no recibe reservaciones en línea.");
  const r = (args.p_reservation || {}) as Row;
  const name = String(r.name ?? "").trim();
  const phone = String(r.phone ?? "").replace(/\D/g, "");
  const people = Math.trunc(Number(r.people) || 0);
  const at = Date.parse(String(r.at ?? ""));
  const max = Math.max(1, Math.trunc(Number(res.maxPeople) || 12));
  const days = Math.max(1, Math.trunc(Number(res.maxDays) || 30));
  if (!name) throw new RpcError("Escribe tu nombre.");
  if (phone.length < 10) throw new RpcError("Escribe tu WhatsApp a 10 dígitos para confirmarte.");
  if (people < 1 || people > max) throw new RpcError(`Reservamos mesas de 1 a ${max} personas. Para más, escríbenos por WhatsApp.`);
  if (!Number.isFinite(at) || at < Date.now() + 30 * 60000) throw new RpcError("Elige una hora con al menos 30 minutos de anticipación.");
  if (at > Date.now() + days * DAY) throw new RpcError(`Solo se puede reservar hasta ${days} días antes.`);
  const open = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM bpos_reservations WHERE branch_id = ? AND status = 'nueva'", [link.branch_id]);
  if (Number(open?.n) >= 60) throw new RpcError("El negocio tiene muchas reservaciones por revisar. Intenta más tarde.");
  const id = crypto.randomUUID();
  const token = randomHex(16);
  const now = nowIso();
  await db.batch([
    {
      sql: "INSERT INTO bpos_reservations (id, business_id, branch_id, token, customer_name, customer_phone, people, reserved_at, note, status, reason, attended_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'nueva', '', '', ?, ?)",
      params: [id, link.business_id, link.branch_id, token, name.slice(0, 80), phone.slice(0, 13), people, new Date(at).toISOString(), String(r.note ?? "").slice(0, 300), now, now],
    },
    { sql: "DELETE FROM bpos_reservations WHERE branch_id = ? AND reserved_at < ?", params: [link.branch_id, minus(90 * DAY)] },
  ]);
  return { id, token };
};

const reservationStatus: RpcFn = async ({ db }, args) => {
  const r = await db.first<Row>("SELECT status, reason, reserved_at, people FROM bpos_reservations WHERE id = ? AND token = ?", [String(args.p_id ?? ""), String(args.p_token ?? "")]);
  return r ? { status: r.status, reason: r.reason, reserved_at: r.reserved_at, people: Number(r.people) } : null;
};

const reservationCancel: RpcFn = async ({ db }, args) => {
  const r = await db.first("UPDATE bpos_reservations SET status = 'cancelada', updated_at = ? WHERE id = ? AND token = ? AND status IN ('nueva', 'confirmada') RETURNING id", [nowIso(), String(args.p_id ?? ""), String(args.p_token ?? "")]);
  return r ? true : null;
};

const menuCoupon: RpcFn = async ({ db }, args) => {
  const link = await linkBySlug(db, args.p_slug);
  if (!link) throw new RpcError("Este menú ya no existe.");
  const code = String(args.p_code ?? "").replace(/[^A-Za-z0-9Ññ-]/g, "").toUpperCase();
  if (!code) throw new RpcError("Escribe el código del cupón.");
  const rows = await db.all<{ data: string }>("SELECT data FROM sync_records WHERE business_id = ? AND scope = 'business' AND collection = 'bpos_coupons' AND deleted = 0", [link.business_id]);
  const c = rows.map((r) => (parse(r.data) || {}) as Row).find((x) => String(x.code ?? "").toUpperCase() === code);
  if (!c) throw new RpcError("Ese cupón no existe.");
  if (!bool(c.active) || !bool(c.online)) throw new RpcError("Ese cupón no está disponible en el menú digital.");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (c.from && today < String(c.from)) throw new RpcError("Ese cupón todavía no empieza.");
  if (c.until && today > String(c.until)) throw new RpcError("Ese cupón ya venció.");
  const subtotal = num(args.p_subtotal) ?? 0;
  const maxUses = Math.trunc(num(c.maxUses) ?? 0);
  if (maxUses > 0) {
    const pend = await db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM bpos_online_orders WHERE business_id = ? AND status IN ('nuevo', 'aceptando') AND upper(CAST(json_extract(data, '$.coupon.code') AS TEXT)) = ?",
      [link.business_id, code]
    );
    if (Math.trunc(num(c.uses) ?? 0) + Number(pend?.n || 0) >= maxUses) throw new RpcError("Ese cupón ya se agotó.");
  }
  const minPurchase = num(c.minPurchase) ?? 0;
  if (minPurchase > subtotal) throw new RpcError(`Ese cupón es para compras desde $${minPurchase}.`);
  const value = num(c.value) ?? 0;
  const cap = num(c.maxDiscount) ?? 0;
  let discount = c.kind === "percent" ? (subtotal * value) / 100 : value;
  if (c.kind === "percent" && cap > 0) discount = Math.min(discount, cap);
  discount = Math.round(Math.max(0, Math.min(discount, subtotal)) * 100) / 100;
  return { code, discount, kind: c.kind ?? null, value, minPurchase, maxDiscount: cap };
};

export const MENU_RPC: Record<string, RpcFn> = {
  bpos_menu_public: menuPublic,
  bpos_menu_set_slug: menuSetSlug,
  bpos_menu_place_order: menuPlaceOrder,
  bpos_menu_order_status: menuOrderStatus,
  bpos_online_claim: onlineClaim,
  bpos_menu_review: menuReview,
  bpos_menu_reserve: menuReserve,
  bpos_menu_reservation_status: reservationStatus,
  bpos_menu_reservation_cancel: reservationCancel,
  bpos_menu_coupon: menuCoupon,
};
