/**
 * Correos que manda B-POS (solo en el servidor) por Resend: código para
 * crear la cuenta, bienvenida, plan activado, resumen del Asesor...
 * Remitente: la dirección de RESEND_FROM (dominio verificado) con el nombre B-POS.
 */
const SUPPORT = "soporte@bpos.com.mx";

export function sender() {
  const configured = process.env.RESEND_FROM || "";
  const address = configured.match(/<([^>]+)>/)?.[1] || (configured.includes("@") ? configured : "no-responder@bpos.com.mx");
  return `B-POS <${address}>`;
}

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Manda el correo; regresa false (y deja registro) si no se pudo. */
export async function sendEmail(mail: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: sender(), reply_to: SUPPORT, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
  });
  if (!res.ok) {
    console.error("[B-POS] Resend:", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}
