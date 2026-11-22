/**
 * La nube de Cloudflare contesta como Supabase: inicio de sesión, consultas,
 * filtros, embebidos, upsert, reglas de acceso y triggers, probado con el
 * mismo supabase-js que usa B-POS.
 *   npx tsx scripts/test-nube-rest.ts
 */
import { checker, makeHarness, seedBusiness } from "./nube-harness";

const { check, done } = checker();

async function main() {
  const h = await makeHarness();
  const a = await seedBusiness(h, "dueno@prueba.mx", "Burger Prueba");
  const b = await seedBusiness(h, "otro@prueba.mx", "Otro Negocio");

  // ---------------------------------------------------------------- inicio de sesión
  const anon = h.client();
  const bad = await anon.auth.signInWithPassword({ email: "dueno@prueba.mx", password: "mala" });
  check("contraseña mala → error de Supabase", bad.error?.message === "Invalid login credentials", bad.error?.message);
  const sa = await h.signIn("dueno@prueba.mx", "secreta123");
  const { data: me } = await sa.auth.getUser();
  check("getUser trae al dueño", me.user?.id === a.uid && me.user?.email === "dueno@prueba.mx", me.user);
  const { data: sess } = await sa.auth.getSession();
  check("sesión con token y refresh", Boolean(sess.session?.access_token && sess.session?.refresh_token));
  const refreshed = await sa.auth.refreshSession();
  check("refresh da sesión nueva", Boolean(refreshed.data.session?.access_token) && refreshed.data.session?.refresh_token !== sess.session?.refresh_token, refreshed.error?.message);
  const reuse = await h.client().auth.refreshSession({ refresh_token: sess.session!.refresh_token });
  check("el refresh viejo se acepta solo unos segundos (otra pestaña)", !reuse.error, reuse.error?.message);

  // ---------------------------------------------------------------- cuenta (lib/cloud/account.ts)
  const { data: memberships, error: mErr } = await sa.from("business_members").select("business_id, businesses(name)").eq("user_id", a.uid).order("created_at", { ascending: true });
  check("membresías con el nombre del negocio (embebido)", !mErr && memberships?.length === 1 && (memberships[0] as unknown as { businesses: { name: string } }).businesses?.name === "Burger Prueba", mErr || memberships);
  const { data: branches } = await sa.from("branches").select("id, name").eq("business_id", a.businessId).order("created_at", { ascending: true });
  check("sucursales del negocio", branches?.length === 1 && branches[0].id === a.branchId);
  const { data: otherBranches } = await sa.from("branches").select("id").eq("business_id", b.businessId);
  check("no ve sucursales de otro negocio", Array.isArray(otherBranches) && otherBranches.length === 0, otherBranches);

  // ---------------------------------------------------------------- sync_records (lib/cloud/sync.ts)
  const recs = [1, 2, 3].map((i) => ({ business_id: a.businessId, scope: "business", collection: "bpos_products", record_id: String(i), data: { id: i, name: `P${i}`, price: 10 * i }, deleted: false, updated_by: "dev1" }));
  const up = await sa.from("sync_records").upsert(recs, { onConflict: "business_id,scope,collection,record_id" }).select("record_id, seq");
  check("upsert de 3 registros", !up.error && up.data?.length === 3, up.error);
  const seqs = (up.data || []).map((r) => Number(r.seq));
  check("cada uno con número (seq) creciente", seqs.length === 3 && seqs[0] < seqs[1] && seqs[1] < seqs[2], seqs);
  check("se avisó el último número del negocio", h.heads.at(-1)?.businessId === a.businessId && h.heads.at(-1)?.seq === seqs[2], h.heads);
  const { data: head } = await sa.from("sync_heads").select("seq").eq("business_id", a.businessId).maybeSingle();
  check("sync_heads al día", Number(head?.seq) === seqs[2], head);
  const again = await sa.from("sync_records").upsert([{ ...recs[0], data: { id: 1, name: "P1 nuevo", price: 15 } }], { onConflict: "business_id,scope,collection,record_id" }).select("seq, data");
  check("upsert de uno que ya existe: lo cambia con número nuevo", Number(again.data?.[0]?.seq) > seqs[2] && (again.data?.[0]?.data as { name: string }).name === "P1 nuevo", again);
  const { data: since } = await sa.from("sync_records").select("record_id, seq, data, deleted").eq("business_id", a.businessId).gt("seq", seqs[0]).order("seq", { ascending: true }).limit(1000);
  check("cambios desde un número (pull)", since?.map((r) => r.record_id).join() === "2,3,1", since?.map((r) => r.record_id));
  check("data regresa como objeto y deleted como bool", typeof since?.[0]?.data === "object" && since?.[0]?.deleted === false);
  const otherWrite = await sa.from("sync_records").upsert([{ ...recs[0], business_id: b.businessId }]);
  check("no puede escribir en otro negocio", otherWrite.error?.code === "42501", otherWrite.error);
  const badScope = await sa.from("sync_records").upsert([{ ...recs[0], scope: b.branchId, record_id: "x" }]);
  check("ni en una sucursal de otro negocio", badScope.error?.code === "42501", badScope.error);
  const branchRec = await sa.from("sync_records").upsert([{ ...recs[0], scope: a.branchId, collection: "bpos_digital_menu", record_id: "__doc__" }]);
  check("sí en su propia sucursal", !branchRec.error, branchRec.error);

  // ventas: no se borran ni se descobra una cobrada
  const sale = { business_id: a.businessId, scope: a.branchId, collection: "bpos_orders", record_id: "77", data: { id: 77, total: 100, pendingPayment: false, paidAt: "2026-11-21T20:00:00Z", details: { paymentMethod: "Efectivo" } }, deleted: false };
  await sa.from("sync_records").upsert([sale]);
  await sa.from("sync_records").upsert([{ ...sale, data: { id: 77, total: 100, pendingPayment: true, details: { paymentMethod: "" } } }]);
  const { data: kept } = await sa.from("sync_records").select("data").eq("record_id", "77").single();
  const kd = kept?.data as { pendingPayment: boolean; paidAt?: string; details: { paymentMethod: string } };
  check("una venta cobrada no regresa a 'en espera'", kd?.pendingPayment === false && kd?.paidAt === "2026-11-21T20:00:00Z" && kd?.details.paymentMethod === "Efectivo", kd);
  await sa.from("sync_records").upsert([{ ...sale, deleted: true, data: null }]);
  const del = await sa.from("sync_records").delete().eq("record_id", "77");
  const { data: still } = await sa.from("sync_records").select("deleted, data").eq("record_id", "77").maybeSingle();
  check("una venta no se borra ni se marca como borrada", !del.error && still?.deleted === false && Boolean(still?.data), still);

  // ---------------------------------------------------------------- Bridge (lib/bridge/store.ts)
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const orders = [
    { business_id: a.businessId, branch_id: a.branchId, order_key: "didi|1", data: { platform: "didi", orderId: "1", total: 129 }, status: "Finalizado", received_at: iso(now - 3600e3), updated_at: iso(now - 3600e3) },
    { business_id: a.businessId, branch_id: a.branchId, order_key: "didi|1|202611220030", data: { platform: "didi", orderId: "1", bridgeKey: "didi|1|202611220030" }, status: "Recibido", received_at: iso(now - 60e3), updated_at: iso(now - 60e3) },
    { business_id: a.businessId, branch_id: a.branchId, order_key: "uber|7FD5A", data: { platform: "uber", orderId: "7FD5A", processingBy: "pc1", processingAt: iso(now - 600e3) }, status: "Recibido", received_at: iso(now - 30e3), updated_at: iso(now - 30e3) },
  ];
  const ins = await sa.from("bpos_bridge_orders").insert(orders);
  check("pedidos del Bridge guardados", !ins.error, ins.error);
  const { data: latest } = await sa.from("bpos_bridge_orders").select("order_key, received_at").eq("branch_id", a.branchId).or('order_key.eq."didi|1",order_key.like."didi|1|*"').order("received_at", { ascending: false }).limit(1);
  check("or con like (número repetido de DiDi)", latest?.[0]?.order_key === "didi|1|202611220030", latest);
  const { data: active } = await sa.from("bpos_bridge_orders").select("data").eq("branch_id", a.branchId).neq("status", "Finalizado").order("received_at", { ascending: false }).limit(150);
  check("en proceso (neq)", active?.length === 2);
  const { data: work } = await sa.from("bpos_bridge_orders").select("data").eq("branch_id", a.branchId).not("status", "in", "(Finalizado,Error)");
  check("not in", work?.length === 2);
  const { data: unprinted } = await sa.from("bpos_bridge_orders").select("order_key").eq("status", "Finalizado").is("data->stationPrint", null);
  check("is null dentro del JSON", unprinted?.length === 1, unprinted);
  const cutoff = iso(now - 120e3);
  const { data: claimed } = await sa
    .from("bpos_bridge_orders")
    .update({ data: { ...orders[2].data, processingBy: "pc2", processingAt: iso(now) } })
    .eq("branch_id", a.branchId)
    .eq("order_key", "uber|7FD5A")
    .or(`data->>processingBy.is.null,data->>processingBy.eq."pc2",data->>processingAt.lt."${cutoff}"`)
    .select("order_key");
  check("apartar con or sobre el JSON (apartado viejo)", claimed?.length === 1, claimed);
  const { data: notClaimed } = await sa
    .from("bpos_bridge_orders")
    .update({ data: { processingBy: "pc3" } })
    .eq("order_key", "uber|7FD5A")
    .or(`data->>processingBy.is.null,data->>processingBy.eq."pc3",data->>processingAt.lt."${cutoff}"`)
    .select("order_key");
  check("otro equipo no lo puede apartar", notClaimed?.length === 0, notClaimed);
  const { count, error: cErr } = await sa.from("bpos_bridge_orders").select("updated_at", { count: "exact", head: true }).eq("branch_id", a.branchId);
  check("conteo exacto (head)", !cErr && count === 3, { count, cErr });
  const { data: one, error: oneErr } = await sa.from("bpos_bridge_orders").select("order_key").eq("order_key", "zzz").single();
  check("single sin filas → error PGRST116", !one && oneErr?.code === "PGRST116", oneErr);
  const { data: none } = await sa.from("bpos_bridge_orders").select("order_key").eq("order_key", "zzz").maybeSingle();
  check("maybeSingle sin filas → null", none === null);

  // ---------------------------------------------------------------- pedidos en línea (lib/online-orders.ts)
  const svc = h.client({ service: true });
  const oid = crypto.randomUUID();
  await svc.from("bpos_online_orders").insert([
    { id: oid, business_id: a.businessId, branch_id: a.branchId, folio: "K7PQ", token: "t1", status: "aceptado", sale_order_id: null, data: { customer: { phone: "8711234567" }, saleLater: { at: iso(now), by: "Dueño" } }, created_at: iso(now - 3 * 86400e3) },
    { business_id: a.businessId, branch_id: a.branchId, folio: "OLD1", token: "t2", status: "entregado", sale_order_id: 5, data: { customer: { phone: "8710000000" } }, created_at: iso(now - 3 * 86400e3) },
    { business_id: a.businessId, branch_id: a.branchId, folio: "NEW1", token: "t3", status: "nuevo", data: { customer: { phone: "8719999999" } } },
  ]);
  const since24 = iso(now - 86400e3);
  const { data: list, error: lErr } = await sa
    .from("bpos_online_orders")
    .select("id, folio, status, data, sale_order_id")
    .eq("branch_id", a.branchId)
    .or(`created_at.gte.${since24},status.in.(nuevo,aceptando),and(status.in.(aceptado,listo,entregado),data->saleLater.not.is.null,or(sale_order_id.is.null,sale_order_id.eq.0))`)
    .order("created_at", { ascending: false })
    .limit(200);
  check("or anidado de Pedidos en línea (aceptado sin caja de hace 3 días sí sale)", !lErr && list?.map((o) => o.folio).sort().join() === "K7PQ,NEW1", lErr || list?.map((o) => o.folio));
  const { count: byPhone } = await sa.from("bpos_online_orders").select("id", { count: "exact", head: true }).neq("status", "rechazado").like("data->customer->>phone", "%1234567");
  check("like sobre un dato del JSON", byPhone === 1, byPhone);
  const grab = await sa.from("bpos_online_orders").update({ sale_order_id: 0, updated_at: iso(now) }).eq("id", oid).or(`sale_order_id.is.null,and(sale_order_id.eq.0,updated_at.lt.${iso(now - 120e3)})`).select("id");
  check("apartar la venta (sale_order_id 0)", grab.data?.length === 1, grab);
  const grab2 = await sa.from("bpos_online_orders").update({ sale_order_id: 0 }).eq("id", oid).or(`sale_order_id.is.null,and(sale_order_id.eq.0,updated_at.lt.${iso(now - 120e3)})`).select("id");
  check("otro equipo no la aparta", grab2.data?.length === 0, grab2);

  // ---------------------------------------------------------------- bitácora y permisos
  const ev = await sa.from("audit_events").insert({ business_id: a.businessId, event_id: "e1", category: "Venta", action: "sale.created", happened_at: iso(now), metadata: { total: 50 } });
  check("bitácora: se puede agregar", !ev.error, ev.error);
  const dup = await sa.from("audit_events").upsert({ business_id: a.businessId, event_id: "e1", category: "Venta", action: "sale.created", happened_at: iso(now) }, { onConflict: "business_id,event_id", ignoreDuplicates: true });
  check("bitácora: repetido se ignora", !dup.error, dup.error);
  const change = await sa.from("audit_events").update({ description: "x" }).eq("event_id", "e1");
  check("bitácora: no se puede cambiar", Boolean(change.error), change.error);
  const sb = await h.signIn("otro@prueba.mx", "secreta123");
  const { data: spy } = await sb.from("audit_events").select("event_id").eq("business_id", a.businessId);
  check("otro negocio no ve la bitácora", spy?.length === 0);
  const anonRead = await anon.from("sync_records").select("record_id").limit(1);
  check("sin sesión no se lee nada", Boolean(anonRead.error), anonRead);
  const { data: catalog, error: catErr } = await anon.from("bpos_service_catalog").select("service");
  check("sin sesión sí se lee el catálogo de servicios", !catErr && Array.isArray(catalog), catErr);
  const plan = await sa.from("businesses").update({ plan: "max", plan_status: "active", name: "Burger Prueba 2" }).eq("id", a.businessId).select("plan, name").single();
  check("el dueño cambia el nombre pero no su plan", plan.data?.plan === "basic" && plan.data?.name === "Burger Prueba 2", plan);

  // ---------------------------------------------------------------- respaldos grandes (a R2)
  const blobMap = new Map<string, Uint8Array>();
  h.deps.blobs = {
    async put(key, value) {
      blobMap.set(key, value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer));
    },
    async get(key) {
      const d = blobMap.get(key);
      return d ? { body: null, arrayBuffer: async () => d.slice().buffer as ArrayBuffer } : null;
    },
    async head(key) {
      return blobMap.has(key) ? {} : null;
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) blobMap.delete(k);
    },
  };
  const big = { businessId: a.businessId, records: Array.from({ length: 5000 }, (_, i) => ({ k: i, v: "x".repeat(500) })) };
  const day = "2026-11-21";
  const bk = await sa.from("bpos_backups").upsert({ business_id: a.businessId, day, data: big, size: JSON.stringify(big).length }, { onConflict: "business_id,day" });
  check("respaldo de 2.5 MB guardado (el contenido va a R2)", !bk.error && blobMap.has(`blobs/bpos_backups/${a.businessId}/${day}.json`), bk.error);
  const { data: listB } = await sa.from("bpos_backups").select("day, size").eq("business_id", a.businessId);
  check("la lista de respaldos no baja el contenido", listB?.length === 1 && listB[0].day === day && !("data" in listB[0]));
  const { data: gotB } = await sa.from("bpos_backups").select("data").eq("business_id", a.businessId).eq("day", day).maybeSingle();
  check("el respaldo regresa completo", (gotB?.data as typeof big)?.records?.length === 5000, (gotB?.data as typeof big)?.records?.length);
  await sa.from("bpos_backups").delete().eq("business_id", a.businessId).in("day", [day]);
  check("al borrarlo se borra de R2", blobMap.size === 0);

  // ---------------------------------------------------------------- admin (servidor)
  const made = await svc.auth.admin.createUser({ email: "mesero@prueba.mx", password: "mesero123", email_confirm: true, user_metadata: { kind: "waiter-device" } });
  check("admin crea usuario", Boolean(made.data.user?.id) && made.data.user?.user_metadata?.kind === "waiter-device", made.error);
  const got = await svc.auth.admin.getUserById(made.data.user!.id);
  check("admin lee usuario", got.data.user?.email === "mesero@prueba.mx");
  const dupUser = await svc.auth.admin.createUser({ email: "mesero@prueba.mx", password: "x123456", email_confirm: true });
  check("correo repetido → error 'already registered'", /already been registered/.test(dupUser.error?.message || ""), dupUser.error?.message);
  const waiter = await h.signIn("mesero@prueba.mx", "mesero123");
  check("el usuario nuevo entra", Boolean((await waiter.auth.getUser()).data.user));
  await svc.auth.admin.deleteUser(made.data.user!.id);
  check("admin lo borra", !(await svc.auth.admin.getUserById(made.data.user!.id)).data.user);
  const nouser = await svc.from("sync_records").select("record_id", { count: "exact", head: true });
  check("el servidor lee todo", (nouser.count || 0) > 3, nouser);

  done();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
