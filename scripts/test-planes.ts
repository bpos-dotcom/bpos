/** Bloque 15 · regla de bloqueo amable por plan. npx tsx scripts/test-planes.ts */
import { planAccess } from "../lib/plans";

const now = Date.parse("2026-10-29T12:00:00Z");
const d = (days: number) => new Date(now + days * 86_400_000).toISOString();
let ok = 0, bad = 0;
function check(name: string, cond: boolean) {
  if (cond) ok++; else { bad++; console.log("✗", name); }
}

check("prueba con 10 días: libre", !planAccess({ plan: "basic", plan_status: "trial", trial_ends_at: d(10), paid_until: null }, now).locked);
check("prueba con 2 días: aviso", planAccess({ plan: "basic", plan_status: "trial", trial_ends_at: d(2), paid_until: null }, now).warning.includes("2"));
check("prueba terminada: bloqueo", planAccess({ plan: "basic", plan_status: "trial", trial_ends_at: d(-1), paid_until: null }, now).locked);
check("activo sin fecha (manual): libre", !planAccess({ plan: "max", plan_status: "active", trial_ends_at: d(-30), paid_until: null }, now).locked);
check("activo pagado: libre", !planAccess({ plan: "pro", plan_status: "active", trial_ends_at: d(-30), paid_until: d(20) }, now).locked);
check("activo vencido: bloqueo", planAccess({ plan: "pro", plan_status: "active", trial_ends_at: d(-30), paid_until: d(-1) }, now).locked);
const pd = planAccess({ plan: "pro", plan_status: "past_due", trial_ends_at: d(-30), paid_until: d(2) }, now);
check("pago pendiente con gracia: libre + aviso", !pd.locked && pd.warning.includes("pendiente"));
check("pago pendiente vencido: bloqueo", planAccess({ plan: "pro", plan_status: "past_due", trial_ends_at: d(-30), paid_until: d(-1) }, now).locked);
const c = planAccess({ plan: "pro", plan_status: "cancelled", trial_ends_at: d(-30), paid_until: d(5) }, now);
check("cancelado con días pagados: libre + aviso", !c.locked && c.warning.includes("Cancelaste"));
check("cancelado sin fecha: bloqueo", planAccess({ plan: "pro", plan_status: "cancelled", trial_ends_at: d(-30), paid_until: null }, now).locked);

console.log(`${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
