"use client";
/**
 * B-POS Servicios → Mis servicios: lo que el restaurante tiene contratado
 * (prueba, activo, pago pendiente) con su botón para abrirlo, y los demás
 * servicios para probarlos o contratarlos con Mercado Pago.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import RequirePermission from "@/components/auth/RequirePermission";
import { AppShell } from "@/components/layout/AppShell";
import { ask } from "@/components/layout/Dialogs";
import { SERVICES, money, serviceAccess, serviceInfo, type ServiceId } from "@/lib/services";
import { refreshServices, servicesCall, useServicesState } from "@/lib/services-client";
import { getBusinessSettings } from "@/lib/business-settings";

export default function ServicesPanelPage() {
  const state = useServicesState();
  const [busy, setBusy] = useState<string>("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // De regreso de Mercado Pago (?pago=servicio&preapproval_id=...): revisa el pago
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const service = params.get("pago");
    if (!service) {
      void refreshServices(true).catch(() => undefined);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- revisión del pago al volver de Mercado Pago
    setBusy(service);
    servicesCall({ accion: "revisar", servicio: service, preapproval: params.get("preapproval_id") || undefined })
      .then(() => setMessage({ ok: true, text: "✅ Revisamos tu pago. Si todavía no aparece activo, Mercado Pago puede tardar unos minutos." }))
      .catch((e) => setMessage({ ok: false, text: e instanceof Error ? e.message : "No se pudo revisar el pago." }))
      .finally(() => {
        setBusy("");
        window.history.replaceState(null, "", "/servicios");
      });
  }, []);

  async function run(service: ServiceId, accion: "probar" | "contratar" | "cancelar") {
    const info = serviceInfo(service)!;
    if (accion === "cancelar" && !(await ask(`¿Cancelar ${info.name}? Sigue funcionando hasta lo ya pagado.`, { ok: "Cancelar servicio" }))) return;
    setBusy(service);
    setMessage(null);
    try {
      const r = await servicesCall({ accion, servicio: service, email: getBusinessSettings().businessEmail || undefined });
      if (accion === "contratar" && r.url) {
        window.location.assign(r.url);
        return;
      }
      setMessage({ ok: true, text: accion === "probar" ? `✅ ${info.name}: empezó tu prueba gratis.` : `${info.name} quedó cancelado.` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "No se pudo." });
    }
    setBusy("");
  }

  const isServices = state?.kind === "servicios";
  const rows = state?.services || [];
  const entry = (id: ServiceId) => state?.catalog.find((c) => c.service === id);
  const mine = SERVICES.filter((s) => rows.some((r) => r.service === s.id));
  const others = SERVICES.filter((s) => !rows.some((r) => r.service === s.id) && entry(s.id)?.active !== false);

  return (
    <RequirePermission permission="settings.view">
      <AppShell title="Mis servicios" subtitle={isServices ? "Lo que tienes contratado en B-POS Servicios." : "Tu cuenta tiene B-POS completo."}>
        <div className="max-w-5xl space-y-6">
          {!state && <p className="text-zinc-400">Cargando tus servicios...</p>}
          {state && !isServices && (
            <section className="rounded-3xl border border-emerald-500/40 bg-emerald-500/10 p-5">
              <p className="font-black text-emerald-200">Tu cuenta tiene B-POS completo</p>
              <p className="mt-1 text-sm text-zinc-300">Club de clientes, menú digital, food cost y checador ya vienen en tu plan; el asesor con IA y el kiosco vienen en Max. Ábrelos desde el menú de B-POS.</p>
              <Link href="/pos" className="mt-3 inline-block rounded-2xl bg-orange-500 px-5 py-3 font-black text-black">
                Ir a B-POS
              </Link>
            </section>
          )}
          {message && <p className={`rounded-2xl border p-3 text-sm ${message.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-red-500/40 bg-red-500/10 text-red-200"}`}>{message.text}</p>}

          {isServices && (
            <>
              {mine.length > 0 && (
                <section>
                  <h2 className="mb-3 text-lg font-black">Tus servicios</h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    {mine.map((s) => {
                      const row = rows.find((r) => r.service === s.id)!;
                      const a = serviceAccess(row);
                      const price = entry(s.id)?.price ?? s.price;
                      const paying = row.status === "active" && a.open;
                      return (
                        <article key={s.id} className={`rounded-3xl border p-5 ${a.open ? "border-orange-500/50 bg-zinc-950" : "border-zinc-800 bg-zinc-950 opacity-90"}`}>
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-xl font-black">
                              {s.emoji} {s.name}
                            </p>
                            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${a.open ? (row.status === "trial" ? "bg-sky-500/20 text-sky-200" : row.status === "active" ? "bg-emerald-500/20 text-emerald-200" : "bg-yellow-500/20 text-yellow-200") : "bg-red-500/20 text-red-200"}`}>
                              {a.label}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-zinc-400">{s.short}</p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {a.open && (
                              <Link href={s.home} className="rounded-2xl bg-orange-500 px-5 py-2.5 text-sm font-black text-black">
                                Abrir
                              </Link>
                            )}
                            {!paying && (
                              <button disabled={busy === s.id} onClick={() => void run(s.id, "contratar")} className="rounded-2xl border border-orange-500 px-4 py-2.5 text-sm font-black text-orange-300 disabled:opacity-50">
                                {busy === s.id ? "Abriendo pago..." : `Contratar · ${money(price)}/mes`}
                              </button>
                            )}
                            {paying && (
                              <button disabled={busy === s.id} onClick={() => void run(s.id, "cancelar")} className="rounded-2xl border border-zinc-700 px-4 py-2.5 text-sm font-black text-zinc-400 disabled:opacity-50">
                                Cancelar
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}

              {others.length > 0 && (
                <section>
                  <h2 className="mb-3 text-lg font-black">Agrega más servicios</h2>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {others.map((s) => {
                      const e = entry(s.id);
                      const needs = s.addonOf && !serviceAccess(rows.find((r) => r.service === s.addonOf)).open;
                      return (
                        <article key={s.id} className="flex flex-col rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
                          <p className="text-lg font-black">
                            {s.emoji} {s.name}
                          </p>
                          <p className="mt-1 text-sm text-zinc-400">{s.short}</p>
                          <ul className="mt-3 flex-1 space-y-1 text-xs text-zinc-400">
                            {s.features.map((f) => (
                              <li key={f}>✓ {f}</li>
                            ))}
                          </ul>
                          <p className="mt-3 text-sm font-black text-orange-300">
                            {money(e?.price ?? s.price)}/mes{s.addonOf ? ` · extra de ${serviceInfo(s.addonOf)!.name}` : ""}
                          </p>
                          {needs ? (
                            <p className="mt-2 text-xs text-zinc-500">Primero activa {serviceInfo(s.addonOf!)!.name}.</p>
                          ) : (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {(e?.trial_days ?? 14) > 0 && (
                                <button disabled={busy === s.id} onClick={() => void run(s.id, "probar")} className="rounded-2xl bg-orange-500 px-4 py-2.5 text-sm font-black text-black disabled:opacity-50">
                                  Probar {e?.trial_days ?? 14} días gratis
                                </button>
                              )}
                              <button disabled={busy === s.id} onClick={() => void run(s.id, "contratar")} className="rounded-2xl border border-zinc-700 px-4 py-2.5 text-sm font-black text-zinc-300 disabled:opacity-50">
                                Contratar
                              </button>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
              {!state.billing && <p className="text-xs text-zinc-500">El cobro en línea todavía no está disponible: escríbenos a soporte@bpos.com.mx para activar un servicio.</p>}
            </>
          )}
        </div>
      </AppShell>
    </RequirePermission>
  );
}
