"use client";

import { ask, askText, notify } from "@/components/layout/Dialogs";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { getBusinessSettings, getOwnerWhatsapp } from "@/lib/business-settings";
import { emailCashCut } from "@/lib/cash-cut-email";
import { addAuditEvent } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { getCashCloseHistory, voidCashClose, type CashCloseRecord } from "@/lib/cash-history";
import { authorizeAdmin } from "@/lib/permissions";
import { upsertOperationsAlert } from "@/lib/notifications/operationsCenter";
import { exportCuts } from "@/lib/exports";
import { openWhatsapp, whatsappLink } from "@/lib/whatsapp";

export default function CashHistoryPage() {
  const [history, setHistory] = useState<CashCloseRecord[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CashCloseRecord | null>(null);

  useEffect(() => {
    const load = () => setHistory(getCashCloseHistory());
    load();
    window.addEventListener("bpos:cash-history-updated", load);
    return () => window.removeEventListener("bpos:cash-history-updated", load);
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return history;
    return history.filter((record) =>
      `${record.folio} ${record.openedBy || ""} ${record.closedBy || ""} ${record.differenceReason || ""}`
        .toLowerCase()
        .includes(term)
    );
  }, [history, query]);

  function resend(record: CashCloseRecord) {
    const phone = getOwnerWhatsapp() || record.whatsappPhone;
    if (!phone) {
      alert("Configura el WhatsApp del dueño en Configuración → Empresa y propietario.");
      return;
    }
    const message = record.cutMessage || buildFallbackMessage(record);
    openWhatsapp(whatsappLink(phone, message));
    const user = getCurrentUser();
    addAuditEvent({
      category: "Caja",
      action: "cash.close.resent",
      description: `Corte ${record.folio} reenviado por WhatsApp.`,
      entityId: record.id,
      userName: user?.name || "Usuario del sistema",
      metadata: { phone },
    });
  }

  /** Reenvía el corte por correo SOLO al de Configuración → Empresa (no se puede escribir otro: evita desvíos del empleado) */
  async function resendEmail(record: CashCloseRecord) {
    const s = getBusinessSettings();
    const to = (s.cutEmail || s.businessEmail || "").trim().toLowerCase();
    if (!to) {
      alert("No hay correo del negocio. El administrador lo captura en Configuración → Empresa.");
      return;
    }
    if (!(await ask(`¿Enviar el corte ${record.folio} a ${to}?`, { ok: "Enviar" }))) return;
    try {
      await emailCashCut({ folio: record.folio, message: record.cutMessage || buildFallbackMessage(record) }, to);
      const user = getCurrentUser();
      addAuditEvent({
        category: "Caja",
        action: "cash.close.emailed",
        description: `Corte ${record.folio} enviado por correo a ${to}.`,
        entityId: record.id,
        userName: user?.name || "Usuario del sistema",
        metadata: { to },
      });
      alert(`Corte ${record.folio} enviado a ${to}.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo mandar el correo.");
    }
  }

  /**
   * Anular un corte (ej. de pruebas): pide motivo y PIN de administrador. No
   * se borra: queda marcado y sus ventas dejan de contar en reportes y
   * finanzas. Se avisa al celular del dueño.
   */
  async function voidRecord(record: CashCloseRecord) {
    const reason = (await askText(`¿Por qué se anula el corte ${record.folio}? Seguirá viéndose aquí, pero él y sus ventas (${record.orderCount} pedidos, $${record.totalSales.toFixed(2)}) ya no contarán en reportes ni finanzas.`, { placeholder: "Ej. eran pruebas", ok: "Continuar" }))?.trim();
    if (!reason) return;
    if (reason.length < 4) {
      notify("Escribe un motivo más claro.", "error");
      return;
    }
    const user = getCurrentUser();
    const admin = await authorizeAdmin(`anular el corte ${record.folio}`, user);
    if (!admin) return;
    const voided = voidCashClose(record.id, { at: new Date().toISOString(), by: user?.name || "Usuario", authorizedBy: admin, reason: reason.slice(0, 200) });
    if (!voided) return;
    addAuditEvent({
      category: "Caja",
      action: "cash.voided",
      description: `${user?.name || "Usuario"} anuló el corte ${record.folio} del ${new Date(record.closedAt).toLocaleString("es-MX")} (${record.orderCount} pedidos, $${record.totalSales.toFixed(2)}). Autorizó ${admin}. Motivo: ${reason}`,
      entityId: record.id,
      userId: user?.id ? String(user.id) : undefined,
      userName: user?.name || "Usuario del sistema",
      metadata: { folio: record.folio, total: record.totalSales, orders: record.orderCount, reason, authorizedBy: admin, shiftSessionId: record.shiftSessionId },
    });
    // También queda en Alertas (Centro de Operaciones y app del dueño)
    upsertOperationsAlert({
      id: `cash:voided:${record.id}`,
      priority: "info",
      title: `Corte ${record.folio} anulado`,
      message: `${user?.name || "Usuario"} lo anuló (autorizó ${admin}): ${reason}. Sus ventas ya no cuentan.`,
      source: "Caja",
      moduleHref: "/caja/historial",
      metadata: { folio: record.folio, total: record.totalSales },
    });
    notify(`Corte ${record.folio} anulado. Sus ventas ya no cuentan en reportes ni finanzas.`, "ok");
  }

  function printRecord(record: CashCloseRecord) {
    const popup = window.open("", "_blank", "width=820,height=900");
    if (!popup) {
      alert("El navegador bloqueó la ventana de impresión.");
      return;
    }
    popup.document.write(`<!doctype html><html><head><title>${record.folio}</title><style>
      body{font-family:Arial,sans-serif;padding:32px;color:#111}h1{margin:0 0 8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{border:1px solid #ccc;border-radius:12px;padding:14px}.muted{color:#666}.danger{color:#b91c1c}.ok{color:#15803d}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}@media print{button{display:none}}</style></head><body>
      <h1>Corte de caja</h1><div class="muted">${record.folio}</div>
      <p>Apertura: ${new Date(record.openedAt).toLocaleString()}<br/>Cierre: ${new Date(record.closedAt).toLocaleString()}</p>
      <div class="grid"><div class="card">Fondo inicial<br/><b>$${record.openingCash.toFixed(2)}</b></div><div class="card">Ventas<br/><b>$${record.totalSales.toFixed(2)}</b></div><div class="card">Esperado<br/><b>$${record.expectedCash.toFixed(2)}</b></div><div class="card">Contado<br/><b>$${record.countedCash.toFixed(2)}</b></div></div>
      <h2 class="${record.difference === 0 ? "ok" : "danger"}">Diferencia: $${record.difference.toFixed(2)}</h2>
      ${record.differenceReason ? `<p>Motivo: ${escapeHtml(record.differenceReason)}</p>` : ""}
      <h2>Métodos de pago</h2><table><tr><td>Efectivo</td><td>$${record.salesByPayment.cash.toFixed(2)}</td></tr><tr><td>Tarjeta</td><td>$${record.salesByPayment.card.toFixed(2)}</td></tr><tr><td>Transferencia</td><td>$${record.salesByPayment.transfer.toFixed(2)}</td></tr></table>
      <h2>Canales</h2><table><tr><td>Mostrador</td><td>$${record.salesByChannel.counter.toFixed(2)}</td></tr><tr><td>WhatsApp</td><td>$${record.salesByChannel.whatsapp.toFixed(2)}</td></tr><tr><td>Uber Eats</td><td>$${record.salesByChannel.uber.toFixed(2)}</td></tr><tr><td>DiDi Food</td><td>$${record.salesByChannel.didi.toFixed(2)}</td></tr></table>
      <button onclick="window.print()">Imprimir</button></body></html>`);
    popup.document.close();
    popup.focus();
    const user = getCurrentUser();
    addAuditEvent({ category: "Caja", action: "cash.close.printed", description: `Corte ${record.folio} abierto para impresión.`, entityId: record.id, userName: user?.name || "Usuario del sistema" });
  }

  return (
    <AppShell title="Historial de cortes" subtitle="Consulta, reenvía e imprime cierres anteriores.">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar folio, usuario o motivo" className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 md:max-w-xl" />
        <div className="flex gap-2">
          {filtered.length > 0 && (
            <button onClick={() => exportCuts(filtered)} className="rounded-2xl border border-zinc-700 px-5 py-3 font-black">
              📥 Excel
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {filtered.map((record) => (
          <article key={record.id} className={`rounded-3xl border bg-zinc-950 p-6 ${record.voided ? "border-red-500/40 opacity-70" : "border-zinc-800"}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm font-black text-orange-400">
                  {record.folio}
                  {record.voided && <span className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-300">🚫 ANULADO · no cuenta</span>}
                </p>
                <h2 className="mt-1 text-xl font-black">{new Date(record.closedAt).toLocaleDateString()}</h2>
                <p className="mt-2 text-sm text-zinc-400">Apertura: {new Date(record.openedAt).toLocaleString()}</p>
                <p className="text-sm text-zinc-400">Cierre: {new Date(record.closedAt).toLocaleString()}</p>
                <p className="mt-2 text-sm text-zinc-500">Abrió: {record.openedBy || "No registrado"} · Cerró: {record.closedBy || "No registrado"}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Mini label="Ventas" value={`$${record.totalSales.toFixed(2)}`} />
                <Mini label="Esperado" value={`$${record.expectedCash.toFixed(2)}`} />
                <Mini label="Contado" value={`$${record.countedCash.toFixed(2)}`} />
                <Mini label="Diferencia" value={`$${record.difference.toFixed(2)}`} danger={record.difference !== 0} />
              </div>
            </div>
            {record.voided && (
              <p className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">
                Anulado el {new Date(record.voided.at).toLocaleString("es-MX")} por {record.voided.by} (autorizó {record.voided.authorizedBy}). Motivo: {record.voided.reason}
              </p>
            )}
            {record.differenceReason && <p className="mt-4 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-100">Motivo de diferencia: {record.differenceReason}</p>}
            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={() => setSelected(record)} className="rounded-xl bg-orange-500 px-4 py-2 font-black text-black">Ver detalle</button>
              <button onClick={() => resend(record)} className="rounded-xl border border-green-500/40 px-4 py-2 font-black text-green-300">Reenviar WhatsApp</button>
              <button onClick={() => void resendEmail(record)} className="rounded-xl border border-sky-500/40 px-4 py-2 font-black text-sky-300">Enviar por correo</button>
              <button onClick={() => printRecord(record)} className="rounded-xl border border-zinc-700 px-4 py-2 font-black text-zinc-200">Imprimir</button>
              {!record.voided && (
                <button onClick={() => void voidRecord(record)} className="rounded-xl border border-red-500/40 px-4 py-2 font-black text-red-300 hover:bg-red-500/10">
                  🚫 Anular corte
                </button>
              )}
            </div>
          </article>
        ))}
        {filtered.length === 0 && <div className="rounded-3xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">No hay cortes guardados.</div>}
      </div>

      {selected && <DetailModal record={selected} onClose={() => setSelected(null)} />}
    </AppShell>
  );
}

function Mini({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className="rounded-2xl border border-zinc-800 bg-black p-3"><p className="text-xs text-zinc-500">{label}</p><p className={`mt-1 font-black ${danger ? "text-red-400" : "text-orange-400"}`}>{value}</p></div>;
}

function DetailModal({ record, onClose }: { record: CashCloseRecord; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-zinc-700 bg-zinc-950 p-6"><div className="flex items-start justify-between"><div><p className="text-sm font-black text-orange-400">Detalle de corte</p><h2 className="text-2xl font-black">{record.folio}</h2></div><button onClick={onClose} className="text-2xl">✕</button></div><div className="mt-6 grid gap-4 md:grid-cols-2"><Section title="Métodos de pago" rows={[['Efectivo',record.salesByPayment.cash],['Tarjeta',record.salesByPayment.card],['Transferencia',record.salesByPayment.transfer]]}/><Section title="Canales" rows={[['Mostrador',record.salesByChannel.counter],['WhatsApp',record.salesByChannel.whatsapp],['Uber Eats',record.salesByChannel.uber],['DiDi Food',record.salesByChannel.didi],['Otros',record.salesByChannel.other]]}/></div><div className="mt-4 rounded-2xl border border-zinc-800 bg-black p-4"><h3 className="font-black text-orange-400">Movimientos</h3>{record.movements.length===0?<p className="mt-3 text-sm text-zinc-500">Sin movimientos.</p>:record.movements.map(m=><div key={m.id} className="mt-3 border-t border-zinc-800 pt-3 text-sm"><b>{m.type}: ${m.amount.toFixed(2)}</b><p className="text-zinc-400">{m.reason}</p><p className="text-xs text-zinc-600">{new Date(m.createdAt).toLocaleString()}</p></div>)}</div></div></div>;
}

function Section({title,rows}:{title:string;rows:[string,number][]}){return <div className="rounded-2xl border border-zinc-800 bg-black p-4"><h3 className="font-black text-orange-400">{title}</h3>{rows.map(([label,value])=><div key={label} className="mt-3 flex justify-between text-sm"><span className="text-zinc-400">{label}</span><b>${value.toFixed(2)}</b></div>)}</div>}
function buildFallbackMessage(r:CashCloseRecord){return `CORTE DE CAJA\n${r.folio}\nApertura: ${new Date(r.openedAt).toLocaleString()}\nCierre: ${new Date(r.closedAt).toLocaleString()}\nVentas: $${r.totalSales.toFixed(2)}\nEsperado: $${r.expectedCash.toFixed(2)}\nContado: $${r.countedCash.toFixed(2)}\nDiferencia: $${r.difference.toFixed(2)}`}
function escapeHtml(value:string){return value.replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]||c))}
