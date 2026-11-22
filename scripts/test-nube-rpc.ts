/**
 * Funciones RPC de la nube de Cloudflare: todas las que llama B-POS existen y
 * hacen lo mismo que en Supabase (menú digital, club, Agent, IA, alta).
 *   npx tsx scripts/test-nube-rpc.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { RPC_FUNCTIONS } from "../nube/rpc/index";
import { checker, makeHarness, seedBusiness } from "./nube-harness";

const { check, done } = checker();

/** Nombres de rpc("...") en el código de B-POS y del Agent */
function usedRpcs() {
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (f === "node_modules" || f.startsWith(".")) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js)$/.test(f)) for (const m of readFileSync(p, "utf8").matchAll(/rpc\(\s*["'`]([a-z_0-9]+)["'`]/g)) names.add(m[1]);
    }
  };
  ["lib", "app", "components"].forEach(walk);
  for (const m of readFileSync("bpos-agent/lib/cloud-link.js", "utf8").matchAll(/["'`](bpos_agent_[a-z_]+)["'`]/g)) names.add(m[1]);
  names.delete("bpos_agent_");
  return [...names];
}

async function main() {
  const missing = usedRpcs().filter((n) => !RPC_FUNCTIONS[n]);
  check(`todas las funciones que usa B-POS existen (${usedRpcs().length})`, missing.length === 0, missing);

  const h = await makeHarness();
  const a = await seedBusiness(h, "dueno@prueba.mx", "Burger Prueba");
  const sa = await h.signIn("dueno@prueba.mx", "secreta123");
  const anon = h.client();
  const svc = h.client({ service: true });

  // ---------------------------------------------------------------- menú digital
  const slug = await sa.rpc("bpos_menu_set_slug", { p_branch_id: a.branchId, p_slug: "Burger-Prueba" });
  check("liga del menú", slug.data === "burger-prueba", slug.error);
  const badSlug = await sa.rpc("bpos_menu_set_slug", { p_branch_id: a.branchId, p_slug: "-mal-" });
  check("liga inválida → mensaje", badSlug.error?.message === "La liga solo lleva letras, números y guiones (3 a 40).", badSlug.error);
  const docs = [
    { scope: "business", collection: "bpos_business_settings", record_id: "__doc__", data: { businessName: "Burger Planet Prueba", brandColor: "#ff0000" } },
    { scope: a.branchId, collection: "bpos_digital_menu", record_id: "__doc__", data: { enabled: true, acceptOrders: true, googleReviewUrl: "https://g.page/x", reservations: { enabled: true, maxPeople: 8 } } },
    { scope: "business", collection: "bpos_products", record_id: "1", data: { id: 1, name: "Burger", price: 99, category: "Burgers", stockItemId: 50 } },
    { scope: "business", collection: "bpos_products", record_id: "2", data: { id: 2, name: "Papas", price: 45, category: "Extras", brandId: "b9" } },
    { scope: "business", collection: "bpos_brands", record_id: "b9", data: { id: "b9", appsOnly: true } },
    { scope: a.branchId, collection: "bpos_inventory", record_id: "50", data: { id: 50, stock: 0 } },
    { scope: a.branchId, collection: "bpos_orders", record_id: "1", data: { id: 1, createdAt: new Date().toISOString(), items: [{ id: 1, quantity: 3 }, { id: 2, quantity: 1 }] } },
    { scope: a.branchId, collection: "bpos_orders", record_id: "2", data: { id: 2, createdAt: new Date().toISOString(), cancelled: true, items: [{ id: 2, quantity: 9 }] } },
    { scope: "business", collection: "bpos_coupons", record_id: "c1", data: { code: "HOLA10", active: true, online: true, kind: "percent", value: 10, maxDiscount: 15 } },
    { scope: "business", collection: "bpos_loyalty", record_id: "__doc__", data: { enabled: true, kind: "puntos", pesosPerPoint: 10 } },
  ].map((d) => ({ business_id: a.businessId, deleted: false, ...d }));
  const put = await sa.from("sync_records").upsert(docs);
  check("datos del negocio", !put.error, put.error);

  const pub = await anon.rpc("bpos_menu_public", { p_slug: "burger-prueba" });
  const menu = pub.data as { business: { name: string; color: string }; products: { id: number; soldOut: boolean; notSoldAlone: boolean }[]; top: { id: number; qty: number }[]; menu: { enabled: boolean } };
  check("menú público sin sesión", !pub.error && menu?.business.name === "Burger Planet Prueba" && menu.business.color === "#ff0000", pub.error || menu?.business);
  check("productos con agotado por existencia", menu?.products.find((p) => p.id === 1)?.soldOut === true);
  check("marca solo de apps no se vende sola", menu?.products.find((p) => p.id === 2)?.notSoldAlone === true);
  check("los más pedidos (sin cancelados)", menu?.top[0]?.id === 1 && menu.top[0].qty === 3 && menu.top.find((t) => t.id === 2)?.qty === 1, menu?.top);
  check("menú inexistente → null", (await anon.rpc("bpos_menu_public", { p_slug: "nada" })).data === null);

  const placed = await anon.rpc("bpos_menu_place_order", { p_slug: "burger-prueba", p_order: { type: "Recoger", customer: { name: "Ana", phone: "8711234567" }, lines: [{ productId: 1, quantity: 1 }], total: 99 } });
  const p = placed.data as { id: string; token: string; folio: string };
  check("pedido en línea sin sesión", !placed.error && /^[A-Z0-9]{4}$/.test(p?.folio || "") && p.token.length === 32, placed.error || p);
  const empty = await anon.rpc("bpos_menu_place_order", { p_slug: "burger-prueba", p_order: { customer: { name: "Ana" }, lines: [] } });
  check("pedido vacío → mensaje", empty.error?.message === "Tu pedido está vacío.");
  const st = await anon.rpc("bpos_menu_order_status", { p_id: p.id, p_token: p.token });
  check("seguimiento con su llave", (st.data as { status: string })?.status === "nuevo" && (st.data as { branch: string }).branch === "Centro", st.data);
  check("sin llave no se ve", (await anon.rpc("bpos_menu_order_status", { p_id: p.id, p_token: "x" })).data === null);
  const claim1 = await sa.rpc("bpos_online_claim", { p_id: p.id });
  const claim2 = await sa.rpc("bpos_online_claim", { p_id: p.id });
  check("tomar el pedido: solo una vez", claim1.data === true && claim2.data === false, [claim1.data, claim2.data]);
  const early = await anon.rpc("bpos_menu_review", { p_id: p.id, p_token: p.token, p_stars: 5, p_comment: "x" });
  check("no se califica antes de recibirlo", early.error?.message === "Podrás calificar cuando recibas tu pedido.");
  await svc.from("bpos_online_orders").update({ status: "entregado" }).eq("id", p.id);
  const rev = await anon.rpc("bpos_menu_review", { p_id: p.id, p_token: p.token, p_stars: 5, p_comment: "¡Rico!" });
  check("opinión de 5 estrellas con liga de Google", (rev.data as { google: string })?.google === "https://g.page/x", rev);
  const rev2 = await anon.rpc("bpos_menu_review", { p_id: p.id, p_token: p.token, p_stars: 2, p_comment: "Frío" });
  check("cambia su opinión (2 estrellas, sin Google)", (rev2.data as { stars: number; google: string })?.stars === 2 && (rev2.data as { google: string }).google === "");

  const coupon = await anon.rpc("bpos_menu_coupon", { p_slug: "burger-prueba", p_code: "hola10", p_subtotal: 200 });
  check("cupón 10% con tope $15", (coupon.data as { discount: number })?.discount === 15, coupon);
  const noCoupon = await anon.rpc("bpos_menu_coupon", { p_slug: "burger-prueba", p_code: "NADA", p_subtotal: 200 });
  check("cupón que no existe → mensaje", noCoupon.error?.message === "Ese cupón no existe.");

  const at = new Date(Date.now() + 2 * 3600e3).toISOString();
  const res = await anon.rpc("bpos_menu_reserve", { p_slug: "burger-prueba", p_reservation: { name: "Luis", phone: "871 123 4567", people: 4, at } });
  const r = res.data as { id: string; token: string };
  check("reservación", !res.error && Boolean(r?.token), res.error);
  const tooMany = await anon.rpc("bpos_menu_reserve", { p_slug: "burger-prueba", p_reservation: { name: "Luis", phone: "8711234567", people: 20, at } });
  check("más personas de las permitidas → mensaje", tooMany.error?.message === "Reservamos mesas de 1 a 8 personas. Para más, escríbenos por WhatsApp.", tooMany.error?.message);
  check("estado de la reservación", (await anon.rpc("bpos_menu_reservation_status", { p_id: r.id, p_token: r.token })).data?.status === "nueva");
  check("cancelar reservación", (await anon.rpc("bpos_menu_reservation_cancel", { p_id: r.id, p_token: r.token })).data === true);

  // ---------------------------------------------------------------- club
  const acc = crypto.randomUUID();
  await h.db.batch([
    { sql: "INSERT INTO bpos_customer_accounts (id, business_id, phone, name, email_verified_at, created_at, updated_at) VALUES (?, ?, '8711234567', 'Ana', ?, ?, ?)", params: [acc, a.businessId, new Date().toISOString(), new Date().toISOString(), new Date().toISOString()] },
    { sql: "INSERT INTO bpos_loyalty_members (account_id, business_id, code, joined_at, updated_at) VALUES (?, ?, 'BP1234', ?, ?)", params: [acc, a.businessId, new Date().toISOString(), new Date().toISOString()] },
  ]);
  const found = await sa.rpc("bpos_loyalty_find", { p_query: "BP1234" });
  check("buscar socio por código de tarjeta", (found.data as { account_id: string; member: boolean }[])?.[0]?.member === true, found);
  const byPhone = await sa.rpc("bpos_loyalty_find", { p_query: "(871) 123-4567" });
  check("buscar socio por teléfono", (byPhone.data as unknown[])?.length === 1);
  const earn = await sa.rpc("bpos_loyalty_earn", { p_account: acc, p_amount: 250, p_ref: "venta:1", p_by: "Caja" });
  check("suma 25 puntos por $250", (earn.data as { points: number })?.points === 25, earn);
  const earn2 = await sa.rpc("bpos_loyalty_earn", { p_account: acc, p_amount: 250, p_ref: "venta:1" });
  check("la misma venta no suma dos veces", (earn2.data as { repeated: boolean })?.repeated === true);
  const redeem = await sa.rpc("bpos_loyalty_redeem", { p_account: acc, p_points: 20, p_stamps: 0, p_cashback: 0, p_note: "Papas gratis" });
  check("canje", (redeem.data as { points: number })?.points === 5, redeem);
  const tooMuch = await sa.rpc("bpos_loyalty_redeem", { p_account: acc, p_points: 20, p_stamps: 0, p_cashback: 0, p_note: "x" });
  check("no canjea más de lo que tiene", /No le alcanza/.test(tooMuch.error?.message || ""), tooMuch.error);

  // ---------------------------------------------------------------- Agent
  const code = await sa.rpc("bpos_agent_new_code", { p_branch_id: a.branchId });
  const c = code.data as { code: string };
  check("código para vincular el Agent", /^[A-Z0-9]{8}$/.test(c?.code || ""), code);
  const paired = await anon.rpc("bpos_agent_pair", { p_code: c.code.toLowerCase(), p_name: "Caja 1", p_version: "2.0.24" });
  const token = (paired.data as { token: string; business_name: string })?.token;
  check("vincular con el código", Boolean(token) && (paired.data as { business_name: string }).business_name === "Burger Prueba", paired);
  const again = await anon.rpc("bpos_agent_pair", { p_code: c.code });
  check("el código no sirve dos veces", again.error?.message === "Código inválido o vencido");
  const job = await sa.from("bpos_agent_jobs").insert({ business_id: a.businessId, branch_id: a.branchId, kind: "print", payload: { text: "hola" } }).select("id").single();
  check("la caja deja un trabajo", !job.error, job.error);
  const poll = await anon.rpc("bpos_agent_poll", { p_token: token, p_version: "2.0.25", p_printers: [{ name: "EPSON" }] });
  const jobs = (poll.data as { jobs: { id: number; kind: string; payload: { text: string } }[] })?.jobs;
  check("el Agent toma el trabajo", jobs?.length === 1 && jobs[0].payload.text === "hola", poll);
  const poll2 = await anon.rpc("bpos_agent_poll", { p_token: token });
  check("no lo toma dos veces", (poll2.data as { jobs: unknown[] }).jobs.length === 0);
  await anon.rpc("bpos_agent_finish", { p_token: token, p_job_id: jobs[0].id, p_ok: true, p_result: { printed: true } });
  const { data: finished } = await sa.from("bpos_agent_jobs").select("status, result").eq("id", jobs[0].id).single();
  check("trabajo terminado", finished?.status === "done" && (finished.result as { printed: boolean }).printed === true, finished);
  const { data: agentRow } = await sa.from("bpos_agents").select("version, printers").single();
  check("versión e impresoras del Agent al día", agentRow?.version === "2.0.25" && (agentRow.printers as { name: string }[])[0]?.name === "EPSON", agentRow);
  check("token malo → Agent desvinculado", (await anon.rpc("bpos_agent_poll", { p_token: "x" })).error?.message === "Agent desvinculado");
  const s1 = await anon.rpc("bpos_agent_submit_order", { p_token: token, p_order: { platform: "DiDi", orderId: "1", total: 129, items: [{ name: "Burger" }] } });
  const s2 = await anon.rpc("bpos_agent_submit_order", { p_token: token, p_order: { platform: "didi", orderId: "1", total: 129, items: [{ name: "Burger" }] } });
  check("pedido de DiDi y su reimpresión (duplicado)", (s1.data as { duplicate: boolean }).duplicate === false && (s2.data as { duplicate: boolean }).duplicate === true, [s1, s2]);
  const { data: bo } = await sa.from("bpos_bridge_orders").select("order_key, data").eq("order_key", "didi|1").single();
  check("guardado con su llave y hora de llegada", (bo?.data as { bridgeReceivedAt: string; platform: string })?.platform === "didi" && Boolean((bo?.data as { bridgeReceivedAt: string }).bridgeReceivedAt));
  // Pasando la medianoche: se simula que el anterior llegó ayer
  await h.db.run("UPDATE bpos_bridge_orders SET received_at = ? WHERE order_key = 'didi|1'", [new Date(Date.now() - 26 * 3600e3).toISOString()]);
  const s3 = await anon.rpc("bpos_agent_submit_order", { p_token: token, p_order: { platform: "didi", orderId: "1", total: 300 } });
  const { data: keys } = await sa.from("bpos_bridge_orders").select("order_key").like("order_key", "didi|1*");
  check("DiDi #1 de otro día no es duplicado: llave aparte", (s3.data as { duplicate: boolean }).duplicate === false && keys?.length === 2 && keys.some((k) => /^didi\|1\|\d{12}$/.test(k.order_key)), keys);
  const imp = await anon.rpc("bpos_agent_import", { p_token: token, p_aliases: [{ id: "al1", externalName: "Combo" }], p_orders: [{ platform: "uber", orderId: "abc" }, { platform: "", orderId: "x" }] });
  check("importar equivalencias y pedidos", (imp.data as { aliases: number; orders: number }).aliases === 1 && (imp.data as { orders: number }).orders === 1, imp);

  // ---------------------------------------------------------------- IA, alta y admin
  const allow = await sa.rpc("bpos_ai_allowance", { p_business_id: a.businessId });
  check("presupuesto de IA (prueba activa)", (allow.data as { active: boolean; plan: string })?.active === true && (allow.data as { plan: string }).plan === "basic", allow);
  await sa.rpc("bpos_ai_charge", { p_business_id: a.businessId, p_cost: 0.5 });
  check("cargo de IA sumado", (await sa.rpc("bpos_ai_allowance", { p_business_id: a.businessId })).data?.spent === 0.5);
  const day = new Date().toISOString().slice(0, 10);
  const spend = await svc.rpc("bpos_ai_credits_spend", { p_business_id: a.businessId, p_day: day, p_cost: 5, p_limit: 8 });
  const spend2 = await svc.rpc("bpos_ai_credits_spend", { p_business_id: a.businessId, p_day: day, p_cost: 5, p_limit: 8 });
  check("créditos: el segundo pasa del límite (-1)", spend.data === 5 && spend2.data === -1, [spend.data, spend2.data]);
  check("créditos solo desde el servidor", Boolean((await sa.rpc("bpos_ai_credits_spend", { p_business_id: a.businessId, p_day: day, p_cost: 1, p_limit: 8 })).error));

  await svc.auth.admin.createUser({ email: "nuevo@prueba.mx", password: "nuevo1234", email_confirm: true });
  const sn = await h.signIn("nuevo@prueba.mx", "nuevo1234");
  const created = await sn.rpc("create_business", { p_business_name: "Tiendita", p_branch_name: "" });
  const cb = created.data as { business_id: string; branch_id: string };
  check("alta de negocio con su sucursal Matriz", Boolean(cb?.business_id), created.error);
  const { data: nb } = await sn.from("businesses").select("plan, plan_status").eq("id", cb.business_id).single();
  check("empieza en prueba", nb?.plan === "basic" && nb?.plan_status === "trial", nb);
  check("no es administrador", (await sn.rpc("is_platform_admin")).data === false);
  check("panel de admin solo para el admin", (await sn.rpc("bpos_admin_businesses")).error?.message === "Solo el administrador de B-POS");
  await h.db.run("INSERT INTO platform_admins (user_id, created_at) VALUES (?, ?)", [a.uid, new Date().toISOString()]);
  const list = await sa.rpc("bpos_admin_businesses");
  check("el admin ve los negocios con el correo del dueño", (list.data as { name: string; owner_email: string }[])?.some((b) => b.name === "Tiendita" && b.owner_email === "nuevo@prueba.mx"), list.error || list.data);
  await sa.rpc("bpos_admin_update_business", { p_business_id: cb.business_id, p_plan: "pro", p_status: "active", p_trial_ends_at: null, p_paid_until: null, p_branches_paid: 2, p_ai_budget_usd: null });
  const { data: upd } = await svc.from("businesses").select("plan, plan_status, branches_paid").eq("id", cb.business_id).single();
  check("el admin cambia el plan", upd?.plan === "pro" && upd?.plan_status === "active" && upd?.branches_paid === 2, upd);

  await svc.from("bpos_task_evidence").insert({ token: "tk1", business_id: a.businessId, items: [{ text: "Limpiar" }, { text: "Barrer" }] });
  const item = await anon.rpc("bpos_task_evidence_item", { p_token: "tk1", p_index: 1, p_patch: { done: true } });
  check("tarea con foto: marcar un renglón", (item.data as { done?: boolean }[])?.[1]?.done === true, item);

  done();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
