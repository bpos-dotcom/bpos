"use client";
/**
 * Configuración → Menú digital: la liga pública de la sucursal
 * (bpos.com.mx/m/<liga>), cómo recibe pedidos (recoger, domicilio, mesa con
 * QR), su horario, y qué productos se ven: ocultar o marcar "Agotado" (solo
 * hoy o hasta que se vuelva a activar).
 */
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import type { Product } from "@/data/products";
import { getAdminProducts } from "@/lib/admin";
import { agentScope } from "@/lib/agent/client";
import { getBusinessSettings } from "@/lib/business-settings";
import {
  DIGITAL_MENU_EVENT,
  SLUG_RE,
  endOfToday,
  getDigitalMenu,
  isSoldOut,
  saveDigitalMenu,
  suggestSlug,
  ONLINE_PAYMENTS,
  type DigitalMenuSettings,
} from "@/lib/digital-menu";
import { PUSH_SERVER as PUBLIC_SITE } from "@/lib/push/rules";
import { DAY_SHORT } from "@/lib/sale-schedule";
import { getSupabase } from "@/lib/supabase/client";
import { MenuDesignEditor } from "@/components/menu/MenuDesignEditor";

const card = "rounded-3xl border border-zinc-800 bg-zinc-950 p-6";
const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";
const label = "block text-sm font-bold text-zinc-300";

function Switch({ checked, onChange, text, hint }: { checked: boolean; onChange: (v: boolean) => void; text: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-zinc-800 bg-black p-4">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-5 w-5 accent-orange-500" />
      <span>
        <span className="font-black">{text}</span>
        {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
      </span>
    </label>
  );
}

export default function MenuDigitalPage() {
  const [menu, setMenu] = useState<DigitalMenuSettings>(() => getDigitalMenu());
  const [products, setProducts] = useState<Product[]>([]);
  const [slugDraft, setSlugDraft] = useState("");
  const [slugMsg, setSlugMsg] = useState("");
  const [savingSlug, setSavingSlug] = useState(false);
  const [qr, setQr] = useState("");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const sync = () => setMenu(getDigitalMenu());
    // eslint-disable-next-line react-hooks/set-state-in-effect -- datos del navegador: solo después de montar
    setProducts(getAdminProducts().filter((p) => !p.notSoldAlone));
    const m = getDigitalMenu();
    setSlugDraft(m.slug || suggestSlug(getBusinessSettings().businessName));
    window.addEventListener(DIGITAL_MENU_EVENT, sync);
    window.addEventListener("storage", sync);
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      window.removeEventListener(DIGITAL_MENU_EVENT, sync);
      window.removeEventListener("storage", sync);
      clearInterval(timer);
    };
  }, []);

  const link = menu.slug ? `${PUBLIC_SITE}/m/${menu.slug}` : "";

  useEffect(() => {
    if (!link) return;
    void QRCode.toDataURL(link, { margin: 1, width: 360 }).then(setQr);
  }, [link]);

  function update(patch: Partial<DigitalMenuSettings>) {
    setMenu(saveDigitalMenu(patch));
  }

  async function saveSlug() {
    const slug = slugDraft.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      setSlugMsg("Usa solo letras minúsculas, números y guiones (3 a 40). Ej. burger-planet");
      return;
    }
    setSavingSlug(true);
    setSlugMsg("");
    try {
      const { branchId } = await agentScope();
      const { data, error } = await getSupabase().rpc("bpos_menu_set_slug", { p_branch_id: branchId, p_slug: slug });
      if (error) throw new Error(error.message);
      update({ slug: String(data), enabled: true });
      setSlugMsg("✅ Liga guardada. Tu menú ya está en internet.");
    } catch (e) {
      setSlugMsg(e instanceof Error ? e.message : "No se pudo guardar la liga.");
    } finally {
      setSavingSlug(false);
    }
  }

  function setSoldOut(product: Product, mode: "today" | "forever" | "available") {
    const soldOut = { ...menu.soldOut };
    if (mode === "available") delete soldOut[String(product.id)];
    else soldOut[String(product.id)] = { until: mode === "today" ? endOfToday() : null, at: new Date().toISOString() };
    update({ soldOut });
  }

  function toggleHidden(product: Product) {
    const id = Number(product.id);
    update({ hidden: menu.hidden.includes(id) ? menu.hidden.filter((h) => h !== id) : [...menu.hidden, id] });
  }

  const byCategory = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, Product[]>();
    products
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
      .forEach((p) => map.set(p.category || "Sin categoría", [...(map.get(p.category || "Sin categoría") || []), p]));
    return [...map.entries()];
  }, [products, search]);

  const soldOutCount = products.filter((p) => isSoldOut(menu, p.id, now)).length;
  const hours = menu.hours || { days: [], from: "", to: "" };

  async function printTableQrs() {
    if (!link || menu.tables < 1) return;
    const codes = await Promise.all(
      Array.from({ length: menu.tables }, (_, i) => QRCode.toDataURL(`${link}?mesa=${i + 1}`, { margin: 1, width: 300 }))
    );
    const name = getBusinessSettings().businessName;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR de mesas</title><style>
      body{font-family:Arial,sans-serif;margin:0;padding:16px} .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
      .qr{border:2px dashed #999;border-radius:16px;padding:12px;text-align:center;break-inside:avoid}
      .qr img{width:100%;max-width:220px} h2{margin:4px 0} p{margin:2px 0;color:#555;font-size:13px}
      @media print{button{display:none}}</style></head><body>
      <button onclick="print()" style="margin-bottom:12px;padding:10px 18px;font-weight:bold">Imprimir</button>
      <div class="grid">${codes
        .map((src, i) => `<div class="qr"><p>${name.replace(/</g, "")}</p><h2>Mesa ${i + 1}</h2><img src="${src}"/><p>Escanea para pedir</p></div>`)
        .join("")}</div></body></html>`);
    w.document.close();
  }

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Menú digital" subtitle="Tu menú en internet: tus clientes ven tus productos y te mandan pedidos sin comisiones.">
        <div className="max-w-5xl space-y-5">
          {/* Liga pública */}
          <section className={card}>
            <h2 className="text-lg font-black">🌐 Tu menú en internet</h2>
            <p className="mt-1 text-sm text-zinc-400">Elige la liga de esta sucursal. Compártela en WhatsApp, Instagram o Facebook, o imprime su QR.</p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className={`${label} min-w-64 flex-1`}>
                Liga
                <div className="mt-1 flex items-center rounded-2xl border border-zinc-800 bg-black pl-4">
                  <span className="text-sm text-zinc-500">bpos.com.mx/m/</span>
                  <input
                    value={slugDraft}
                    onChange={(e) => setSlugDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    maxLength={40}
                    className="min-w-0 flex-1 bg-transparent px-1 py-3 text-white outline-none"
                  />
                </div>
              </label>
              <button onClick={() => void saveSlug()} disabled={savingSlug} className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black disabled:opacity-50">
                {savingSlug ? "Guardando..." : menu.slug ? "Cambiar liga" : "Publicar menú"}
              </button>
            </div>
            {slugMsg && <p className="mt-2 text-sm font-bold text-zinc-300">{slugMsg}</p>}

            {link && (
              <div className="mt-5 flex flex-wrap items-center gap-5 rounded-2xl border border-zinc-800 bg-black p-4">
                {/* eslint-disable-next-line @next/next/no-img-element -- QR generado aquí */}
                {qr && <img src={qr} alt="QR del menú" className="h-32 w-32 rounded-xl bg-white p-1" />}
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="break-all font-mono text-orange-300">{link}</p>
                  <div className="flex flex-wrap gap-2">
                    <a href={link} target="_blank" rel="noreferrer" className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-black hover:border-orange-500">
                      Abrir menú
                    </a>
                    <button onClick={() => void navigator.clipboard.writeText(link)} className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-black hover:border-orange-500">
                      Copiar liga
                    </button>
                    {qr && (
                      <a href={qr} download={`menu-${menu.slug}.png`} className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-black hover:border-orange-500">
                        Descargar QR
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Switch checked={menu.enabled} onChange={(v) => update({ enabled: v })} text="Menú publicado" hint="Apagado, la liga muestra que el menú no está disponible." />
              <Switch checked={menu.acceptOrders} onChange={(v) => update({ acceptOrders: v })} text="Recibir pedidos" hint="Apagado, tus clientes solo ven el menú (sin pedir)." />
            </div>
          </section>

          {/* Cómo recibe pedidos */}
          <section className={card}>
            <h2 className="text-lg font-black">🛍️ Pedidos</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Switch checked={menu.pickup} onChange={(v) => update({ pickup: v })} text="Para recoger" />
              <Switch checked={menu.delivery} onChange={(v) => update({ delivery: v })} text="A domicilio" />
              <Switch checked={menu.autoAccept} onChange={(v) => update({ autoAccept: v })} text="Aceptar solos" hint="Entran directo a Cocina si hay caja abierta." />
              <Switch
                checked={menu.whatsappNotify}
                onChange={(v) => update({ whatsappNotify: v })}
                text="Avisar por WhatsApp"
                hint="Al aceptar, marcar listo, en camino o entregado se abre WhatsApp con el mensaje para el cliente. Gratis."
              />
            </div>
            <div className="mt-4 rounded-2xl border border-zinc-800 bg-black p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={menu.scheduling.enabled} onChange={(e) => update({ scheduling: { ...menu.scheduling, enabled: e.target.checked } })} className="mt-1 h-5 w-5 accent-orange-500" />
                <span>
                  <span className="font-black">📅 Pedidos programados</span>
                  <span className="mt-1 block text-xs text-zinc-500">Tus clientes con cuenta eligen día y hora. Sin cuenta se les invita a registrarse. B-POS los manda solos a cocina antes de la hora (con caja abierta).</span>
                </span>
              </label>
              {menu.scheduling.enabled && (
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <label className={label}>
                    Mínimo de anticipación (horas)
                    <input type="number" min={0.25} step={0.25} value={menu.scheduling.minMinutes / 60} onChange={(e) => update({ scheduling: { ...menu.scheduling, minMinutes: Math.round((Number(e.target.value) || 1) * 60) } })} className={`${input} mt-1`} />
                  </label>
                  <label className={label}>
                    Máximo de días antes
                    <input type="number" min={0} max={14} value={menu.scheduling.maxDays} onChange={(e) => update({ scheduling: { ...menu.scheduling, maxDays: Number(e.target.value) || 0 } })} className={`${input} mt-1`} />
                  </label>
                  <label className={label}>
                    Mandar a cocina (min antes)
                    <input type="number" min={5} max={180} value={menu.scheduling.leadMinutes} onChange={(e) => update({ scheduling: { ...menu.scheduling, leadMinutes: Number(e.target.value) || 30 } })} className={`${input} mt-1`} />
                  </label>
                </div>
              )}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <label className={label}>
                Costo de envío $
                <input type="number" min={0} value={menu.deliveryFee || ""} onChange={(e) => update({ deliveryFee: Number(e.target.value) || 0 })} className={`${input} mt-1`} disabled={!menu.delivery} />
              </label>
              <label className={label}>
                Pedido mínimo $
                <input type="number" min={0} value={menu.minOrder || ""} onChange={(e) => update({ minOrder: Number(e.target.value) || 0 })} className={`${input} mt-1`} />
              </label>
              <label className={label}>
                Tiempo de preparación (min)
                <input type="number" min={5} value={menu.prepMinutes} onChange={(e) => update({ prepMinutes: Number(e.target.value) || 20 })} className={`${input} mt-1`} />
              </label>
              <label className={label}>
                Mesas con QR
                <input type="number" min={0} max={200} value={menu.tables || ""} onChange={(e) => update({ tables: Number(e.target.value) || 0 })} className={`${input} mt-1`} />
              </label>
            </div>
            {menu.tables > 0 && link && (
              <button onClick={() => void printTableQrs()} className="mt-3 rounded-2xl border border-orange-500 px-4 py-2 text-sm font-black text-orange-300">
                🖨️ Imprimir QR de {menu.tables} mesa{menu.tables === 1 ? "" : "s"}
              </button>
            )}

            <p className="mt-5 text-sm font-bold text-zinc-300">Formas de pago según el tipo de pedido (el cliente paga al recoger, al recibir o en la mesa):</p>
            <div className="mt-2 overflow-x-auto rounded-2xl border border-zinc-800">
              <table className="w-full text-sm">
                <thead className="bg-black text-zinc-400">
                  <tr>
                    <th className="px-4 py-2 text-left">Tipo</th>
                    {ONLINE_PAYMENTS.map((p) => (
                      <th key={p} className="px-4 py-2">{p}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(["Recoger", "Domicilio", "Mesa"] as const).map((type) => (
                    <tr key={type} className="border-t border-zinc-800">
                      <td className="px-4 py-3 font-black">{type === "Recoger" ? "🛍️ Para recoger" : type === "Domicilio" ? "🛵 A domicilio" : "🍽️ En mesa (QR)"}</td>
                      {ONLINE_PAYMENTS.map((p) => {
                        const on = menu.paymentsByType[type].includes(p);
                        return (
                          <td key={p} className="px-4 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() =>
                                update({ paymentsByType: { ...menu.paymentsByType, [type]: on ? menu.paymentsByType[type].filter((x) => x !== p) : [...menu.paymentsByType[type], p] } })
                              }
                              className="h-5 w-5 accent-orange-500"
                              aria-label={`${p} en ${type}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-zinc-500">Mercado Pago en línea se agrega aquí cuando activemos el cobro en línea. Transferencia necesita tu CLABE y WhatsApp abajo.</p>

            <p className="mt-5 text-sm font-bold text-zinc-300">Horario para recibir pedidos (vacío = siempre)</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {DAY_SHORT.map((d, i) => {
                const on = hours.days.length === 0 || hours.days.includes(i);
                return (
                  <button
                    key={d}
                    onClick={() => {
                      const all = hours.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : hours.days;
                      const days = on ? all.filter((x) => x !== i) : [...all, i];
                      update({ hours: { ...hours, days } });
                    }}
                    className={`rounded-xl border px-3 py-2 text-sm font-black ${on ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-700 text-zinc-400"}`}
                  >
                    {d}
                  </button>
                );
              })}
              <input type="time" value={hours.from} onChange={(e) => update({ hours: { ...hours, from: e.target.value } })} className="rounded-xl border border-zinc-800 bg-black px-3 py-2" />
              <span className="text-zinc-500">a</span>
              <input type="time" value={hours.to} onChange={(e) => update({ hours: { ...hours, to: e.target.value } })} className="rounded-xl border border-zinc-800 bg-black px-3 py-2" />
            </div>

            <label className={`${label} mt-5`}>
              Aviso arriba del menú (opcional)
              <input value={menu.notice} maxLength={200} onChange={(e) => update({ notice: e.target.value })} placeholder="Ej. Martes 2x1 en papas" className={`${input} mt-1`} />
            </label>
          </section>

          {/* WhatsApp y transferencia */}
          <section className={card}>
            <h2 className="text-lg font-black">💬 WhatsApp y transferencia</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Cuando el cliente paga por transferencia, ve estos datos y se abre WhatsApp con el desglose de su pedido para mandarte el comprobante a este número.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className={label}>
                WhatsApp del negocio (10 dígitos)
                <input
                  value={menu.whatsapp}
                  inputMode="tel"
                  maxLength={13}
                  placeholder={getBusinessSettings().ownerWhatsapp.slice(-10) || "8711234567"}
                  onChange={(e) => update({ whatsapp: e.target.value })}
                  className={`${input} mt-1`}
                />
              </label>
              <label className={label}>
                Banco
                <input value={menu.bank.bank} maxLength={40} placeholder="BBVA" onChange={(e) => update({ bank: { ...menu.bank, bank: e.target.value } })} className={`${input} mt-1`} />
              </label>
              <label className={label}>
                CLABE (18 dígitos)
                <input value={menu.bank.clabe} inputMode="numeric" maxLength={18} onChange={(e) => update({ bank: { ...menu.bank, clabe: e.target.value } })} className={`${input} mt-1 font-mono`} />
              </label>
              <label className={label}>
                Titular de la cuenta
                <input value={menu.bank.holder} maxLength={80} onChange={(e) => update({ bank: { ...menu.bank, holder: e.target.value } })} className={`${input} mt-1`} />
              </label>
            </div>
            {Object.values(menu.paymentsByType).some((l) => l.includes("Transferencia")) && (!menu.whatsapp || menu.bank.clabe.length !== 18) && (
              <p className="mt-3 text-sm font-bold text-yellow-200">Tienes activado el pago por transferencia: completa el WhatsApp y la CLABE.</p>
            )}
          </section>

          {/* Diseño */}
          <section className={card}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">🎨 Diseño del menú</h2>
                <p className="mt-1 text-sm text-zinc-400">Imágenes, textos y botones de tu menú. Se guarda solo; ábrelo para ver cómo queda.</p>
              </div>
              {link && (
                <a href={link} target="_blank" rel="noreferrer" className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm font-black hover:border-orange-500">
                  Ver mi menú ↗
                </a>
              )}
            </div>
            <div className="mt-4">
              <MenuDesignEditor design={menu.design} products={products} onChange={(design) => update({ design })} />
            </div>
          </section>

          {/* Productos */}
          <section className={card}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">🍔 Productos del menú</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Oculta lo que no quieres en internet o márcalo agotado. Lo agotado desaparece del menú al instante.
                  {soldOutCount > 0 && <b className="text-red-300"> · {soldOutCount} agotado{soldOutCount === 1 ? "" : "s"}</b>}
                </p>
              </div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto..." className="w-64 rounded-2xl border border-zinc-800 bg-black px-4 py-2" />
            </div>

            <div className="mt-4 space-y-5">
              {byCategory.map(([category, list]) => (
                <div key={category}>
                  <p className="mb-2 text-xs font-black uppercase tracking-wider text-zinc-500">{category}</p>
                  <div className="space-y-2">
                    {list.map((p) => {
                      const hidden = menu.hidden.includes(Number(p.id));
                      const out = isSoldOut(menu, p.id, now);
                      const s = menu.soldOut[String(p.id)];
                      return (
                        <div key={p.id} className={`flex flex-wrap items-center gap-3 rounded-2xl border p-3 ${out ? "border-red-500/50 bg-red-500/5" : "border-zinc-800 bg-black"}`}>
                          <span className="text-2xl">{p.emoji}</span>
                          <div className="min-w-40 flex-1">
                            <p className={`font-black ${hidden ? "text-zinc-500 line-through" : ""}`}>{p.name}</p>
                            <p className="text-xs text-zinc-500">
                              ${Number(p.price).toFixed(2)}
                              {out && <b className="ml-2 text-red-300">{s?.until ? "Agotado hoy" : "Agotado hasta reactivarlo"}</b>}
                              {hidden && <b className="ml-2 text-zinc-400">Oculto</b>}
                            </p>
                          </div>
                          <label className="flex items-center gap-2 text-sm font-bold text-zinc-300">
                            <input type="checkbox" checked={!hidden} onChange={() => toggleHidden(p)} className="h-5 w-5 accent-orange-500" />
                            En el menú
                          </label>
                          {out ? (
                            <button onClick={() => setSoldOut(p, "available")} className="rounded-xl bg-emerald-500 px-3 py-2 text-sm font-black text-black">
                              ✅ Ya hay
                            </button>
                          ) : (
                            <>
                              <button onClick={() => setSoldOut(p, "today")} className="rounded-xl border border-red-500/60 px-3 py-2 text-sm font-black text-red-300 hover:bg-red-500/10">
                                Agotado hoy
                              </button>
                              <button onClick={() => setSoldOut(p, "forever")} className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-black text-zinc-300 hover:border-red-500">
                                Agotado indefinido
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {byCategory.length === 0 && <p className="text-sm text-zinc-500">No hay productos. Agrégalos en Configuración → Productos.</p>}
            </div>
          </section>
        </div>
      </AppShell>
    </RequireRole>
  );
}
