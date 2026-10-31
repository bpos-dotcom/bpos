import { NextResponse, type NextRequest } from "next/server";
import { ANALYZE, AnalysisSchema, SYSTEM, type AdvisorAnalysis } from "@/lib/ai/advisor";
import { aiCost, generateJson } from "@/lib/ai/engine";
import { adminDb, getAiConfig } from "@/lib/ai/settings";

/**
 * Cada lunes (cron de Vercel, vercel.json): el resumen del Asesor con IA
 * por correo a los negocios que lo activaron en la App del dueño. Usa los
 * números que B-POS subió esa semana (bpos_advisor_weekly, 0018), revisa
 * plan Max y presupuesto de IA, y lo manda con Resend. Una vez por semana.
 *
 * Si existe CRON_SECRET en Vercel, solo Vercel puede llamarlo.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Row = { business_id: string; email: string; metrics: Record<string, unknown> | null; metrics_at: string | null; last_week: string };

/** "2026-W44" (semana ISO, hora de México) */
function weekKey(now = new Date()) {
  const mx = new Date(now.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
  const d = new Date(Date.UTC(mx.getFullYear(), mx.getMonth(), mx.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function emailHtml(business: string, a: AdvisorAnalysis) {
  const items = (list: { titulo: string; texto: string }[], color: string) =>
    list.map((x) => `<div style="border:1px solid #e4e4e7;border-left:4px solid ${color};border-radius:12px;padding:12px;margin:8px 0"><b>${esc(x.titulo)}</b><br><span style="color:#52525b;font-size:14px">${esc(x.texto)}</span></div>`).join("");
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#18181b">
  <p style="color:#f97316;font-weight:bold;margin:0">✨ Tu asesor de negocios · B-POS</p>
  <h2 style="margin:4px 0 16px">Resumen de la semana · ${esc(business)}</h2>
  <p style="line-height:1.6">${esc(a.resumen)}</p>
  <h3 style="color:#dc2626">⚠️ Alertas</h3>${items(a.alertas, "#dc2626")}
  <h3 style="color:#059669">💡 Consejos para esta semana</h3>${items(a.consejos, "#059669")}
  <p style="margin-top:24px"><a href="https://www.bpos.com.mx/dueno" style="background:#f97316;color:#000;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:bold">Abrir la App del dueño y preguntarle a tu asesor</a></p>
  <p style="color:#a1a1aa;font-size:12px;margin-top:24px">Lo recibes porque lo activaste en la App del dueño → Asesor IA. Para dejar de recibirlo, apágalo ahí. Para temas fiscales, consulta a tu contador.</p>
</div>`;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") || "";
  if (secret ? auth !== `Bearer ${secret}` : !/vercel-cron/i.test(request.headers.get("user-agent") || "")) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return NextResponse.json({ error: "Falta RESEND_API_KEY." }, { status: 503 });

  const db = adminDb();
  const week = weekKey();
  const since = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db.from("bpos_advisor_weekly").select("business_id, email, metrics, metrics_at, last_week").eq("enabled", true).neq("last_week", week);
  const rows = ((data || []) as Row[]).filter((r) => r.email && r.metrics && r.metrics_at && r.metrics_at >= since);
  const cfg = await getAiConfig("asesor");
  const results: { business: string; ok: boolean; note?: string }[] = [];
  const month = new Date().toISOString().slice(0, 7) + "-01";

  for (const row of rows) {
    const note = async (text: string, sent = false) => {
      await db.from("bpos_advisor_weekly").update({ last_error: sent ? "" : text, ...(sent ? { last_week: week } : {}), updated_at: new Date().toISOString() }).eq("business_id", row.business_id);
      results.push({ business: row.business_id, ok: sent, note: text });
    };
    try {
      if (!cfg) {
        await note("Sin clave de IA para el asesor.");
        continue;
      }
      const { data: b } = await db.from("businesses").select("name, plan, plan_status, trial_ends_at, ai_budget_usd").eq("id", row.business_id).maybeSingle();
      const active = b && (b.plan_status === "active" || (b.plan_status === "trial" && b.trial_ends_at && Date.parse(b.trial_ends_at) > Date.now()));
      if (!b || b.plan !== "max" || !active) {
        await note("Sin plan Max activo.");
        continue;
      }
      const { data: usage } = await db.from("ai_usage").select("cost_usd, requests").eq("business_id", row.business_id).eq("month", month).maybeSingle();
      const budget = b.ai_budget_usd !== null && b.ai_budget_usd !== undefined ? Number(b.ai_budget_usd) : 5;
      if (Number(usage?.cost_usd || 0) >= budget) {
        await note("Ya usó su presupuesto de IA del mes.");
        continue;
      }

      const r = await generateJson(cfg, {
        system: SYSTEM,
        schema: AnalysisSchema,
        maxTokens: 6000,
        effort: "medium",
        parts: [{ type: "text", text: `Datos del restaurante (JSON):\n${JSON.stringify(row.metrics).slice(0, 30_000)}\n\n${ANALYZE}` }],
      });
      // Lo que costó, al gasto del mes del negocio
      const cost = aiCost(cfg, r.usage);
      await db.from("ai_usage").upsert({
        business_id: row.business_id,
        month,
        cost_usd: Number(usage?.cost_usd || 0) + cost,
        requests: Number(usage?.requests || 0) + 1,
        updated_at: new Date().toISOString(),
      });
      if (!r.data) {
        await note("El asesor no armó el análisis.");
        continue;
      }

      const business = String((row.metrics as { negocio?: string }).negocio || b.name || "tu negocio");
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Asesor B-POS <asesor@bpos.com.mx>",
          to: [row.email],
          subject: `✨ Tu resumen de la semana · ${business}`,
          html: emailHtml(business, r.data),
          text: `${r.data.resumen}\n\nAlertas:\n${r.data.alertas.map((x) => `- ${x.titulo}: ${x.texto}`).join("\n")}\n\nConsejos:\n${r.data.consejos.map((x) => `- ${x.titulo}: ${x.texto}`).join("\n")}\n\nhttps://www.bpos.com.mx/dueno`,
        }),
      });
      if (!res.ok) {
        await note(`Resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
        continue;
      }
      await note("Enviado", true);
    } catch (e) {
      await note(e instanceof Error ? e.message.slice(0, 200) : "Error");
    }
  }
  return NextResponse.json({ week, sent: results.filter((x) => x.ok).length, results });
}
