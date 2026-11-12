"use client";
/**
 * Botoncitos de WhatsApp debajo de una cuenta en espera del POS (solo si
 * tiene WhatsApp): "ya está listo" / "va en camino" y "entregado". Abren
 * WhatsApp con el mensaje escrito; el que ya se mandó queda marcado con la
 * hora para que nadie lo mande dos veces. Si no es del club, lo invita.
 */
import { useEffect, useState } from "react";
import type { SavedOrder } from "@/components/OrderHistoryPanel";
import { getBusinessSettings } from "@/lib/business-settings";
import { getDigitalMenu, whatsappNumber } from "@/lib/digital-menu";
import { getLoyalty, welcomeLabel } from "@/lib/loyalty";
import { findMembers } from "@/lib/loyalty-pos";
import { formatOrderNumber } from "@/lib/order-sequence";
import { NOTICE_LABEL, noticeText, pendingNotices, type PendingNotice } from "@/lib/pending-notices";
import { PUSH_SERVER } from "@/lib/push/rules";
import { openWhatsapp, whatsappLink } from "@/lib/whatsapp";

type Order = SavedOrder & { notices?: Partial<Record<PendingNotice, string>>; localOrderNumber?: number };

const hour = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });

export function PendingNoticeButtons({ order, onSent }: { order: Order; onSent: (notice: PendingNotice, at: string) => void }) {
  const notices = pendingNotices(order);
  const phone = order.details.customerPhone || "";
  // ¿Es del club? null mientras no se sabe (o sin internet): entonces no se invita
  const [member, setMember] = useState<boolean | null>(order.clubAccountId ? true : null);

  useEffect(() => {
    if (order.clubAccountId || !notices.length || !getLoyalty().enabled) return;
    const digits = phone.replace(/\D/g, "").slice(-10);
    let alive = true;
    findMembers(digits)
      .then((found) => alive && setMember(found.some((m) => m.member && m.phone.replace(/\D/g, "").endsWith(digits))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una búsqueda por teléfono
  }, [phone, order.clubAccountId]);

  if (!notices.length) return null;

  const send = (notice: PendingNotice) => {
    const loyalty = getLoyalty();
    const menu = getDigitalMenu();
    const text = noticeText(order, notice, {
      businessName: getBusinessSettings().businessName,
      folio: formatOrderNumber(order),
      member,
      club: loyalty.enabled && menu.slug ? { name: loyalty.name, url: `${PUSH_SERVER}/fidelidad/${menu.slug}`, welcome: welcomeLabel(loyalty) } : null,
      menuUrl: menu.enabled && menu.slug ? `${PUSH_SERVER}/m/${menu.slug}` : "",
    });
    openWhatsapp(whatsappLink(whatsappNumber(phone), text));
    onSent(notice, new Date().toISOString());
  };

  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-800 pt-3">
      {notices.map((notice) => {
        const sentAt = order.notices?.[notice];
        return (
          <button
            key={notice}
            onClick={() => send(notice)}
            title={sentAt ? "Ya se mandó; tócalo para mandarlo otra vez" : "Abre WhatsApp con el mensaje escrito"}
            className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${sentAt ? "border-zinc-700 text-zinc-500" : "border-green-500/50 text-green-300 hover:bg-green-500/10"}`}
          >
            {NOTICE_LABEL[notice]}
            {sentAt ? ` · ✓ ${hour(sentAt)}` : ""}
          </button>
        );
      })}
    </div>
  );
}
