"use client";
/**
 * Ventanita del botón WhatsApp de un pedido: elige qué mandarle al cliente
 * (ticket, listo/en camino, entregado, club, menú o mensaje libre). Si el
 * pedido no tiene WhatsApp, aquí mismo se escribe y se guarda en el pedido.
 * Ver lib/sale-whatsapp.ts.
 */
import { useEffect, useState } from "react";
import type { SavedOrder } from "@/components/OrderHistoryPanel";
import { getBusinessSettings } from "@/lib/business-settings";
import { getDigitalMenu, whatsappNumber } from "@/lib/digital-menu";
import { getLoyalty, welcomeLabel } from "@/lib/loyalty";
import { findMembers } from "@/lib/loyalty-pos";
import { formatOrderNumber } from "@/lib/order-sequence";
import { PUSH_SERVER } from "@/lib/push/rules";
import { loadSavedOrders, saveSavedOrders } from "@/lib/sale-actions";
import { markSaleWhatsapp, SALE_WHATSAPP_LABEL, saleWhatsappOptions, saleWhatsappText, type SaleWhatsappOption } from "@/lib/sale-whatsapp";
import { openWhatsapp, whatsappLink } from "@/lib/whatsapp";

type Order = SavedOrder & { notices?: Partial<Record<string, string>>; localOrderNumber?: number };

const hour = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });

/** Guarda un cambio del pedido (si está en este dispositivo; los del archivo de la nube solo se mandan) */
function saveOrder(updated: Order) {
  const all = loadSavedOrders();
  if (!all.some((o) => o.id === updated.id)) return;
  saveSavedOrders(all.map((o) => (o.id === updated.id ? updated : o)));
}

export function SaleWhatsappDialog({ order: initial, onClose }: { order: Order; onClose: () => void }) {
  const [order, setOrder] = useState<Order>(initial);
  const [typed, setTyped] = useState("");
  const [warn, setWarn] = useState("");
  const phone = whatsappNumber(order.details.customerPhone || "");
  // ¿Es del club? null mientras no se sabe (o sin internet): entonces no se ofrece invitarlo
  const [member, setMember] = useState<boolean | null>(order.clubAccountId ? true : null);

  const loyalty = getLoyalty();
  const menu = getDigitalMenu();
  const club = loyalty.enabled && menu.slug ? { name: loyalty.name, url: `${PUSH_SERVER}/fidelidad/${menu.slug}`, welcome: welcomeLabel(loyalty) } : null;
  const menuUrl = menu.enabled && menu.slug ? `${PUSH_SERVER}/m/${menu.slug}` : "";
  const ctx = { businessName: getBusinessSettings().businessName, folio: formatOrderNumber(order), member, club, menuUrl };

  useEffect(() => {
    if (order.clubAccountId || !phone || !club) return;
    let alive = true;
    const digits = phone.slice(-10);
    findMembers(digits)
      .then((found) => alive && setMember(found.some((m) => m.member && m.phone.replace(/\D/g, "").endsWith(digits))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una búsqueda por teléfono
  }, [phone, order.clubAccountId]);

  function savePhone() {
    const number = whatsappNumber(typed);
    if (!number) {
      setWarn("Escribe un número de 10 dígitos.");
      return;
    }
    const updated = { ...order, details: { ...order.details, customerPhone: typed.replace(/\D/g, "").slice(-10) } };
    setOrder(updated);
    saveOrder(updated);
    setWarn("");
  }

  function send(option: SaleWhatsappOption) {
    if (!phone) return;
    const opened = openWhatsapp(whatsappLink(phone, saleWhatsappText(order, option, ctx)));
    if (!opened) {
      setWarn("El navegador bloqueó WhatsApp. Permite las ventanas emergentes de B-POS y vuelve a tocarlo.");
      return;
    }
    const updated = markSaleWhatsapp(order, option, new Date().toISOString());
    setOrder(updated);
    saveOrder(updated);
  }

  const options = saleWhatsappOptions(order, ctx);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-zinc-700 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black text-green-400">WhatsApp</p>
            <h2 className="text-2xl font-black text-white">Pedido #{ctx.folio}</h2>
            <p className="text-sm text-zinc-400">
              {order.details.customerName || "Sin nombre"}
              {phone ? ` · ${phone.slice(-10)}` : ""}
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-2xl text-zinc-400 hover:text-white">
            ✕
          </button>
        </div>

        {!phone ? (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-zinc-300">Este pedido no tiene WhatsApp. Escríbelo y se guarda en el pedido.</p>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && savePhone()}
              placeholder="WhatsApp (10 dígitos)"
              inputMode="tel"
              autoFocus
              className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-lg text-white"
            />
            <button onClick={savePhone} className="w-full rounded-xl bg-green-500 px-4 py-3 font-black text-black">
              Guardar número
            </button>
          </div>
        ) : (
          <div className="mt-5 grid gap-2">
            {options.map((option) => {
              const sentAt = option === "libre" ? "" : order.notices?.[option];
              return (
                <button
                  key={option}
                  onClick={() => send(option)}
                  title={sentAt ? "Ya se mandó; tócalo para mandarlo otra vez" : "Abre WhatsApp con el mensaje escrito"}
                  className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left font-black ${sentAt ? "border-zinc-800 text-zinc-500" : "border-green-500/40 text-green-200 hover:bg-green-500/10"}`}
                >
                  <span>{SALE_WHATSAPP_LABEL[option]}</span>
                  {sentAt && <span className="shrink-0 text-xs font-bold">✓ {hour(sentAt)}</span>}
                </button>
              );
            })}
          </div>
        )}
        {warn && <p className="mt-3 text-sm font-bold text-red-300">{warn}</p>}
      </div>
    </div>
  );
}
