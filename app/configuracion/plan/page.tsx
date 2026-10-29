"use client";
/**
 * Configuración → Mi plan (bloque 15): plan del negocio, prueba gratis, pago
 * mensual con Mercado Pago (contratar, revisar y cancelar). El plan solo lo
 * cambia la nube (pago o administrador).
 */
import { useCallback, useEffect, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { loadCloudAccount } from "@/lib/cloud/account";
import { getSupabase } from "@/lib/supabase/client";
import { aiFetch } from "@/lib/ai/client";
import { PLANS, TRIAL_DAYS, planAccess, type PlanId } from "@/lib/plans";

type BusinessPlan = {
  name: string;
  plan: PlanId;
  plan_status: string;
  trial_ends_at: string;
  paid_until: string | null;
  branches_paid: number;
  mp_preapproval_id: string | null;
  mp_payer_email: string | null;
};

const STATUS: Record<string, string> = {
  trial: "Prueba gratis",
  active: "Activo",
  past_due: "Pago pendiente",
  cancelled: "Cancelado",
};

const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white placeholder:text-zinc-600";

async function cloudPost(path: string, body?: unknown) {
  const r = await aiFetch(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || !b.success) throw new Error(b.error || "No se pudo conectar con B-POS.");
  return b;
}

export default function PlanPage() {
  const [info, setInfo] = useState<BusinessPlan | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<PlanId>("basic");
  const [branches, setBranches] = useState(1);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [pendingId, setPendingId] = useState("");

  const load = useCallback(async () => {
    const account = await loadCloudAccount();
    if (account.status !== "ready") {
      setInfo(null);
      setError("Inicia sesión con la cuenta del negocio para ver tu plan.");
      return null;
    }
    const { data, error } = await getSupabase()
      .from("businesses")
      .select("name, plan, plan_status, trial_ends_at, paid_until, branches_paid, mp_preapproval_id, mp_payer_email")
      .eq("id", account.businessId)
      .maybeSingle();
    if (error || !data) {
      setInfo(null);
      setError(/plan_status/.test(error?.message || "") ? "Falta aplicar 0006_bpos_planes.sql en Supabase." : "No se pudo leer tu plan.");
      return null;
    }
    const plan = data as BusinessPlan;
    setInfo(plan);
    setEmail((e) => e || plan.mp_payer_email || account.email);
    return plan;
  }, []);

  /** Pregunta a Mercado Pago cómo va el pago y vuelve a leer el plan. */
  const sync = useCallback(
    async (quiet = false, id = "") => {
      setBusy("sync");
      try {
        const r = await cloudPost("/api/mp/sync", id ? { id } : undefined);
        await load();
        if (!quiet) setMessage(r.status === "authorized" ? "¡Pago confirmado! Tu plan ya está activo." : r.status ? "Mercado Pago todavía no confirma el pago. Intenta en un minuto." : "No hay ningún pago iniciado.");
      } catch (e) {
        if (!quiet) setMessage(e instanceof Error ? e.message : "No se pudo revisar el pago.");
      }
      setBusy("");
    },
    [load],
  );

  useEffect(() => {
    void (async () => {
      const plan = await load();
      if (!plan) return;
      setChoice(plan.plan);
      setBranches(Math.max(1, plan.branches_paid || 1));
      if (new URLSearchParams(window.location.search).get("pago") === "listo") void sync();
    })();
  }, [load, sync]);

  async function subscribe() {
    setMessage("");
    setBusy("subscribe");
    try {
      const r = await cloudPost("/api/mp/subscribe", { plan: choice, branches, email });
      window.open(r.url, "_blank");
      setPendingId(r.id || "");
      setMessage("Se abrió Mercado Pago. Cuando termines de pagar, regresa aquí y presiona \"Ya pagué\".");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo abrir Mercado Pago.");
    }
    setBusy("");
  }

  async function cancel() {
    if (!confirm("¿Cancelar tu suscripción? Ya no se cobrará el próximo mes y B-POS sigue funcionando hasta lo que ya pagaste.")) return;
    setMessage("");
    setBusy("cancel");
    try {
      await cloudPost("/api/mp/cancel");
      await load();
      setMessage("Suscripción cancelada. No se hará ningún otro cobro.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo cancelar.");
    }
    setBusy("");
  }

  const access = info ? planAccess(info) : null;
  const daysLeft = info?.plan_status === "trial" ? Math.max(0, Math.ceil((new Date(info.trial_ends_at).getTime() - Date.now()) / 86_400_000)) : null;
  const subscribed = info?.plan_status === "active" && Boolean(info.mp_preapproval_id);
  const total = PLANS[choice].price * branches;

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Mi plan" subtitle="Tu suscripción a B-POS: plan, sucursales y pago mensual.">
        <div className="max-w-5xl space-y-6">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            {info === undefined ? (
              <p className="text-zinc-500">Revisando tu plan...</p>
            ) : info === null ? (
              <p className="text-orange-200">{error}</p>
            ) : (
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-zinc-400">{info.name}</p>
                  <h2 className="text-3xl font-black">
                    Plan {PLANS[info.plan]?.name || info.plan} <span className="text-lg text-orange-400">· {STATUS[info.plan_status] || info.plan_status}</span>
                  </h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    {daysLeft !== null
                      ? daysLeft > 0
                        ? `Te quedan ${daysLeft} día(s) de prueba gratis.`
                        : "Tu prueba gratis terminó."
                      : info.paid_until
                        ? `${info.plan_status === "active" ? "Pagado" : "Funciona"} hasta el ${new Date(info.paid_until).toLocaleDateString("es-MX")}.`
                        : ""}{" "}
                    {info.branches_paid} sucursal(es).
                  </p>
                  {access?.locked && <p className="mt-2 text-sm font-black text-red-300">Tu plan no está activo. Contrata abajo para seguir usando B-POS.</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {info.mp_preapproval_id && (
                    <button onClick={() => sync()} disabled={Boolean(busy)} className="rounded-2xl border border-zinc-700 px-4 py-3 font-black hover:border-orange-500 disabled:opacity-50">
                      {busy === "sync" ? "Revisando..." : "Revisar pago"}
                    </button>
                  )}
                  {subscribed && (
                    <button onClick={cancel} disabled={Boolean(busy)} className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 font-black text-red-300 disabled:opacity-50">
                      {busy === "cancel" ? "Cancelando..." : "Cancelar suscripción"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            {(Object.keys(PLANS) as PlanId[]).map((id) => {
              const plan = PLANS[id];
              const current = info?.plan === id && info.plan_status !== "trial";
              const selected = choice === id;
              return (
                <button
                  key={id}
                  onClick={() => setChoice(id)}
                  className={`rounded-3xl border p-6 text-left transition ${selected ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"}`}
                >
                  <p className="text-xl font-black">{plan.name}</p>
                  <p className="mt-1 text-3xl font-black text-orange-400">
                    ${plan.price} <span className="text-sm font-bold text-zinc-400">MXN / sucursal / mes</span>
                  </p>
                  <ul className="mt-4 space-y-1 text-sm text-zinc-300">
                    {plan.features.map((f) => (
                      <li key={f}>✓ {f}</li>
                    ))}
                  </ul>
                  {current && <p className="mt-4 text-sm font-black text-orange-300">Tu plan actual</p>}
                </button>
              );
            })}
          </section>

          {info && (
            <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
              <h3 className="text-xl font-black">{subscribed ? "Cambiar de plan" : "Contratar con Mercado Pago"}</h3>
              <p className="mt-1 text-sm text-zinc-400">
                Pago mensual automático con tarjeta. {subscribed ? "Al quedar pagado el plan nuevo, el anterior se cancela solo: nunca pagas doble." : "Puedes cancelar cuando quieras."}
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-[1fr_160px]">
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-zinc-400">Correo de tu cuenta de Mercado Pago</span>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="correo@ejemplo.com" className={input} />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-zinc-400">Sucursales</span>
                  <input value={branches} onChange={(e) => setBranches(Math.min(50, Math.max(1, Math.round(Number(e.target.value) || 1))))} type="number" min={1} max={50} className={input} />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                <p className="text-lg font-black">
                  Plan {PLANS[choice].name} · {branches} sucursal(es) = <span className="text-orange-400">${total.toLocaleString("es-MX")} MXN al mes</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {pendingId && (
                    <button onClick={() => sync(false, pendingId)} disabled={Boolean(busy)} className="rounded-2xl border border-orange-500 px-6 py-4 font-black text-orange-300 disabled:opacity-50">
                      {busy === "sync" ? "Revisando..." : "Ya pagué"}
                    </button>
                  )}
                  <button onClick={subscribe} disabled={Boolean(busy)} className="rounded-2xl bg-orange-500 px-6 py-4 font-black text-black hover:bg-orange-400 disabled:opacity-50">
                    {busy === "subscribe" ? "Abriendo..." : "Pagar con Mercado Pago"}
                  </button>
                </div>
              </div>
              {message && <p className="mt-4 text-sm font-bold text-orange-200">{message}</p>}
            </section>
          )}
          <p className="text-xs text-zinc-500">Todos los negocios nuevos empiezan con {TRIAL_DAYS} días de prueba gratis. Si un pago falla tienes 3 días de gracia.</p>
        </div>
      </AppShell>
    </RequireRole>
  );
}
