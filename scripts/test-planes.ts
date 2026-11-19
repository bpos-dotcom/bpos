/** Bloque 15 · regla de bloqueo amable por plan, precio anual y external_reference. npx tsx scripts/test-planes.ts */
import { PLANS, isBillingPeriod, parseReference, planAccess, planPrice, referenceFor } from "../lib/plans";

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

// Precios mensual / anual (anual = 10 meses: 2 gratis)
check("basic mensual 399", planPrice("basic") === 399 && planPrice("basic", "monthly") === 399);
check("basic anual 3990", planPrice("basic", "annual") === 3990);
check("pro anual 5990", planPrice("pro", "annual") === 5990);
check("max anual 8990", planPrice("max", "annual") === 8990);
check("plan desconocido = basic", planPrice("nada", "annual") === 3990);
check("mensual sigue igual que PLANS", planPrice("max", "monthly") === PLANS.max.price);

// external_reference: 3 partes = mensual (referencias viejas), 4.ª parte "annual"
check("referencia mensual sin sufijo", referenceFor("b1", "pro", 2) === "b1|pro|2" && referenceFor("b1", "pro", 2, "monthly") === "b1|pro|2");
check("referencia anual", referenceFor("b1", "max", 3, "annual") === "b1|max|3|annual");
const old = parseReference("b1|pro|2");
check("referencia vieja = mensual", old.businessId === "b1" && old.plan === "pro" && old.branches === 2 && old.period === "monthly");
const yr = parseReference(referenceFor("b2", "max", 4, "annual"));
check("referencia anual de ida y vuelta", yr.businessId === "b2" && yr.plan === "max" && yr.branches === 4 && yr.period === "annual");
const junk = parseReference("b3|xx|0|otro");
check("referencia rara: basic, 1 sucursal, mensual", junk.plan === "basic" && junk.branches === 1 && junk.period === "monthly");
check("referencia vacía", parseReference(undefined).businessId === "" && parseReference().period === "monthly");
check("isBillingPeriod", isBillingPeriod("annual") && isBillingPeriod("monthly") && !isBillingPeriod("yearly"));

console.log(`${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
