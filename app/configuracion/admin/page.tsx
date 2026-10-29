"use client";
/**
 * Configuración → Administrador de B-POS (bloque 15, fase 3). Solo para los
 * usuarios de platform_admins: todos los negocios, su plan, estado, pagos y
 * uso de IA del mes; se pueden cambiar a mano (0007_bpos_admin.sql).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { useIsPlatformAdmin } from "@/components/admin/PlatformAdminCard";
import { getSupabase } from "@/lib/supabase/client";
import { PLANS, planAccess, type PlanId } from "@/lib/plans";

type AdminBusiness = {
  id: string;
  name: string;
  created_at: string;
  plan: PlanId;
  plan_status: string;
  trial_ends_at: string | null;
  paid_until: string | null;
  branches_paid: number;
  branches: number;
  ai_budget_usd: number | null;
  ai_spent_usd: number;
  ai_requests: number;
  mp_preapproval_id: string | null;
  mp_payer_email: string | null;
  owner_email: string | null;
};

type Draft = { plan: PlanId; status: string; trial: string; paid: string; branches: number; budget: string };

const STATUS: Record<string, string> = { trial: "Prueba", active: "Activo", past_due: "Pago pendiente", cancelled: "Cancelado" };
const field = "rounded-xl border border-zinc-800 bg-black px-2 py-2 text-sm text-white";
const DAY = 86_400_000;

const toDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const fromDate = (value: string) => (value ? new Date(`${value}T23:59:00`).toISOString() : null);
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "—");

function draftOf(b: AdminBusiness): Draft {
  return {
    plan: b.plan,
    status: b.plan_status,
    trial: toDate(b.trial_ends_at),
    paid: toDate(b.paid_until),
    branches: b.branches_paid || 1,
    budget: b.ai_budget_usd === null ? "" : String(b.ai_budget_usd),
  };
}

export default function AdminPage() {
  const admin = useIsPlatformAdmin();
  const [rows, setRows] = useState<AdminBusiness[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().rpc("bpos_admin_businesses");
    if (error) {
      setError(/bpos_admin_businesses/.test(error.message) ? "Falta aplicar 0007_bpos_admin.sql en Supabase." : error.message);
      setRows([]);
      return;
    }
    setError("");
    setRows((data || []) as AdminBusiness[]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga de la nube al confirmar que es administrador
    if (admin) void load();
  }, [admin, load]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter((b) => !q || `${b.name} ${b.owner_email || ""} ${b.mp_payer_email || ""}`.toLowerCase().includes(q));
  }, [rows, search]);

  const summary = useMemo(() => {
    const all = rows || [];
    const active = all.filter((b) => b.plan_status === "active" && !planAccess(b).locked);
    return {
      total: all.length,
      active: active.length,
      trial: all.filter((b) => b.plan_status === "trial" && !planAccess(b).locked).length,
      locked: all.filter((b) => planAccess(b).locked).length,
      monthly: active.filter((b) => b.mp_preapproval_id).reduce((sum, b) => sum + (PLANS[b.plan]?.price || 0) * (b.branches_paid || 1), 0),
      ai: all.reduce((sum, b) => sum + Number(b.ai_spent_usd || 0), 0),
    };
  }, [rows]);

  async function save(b: AdminBusiness, d: Draft) {
    setBusy(true);
    setMessage("");
    const budget = d.budget.trim() === "" ? null : Math.max(0, Number(d.budget) || 0);
    const { error } = await getSupabase().rpc("bpos_admin_update_business", {
      p_business_id: b.id,
      p_plan: d.plan,
      p_status: d.status,
      p_trial_ends_at: fromDate(d.trial),
      p_paid_until: fromDate(d.paid),
      p_branches_paid: d.branches,
      p_ai_budget_usd: budget,
    });
    setBusy(false);
    if (error) return setMessage(`No se pudo guardar: ${error.message}`);
    setMessage(`✅ ${b.name} guardado.`);
    setEditing(null);
    await load();
  }

  /** Regala 30 días: activo y pagado hasta 30 días después de hoy (o de lo ya pagado). */
  function plus30(b: AdminBusiness) {
    // eslint-disable-next-line react-hooks/purity -- se llama al tocar "+30 días", no al pintar
    const base = Math.max(Date.now(), b.paid_until ? new Date(b.paid_until).getTime() : 0);
    void save(b, { ...draftOf(b), status: "active", paid: toDate(new Date(base + 30 * DAY).toISOString()) });
  }

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Administrador de B-POS" subtitle="Todos los negocios que usan B-POS: plan, pagos y uso de IA del mes.">
        {admin === null ? (
          <p className="text-zinc-500">Revisando permisos...</p>
        ) : !admin ? (
          <p className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6 text-orange-200">Esta pantalla es solo para el administrador de la plataforma B-POS.</p>
        ) : (
          <div className="space-y-5">
            <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {[
                ["Negocios", String(summary.total)],
                ["Activos", String(summary.active)],
                ["En prueba", String(summary.trial)],
                ["En pausa", String(summary.locked)],
                ["Cobro mensual (MP)", `$${summary.monthly.toLocaleString("es-MX")}`],
                ["IA este mes (USD)", `$${summary.ai.toFixed(2)}`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-xs font-bold text-zinc-500">{label}</p>
                  <p className="mt-1 text-2xl font-black">{value}</p>
                </div>
              ))}
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar negocio o correo..." className="w-full max-w-md rounded-2xl border border-zinc-800 bg-black px-4 py-3" />
              <button onClick={() => void load()} className="rounded-2xl border border-zinc-700 px-4 py-3 font-black hover:border-orange-500">
                Actualizar
              </button>
              {message && <p className="text-sm font-bold text-orange-200">{message}</p>}
            </div>
            {error && <p className="text-red-400">{error}</p>}
            {rows === null && <p className="text-zinc-500">Cargando negocios...</p>}

            <div className="space-y-3">
              {list.map((b) => {
                const access = planAccess(b);
                const open = editing === b.id && draft;
                return (
                  <section key={b.id} className={`rounded-3xl border bg-zinc-950 p-5 ${access.locked ? "border-red-500/40" : "border-zinc-800"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xl font-black">{b.name}</p>
                        <p className="text-sm text-zinc-400">
                          {b.owner_email || "sin correo"} · alta {fmt(b.created_at)} · {b.branches} sucursal(es)
                        </p>
                        <p className="mt-1 text-sm">
                          <span className="font-black text-orange-400">{PLANS[b.plan]?.name || b.plan}</span> · {STATUS[b.plan_status] || b.plan_status}
                          {access.locked && <span className="ml-2 font-black text-red-400">· EN PAUSA</span>}
                          {" · "}
                          {b.plan_status === "trial" ? `prueba hasta ${fmt(b.trial_ends_at)}` : b.paid_until ? `pagado hasta ${fmt(b.paid_until)}` : "sin vencimiento"}
                          {" · "}
                          {b.branches_paid} sucursal(es) pagada(s)
                        </p>
                        <p className="text-xs text-zinc-500">
                          IA del mes: ${Number(b.ai_spent_usd || 0).toFixed(2)} USD de {b.ai_budget_usd === null ? "lo del plan" : `$${Number(b.ai_budget_usd).toFixed(2)}`} ({b.ai_requests} consultas)
                          {b.mp_preapproval_id ? ` · Mercado Pago: ${b.mp_payer_email || b.mp_preapproval_id}` : " · sin Mercado Pago"}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => plus30(b)} disabled={busy} className="rounded-xl border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm font-black text-green-300 disabled:opacity-50">
                          +30 días
                        </button>
                        <button
                          onClick={() => {
                            setEditing(open ? null : b.id);
                            setDraft(draftOf(b));
                          }}
                          className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-black hover:border-orange-500"
                        >
                          {open ? "Cerrar" : "Editar"}
                        </button>
                      </div>
                    </div>

                    {open && draft && (
                      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-zinc-800 pt-4 md:grid-cols-3 xl:grid-cols-6">
                        <label className="text-xs font-bold text-zinc-400">
                          Plan
                          <select value={draft.plan} onChange={(e) => setDraft({ ...draft, plan: e.target.value as PlanId })} className={`${field} mt-1 w-full`}>
                            {(Object.keys(PLANS) as PlanId[]).map((id) => (
                              <option key={id} value={id}>
                                {PLANS[id].name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-bold text-zinc-400">
                          Estado
                          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className={`${field} mt-1 w-full`}>
                            {Object.entries(STATUS).map(([id, label]) => (
                              <option key={id} value={id}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-bold text-zinc-400">
                          Prueba hasta
                          <input type="date" value={draft.trial} onChange={(e) => setDraft({ ...draft, trial: e.target.value })} className={`${field} mt-1 w-full`} />
                        </label>
                        <label className="text-xs font-bold text-zinc-400">
                          Pagado hasta (vacío = no vence)
                          <input type="date" value={draft.paid} onChange={(e) => setDraft({ ...draft, paid: e.target.value })} className={`${field} mt-1 w-full`} />
                        </label>
                        <label className="text-xs font-bold text-zinc-400">
                          Sucursales pagadas
                          <input type="number" min={1} value={draft.branches} onChange={(e) => setDraft({ ...draft, branches: Math.max(1, Math.round(Number(e.target.value) || 1)) })} className={`${field} mt-1 w-full`} />
                        </label>
                        <label className="text-xs font-bold text-zinc-400">
                          Límite IA USD (vacío = el del plan)
                          <input inputMode="decimal" value={draft.budget} onChange={(e) => setDraft({ ...draft, budget: e.target.value })} className={`${field} mt-1 w-full`} />
                        </label>
                        <div className="col-span-full flex justify-end">
                          <button onClick={() => void save(b, draft)} disabled={busy} className="rounded-2xl bg-orange-500 px-6 py-3 font-black text-black disabled:opacity-50">
                            {busy ? "Guardando..." : "Guardar cambios"}
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </AppShell>
    </RequireRole>
  );
}
