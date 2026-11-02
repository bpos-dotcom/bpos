/**
 * Correos de bienvenida (al crear la cuenta) y de plan activado (cuando
 * Mercado Pago confirma la suscripción). Misma plantilla: cabecera B-POS
 * "Beyond Point of Sale", naranja de la marca, botón grande.
 */
import { PLANS, TRIAL_DAYS, type PlanId } from "@/lib/plans";

const SITE = "https://www.bpos.com.mx";
const ORANGE = "#f97316";
const esc = (s: string) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c);

function layout(title: string, body: string) {
  return `<div style="background:#f4f4f5;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#18181b">
  <div style="max-width:560px;margin:auto;background:#ffffff;border-radius:20px;overflow:hidden">
    <div style="background:#000000;padding:22px 28px;color:#ffffff">
      <div style="font-size:26px;font-weight:900;letter-spacing:1px">B-POS</div>
      <div style="font-size:13px;color:#fdba74;font-weight:700">Beyond Point of Sale · más que un punto de venta</div>
    </div>
    <div style="padding:28px">
      <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25">${title}</h1>
      ${body}
    </div>
    <div style="padding:18px 28px;border-top:1px solid #e4e4e7;color:#71717a;font-size:12px">
      B-POS · Punto de venta para restaurantes · <a href="${SITE}" style="color:${ORANGE}">bpos.com.mx</a> · soporte@bpos.com.mx
    </div>
  </div>
</div>`;
}

const h2 = (t: string) => `<h2 style="margin:26px 0 10px;font-size:18px;color:${ORANGE}">${t}</h2>`;
const p = (t: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${t}</p>`;
const button = (href: string, text: string) => `<p style="margin:20px 0"><a href="${href}" style="display:inline-block;background:${ORANGE};color:#000;font-weight:900;text-decoration:none;padding:14px 26px;border-radius:14px;font-size:16px">${text}</a></p>`;
const step = (n: number, title: string, text: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5"><b>${n}. ${title}</b><br>${text}</p>`;
const plansList = () =>
  `<ul style="margin:0 0 12px;padding-left:20px;font-size:15px;line-height:1.6">
    <li><b>Basic $${PLANS.basic.price}</b> · POS, caja, impresoras por estación, menú digital con QR y pedidos sin comisión, club de clientes y app del dueño.</li>
    <li><b>Pro $${PLANS.pro.price}</b> · todo Basic + cocina en pantalla (KDS) y delivery de Rappi, Uber Eats y DiDi Food directo a cocina.</li>
    <li><b>Max $${PLANS.max.price}</b> · todo Pro + inteligencia artificial: subir menú con IA, compras con foto del ticket y asesor semanal.</li>
  </ul>`;

export function welcomeEmail(input: { businessName: string; address: string; phone: string }) {
  const name = esc(input.businessName);
  const subject = `¡Bienvenido a B-POS, ${input.businessName}! Tu cuenta está lista`;
  const html = layout(
    "Bienvenido a B-POS, el mejor punto de venta para restaurantes de México",
    [
      p(`Tu cuenta ya está creada. Tienes <b>${TRIAL_DAYS} días de prueba gratis con todo B-POS</b>, sin tarjeta: cobra, manda comandas a cocina, recibe delivery y vende desde tu propio menú digital. Al terminar la prueba eliges el plan que más te convenga.`),
      button(`${SITE}/pos`, "Entrar a B-POS →"),
      h2("Listo para empezar"),
      p("Tu negocio ya quedó dado de alta con los datos que nos diste:"),
      `<ul style="margin:0 0 12px;padding-left:20px;font-size:15px;line-height:1.6"><li><b>Negocio:</b> ${name}</li><li><b>Dirección:</b> ${esc(input.address) || "—"}</li><li><b>Teléfono:</b> ${esc(input.phone) || "—"}</li></ul>`,
      p("Si quieres corregir algo, está en Configuración → Empresa y propietario."),
      h2("Primeros pasos"),
      step(1, "Da de alta tus productos.", "Durante la prueba y con el Plan Max puedes usar <i>Subir menú con IA</i>: fotos o PDF de tu menú y B-POS registra los productos; tú solo revisas. También es muy fácil a mano en Configuración → Productos."),
      step(2, "Conecta tus impresoras.", "En Configuración → Sistema descarga B-POS Agent, instálalo en la computadora de las impresoras y vincúlalo con el código de la pantalla."),
      step(3, "Publica tu menú digital.", "En Configuración → Menú digital eliges tu liga, imprimes el QR y recibes pedidos sin comisión."),
      step(4, "Recibe tu delivery sin volver a capturarlo.", "Con el Agent instalado, los pedidos de Rappi, Uber Eats y DiDi Food entran solos a cocina (incluido en Pro y Max)."),
      step(5, "Abre caja y cobra.", "Abre tu turno, cobra en efectivo, tarjeta, transferencia o mixto, y haz tu corte al final del día."),
      h2("Nuestros planes (por sucursal, al mes)"),
      plansList(),
      h2("¿Necesitas ayuda?"),
      p(`Escríbenos a <b>soporte@bpos.com.mx</b>. También puedes ver la demo guiada en <a href="${SITE}/demo" style="color:${ORANGE}">bpos.com.mx/demo</a>.`),
      p("¡Que tengas muchas ventas!<br><i>El equipo de B-POS</i>"),
    ].join("")
  );
  const text = `Bienvenido a B-POS, ${input.businessName}.

Tu cuenta ya está creada. Tienes ${TRIAL_DAYS} días de prueba gratis con todo B-POS, sin tarjeta. Entra en ${SITE}/pos

Tu negocio: ${input.businessName} · ${input.address} · ${input.phone}

Primeros pasos:
1. Da de alta tus productos (con IA en la prueba y en Max, o a mano en Configuración → Productos).
2. Conecta tus impresoras: descarga B-POS Agent en Configuración → Sistema.
3. Publica tu menú digital en Configuración → Menú digital.
4. Con el Agent, tu delivery de Rappi, Uber Eats y DiDi Food entra solo a cocina (Pro y Max).
5. Abre caja y cobra.

Planes por sucursal al mes: Basic $${PLANS.basic.price} · Pro $${PLANS.pro.price} (+ KDS y delivery) · Max $${PLANS.max.price} (+ IA).

¿Ayuda? soporte@bpos.com.mx · Demo: ${SITE}/demo`;
  return { subject, html, text };
}

export function planActiveEmail(input: { businessName: string; plan: PlanId }) {
  const planName = PLANS[input.plan]?.name || "Basic";
  const subject = `Tu plan ${planName} de B-POS está activo`;
  const intro = p("Tu suscripción quedó activada hoy. Se renueva cada mes por Mercado Pago y puedes cambiar de plan o cancelar cuando quieras en Configuración → Mi plan.");
  const byPlan: Record<PlanId, string> = {
    basic: [
      h2("Lo que incluye tu plan Basic"),
      p("POS, caja con corte, impresoras por estación, menú digital con QR y pedidos sin comisión, club de clientes y app del dueño."),
      h2("¿Vendes por Rappi, Uber Eats o DiDi Food?"),
      p("Con <b>Pro</b> tienes la cocina en pantalla (KDS) y los pedidos de delivery entran solos a cocina y descuentan inventario, sin volver a capturarlos. Y con <b>Max</b> además subes tu menú con IA y recibes cada lunes el análisis de tu Asesor. Cambiar de plan toma un minuto en Configuración → Mi plan."),
    ].join(""),
    pro: [
      h2("Lo que incluye tu plan Pro"),
      p("Todo lo de Basic + cocina en pantalla (KDS) y delivery: los pedidos de Rappi, Uber Eats y DiDi Food entran solos a cocina. Instala B-POS Agent en la computadora de las impresoras y configúralo en B-POS Bridge."),
      h2("¿Quieres que la inteligencia artificial trabaje por ti?"),
      p("Con <b>Max</b> subes tu menú con fotos, registras compras con una foto del ticket y recibes cada lunes el análisis de tu Asesor."),
    ].join(""),
    max: [
      h2("Lo que incluye tu plan Max"),
      p("Todo B-POS: cocina en pantalla, delivery automático, subir menú con IA, compras con foto del ticket y tu Asesor con inteligencia artificial cada lunes en la App del dueño. Tienes el plan más completo; si necesitas otra sucursal, se agrega desde Mi plan."),
    ].join(""),
  };
  const html = layout(`¡Gracias, ${esc(input.businessName)}! Tu plan ${planName} está activo`, [intro, byPlan[input.plan] || byPlan.basic, button(`${SITE}/pos`, "Entrar a B-POS →"), p("¡Que tengas muchas ventas!<br><i>El equipo de B-POS</i>")].join(""));
  const text = `¡Gracias, ${input.businessName}! Tu plan ${planName} de B-POS está activo. Se renueva cada mes por Mercado Pago; cambia de plan o cancela en Configuración → Mi plan. Entra en ${SITE}/pos`;
  return { subject, html, text };
}
