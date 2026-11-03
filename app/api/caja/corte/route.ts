import { NextResponse, type NextRequest } from "next/server";
import { bridgeAuth } from "@/lib/bridge/api-guard";
import { emailConfigured, sendEmail } from "@/lib/email/send";

/**
 * Corte de caja por correo (Configuración → Empresa → "Enviar el corte por
 * correo automáticamente"). La pantalla de Caja lo llama al cerrar turno con
 * la sesión del negocio; B-POS lo manda con Resend al correo configurado,
 * sin que nadie tenga que tocar nada. También sirve para reenviar un corte
 * desde Historial de cortes.
 *
 *   POST { to, folio, businessName, message }   Authorization: Bearer <sesión>
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** El mensaje del corte (texto de WhatsApp, con *negritas*) como HTML sencillo. */
function cutHtml(businessName: string, folio: string, message: string) {
  const lines = message
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => esc(line).replace(/\*([^*]+)\*/g, "<b>$1</b>"))
    .join("<br>");
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#18181b">
  <p style="color:#f97316;font-weight:bold;margin:0">B-POS · ${esc(businessName)}</p>
  <h2 style="margin:4px 0 16px">Corte de caja ${esc(folio)}</h2>
  <div style="background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;padding:16px;line-height:1.6;font-size:15px">${lines}</div>
  <p style="margin-top:24px"><a href="https://www.bpos.com.mx/caja/historial" style="background:#f97316;color:#000;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:bold">Ver historial de cortes</a></p>
  <p style="color:#a1a1aa;font-size:12px;margin-top:24px">Lo recibes porque está activado en Configuración → Empresa → Corte de caja. Para dejar de recibirlo, apágalo ahí.</p>
</div>`;
}

export async function POST(request: NextRequest) {
  const auth = await bridgeAuth(request);
  if ("denied" in auth) return auth.denied;
  if (!emailConfigured()) return NextResponse.json({ success: false, error: "El envío de correo no está configurado en el servidor." }, { status: 503 });

  let body: { to?: unknown; folio?: unknown; businessName?: unknown; message?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // sin cuerpo
  }
  const to = String(body.to || "").trim().toLowerCase();
  const folio = String(body.folio || "").trim().slice(0, 40);
  const businessName = String(body.businessName || "Mi negocio").trim().slice(0, 80);
  const message = String(body.message || "").trim().slice(0, 8000);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return NextResponse.json({ success: false, error: "Correo no válido." }, { status: 400 });
  if (!folio || !message) return NextResponse.json({ success: false, error: "Falta el corte." }, { status: 400 });

  const ok = await sendEmail({
    to,
    subject: `Corte de caja ${folio} · ${businessName}`,
    html: cutHtml(businessName, folio, message),
    text: `${businessName}\n\n${message.replace(/\*/g, "")}`,
  });
  if (!ok) return NextResponse.json({ success: false, error: "El servicio de correo rechazó el envío." }, { status: 502 });
  return NextResponse.json({ success: true });
}
