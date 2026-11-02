"use client";
/**
 * Lo que incluye cada plan (lib/plans.ts): Basic sin KDS ni delivery, Pro con
 * KDS y delivery, Max con todo + IA. La prueba gratis incluye todo.
 * usePlanState lee el plan del negocio en la nube (y lo recuerda en este
 * dispositivo); PlanGate muestra "Disponible en Pro y Max" en vez de la pantalla.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { agentScope } from "@/lib/agent/client";
import { planIncludes, planLabel, type PlanFeature, type PlanState } from "@/lib/plans";
import { getSupabase, isCloudConfigured } from "@/lib/supabase/client";

const PLAN_KEY = "bpos_plan";
export const PLAN_EVENT = "bpos:plan-updated";

type Cached = Pick<PlanState, "plan" | "plan_status"> & { at: number };

export function readCachedPlan(): Cached | null {
  try {
    return JSON.parse(localStorage.getItem(PLAN_KEY) || "null");
  } catch {
    return null;
  }
}

/** Plan y estado del negocio (null mientras carga o sin nube) */
export function usePlanState() {
  const [state, setState] = useState<Cached | null>(() => (typeof window === "undefined" ? null : readCachedPlan()));
  useEffect(() => {
    if (!isCloudConfigured) return;
    let alive = true;
    const load = async () => {
      try {
        const { businessId } = await agentScope();
        const { data } = await getSupabase().from("businesses").select("plan, plan_status").eq("id", businessId).maybeSingle();
        if (!alive || !data) return;
        const next: Cached = { plan: String(data.plan || "basic"), plan_status: String(data.plan_status || "trial"), at: Date.now() };
        localStorage.setItem(PLAN_KEY, JSON.stringify(next));
        setState(next);
        window.dispatchEvent(new Event(PLAN_EVENT));
      } catch {
        // sin internet: se queda lo recordado
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10 * 60_000);
    const sync = () => setState(readCachedPlan());
    window.addEventListener(PLAN_EVENT, sync);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener(PLAN_EVENT, sync);
    };
  }, []);
  return state;
}

const NEEDS: Record<PlanFeature, string> = { kds: "Pro y Max", delivery: "Pro y Max", ai: "Max" };
const WHAT: Record<PlanFeature, string> = {
  kds: "La cocina en pantalla (KDS) muestra cada pedido en la estación que lo prepara, con tiempos en vivo, sin papel. En Basic las comandas salen en las impresoras.",
  delivery: "B-POS Bridge lee los pedidos de Rappi, Uber Eats y DiDi Food y los manda solos a cocina, descontando inventario, sin volver a capturarlos.",
  ai: "Subir el menú con fotos, registrar compras con una foto del ticket y el Asesor semanal con inteligencia artificial.",
};

/** Envuelve una pantalla: si el plan no la incluye, muestra el aviso en su lugar */
export function PlanGate({ feature, title, children }: { feature: PlanFeature; title: string; children: React.ReactNode }) {
  const state = usePlanState();
  if (planIncludes(state, feature)) return <>{children}</>;
  return (
    <AppShell title={title} subtitle={`Disponible en los planes ${NEEDS[feature]}.`}>
      <section className="mx-auto max-w-xl rounded-3xl border border-orange-500/40 bg-zinc-950 p-8 text-center">
        <p className="text-5xl">🔒</p>
        <h2 className="mt-4 text-2xl font-black">
          {title} viene en {NEEDS[feature]}
        </h2>
        <p className="mt-3 text-zinc-300">{WHAT[feature]}</p>
        <p className="mt-2 text-sm text-zinc-500">Tu plan actual: {planLabel(state?.plan)}.</p>
        <Link href="/configuracion/plan" className="mt-6 block w-full rounded-2xl bg-orange-500 py-4 font-black text-black hover:bg-orange-400">
          Cambiar de plan en Mi plan
        </Link>
        <p className="mt-3 text-xs text-zinc-500">Cambiar de plan toma un minuto y se cobra por Mercado Pago.</p>
      </section>
    </AppShell>
  );
}
