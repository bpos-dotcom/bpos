"use client";
/**
 * Configuración → Mi plan (bloque 15): plan del negocio, prueba gratis y lo
 * que incluye cada plan. El plan solo lo cambia la nube (pago o administrador).
 */
import { useEffect, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { loadCloudAccount } from "@/lib/cloud/account";
import { getSupabase } from "@/lib/supabase/client";
import { PLANS, TRIAL_DAYS, type PlanId } from "@/lib/plans";

type BusinessPlan = { name: string; plan: PlanId; plan_status: string; trial_ends_at: string; paid_until: string | null; branches_paid: number };

const STATUS: Record<string, string> = {
  trial: "Prueba gratis",
  active: "Activo",
  past_due: "Pago pendiente",
  cancelled: "Cancelado",
};

export default function PlanPage() {
  const [info, setInfo] = useState<BusinessPlan | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const account = await loadCloudAccount();
      if (account.status !== "ready") {
        setInfo(null);
        setError("Inicia sesión con la cuenta del negocio para ver tu plan.");
        return;
      }
      const { data, error } = await getSupabase()
        .from("businesses")
        .select("name, plan, plan_status, trial_ends_at, paid_until, branches_paid")
        .eq("id", account.businessId)
        .maybeSingle();
      if (error || !data) {
        setInfo(null);
        setError(/plan_status/.test(error?.message || "") ? "Falta aplicar 0006_bpos_planes.sql en Supabase." : "No se pudo leer tu plan.");
        return;
      }
      setInfo(data as BusinessPlan);
    })();
  }, []);

  const daysLeft = info?.plan_status === "trial" ? Math.max(0, Math.ceil((new Date(info.trial_ends_at).getTime() - Date.now()) / 86_400_000)) : null;

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Mi plan" subtitle="Tu suscripción a B-POS: plan, sucursales y lo que incluye.">
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
                        ? `Pagado hasta el ${new Date(info.paid_until).toLocaleDateString("es-MX")}.`
                        : ""}{" "}
                    {info.branches_paid} sucursal(es).
                  </p>
                </div>
                <p className="text-sm text-zinc-500">El pago mensual con Mercado Pago llega en la siguiente versión.</p>
              </div>
            )}
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            {(Object.keys(PLANS) as PlanId[]).map((id) => {
              const plan = PLANS[id];
              const current = info?.plan === id;
              return (
                <div key={id} className={`rounded-3xl border p-6 ${current ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 bg-zinc-950"}`}>
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
                </div>
              );
            })}
          </section>
          <p className="text-xs text-zinc-500">Todos los negocios nuevos empiezan con {TRIAL_DAYS} días de prueba gratis.</p>
        </div>
      </AppShell>
    </RequireRole>
  );
}
