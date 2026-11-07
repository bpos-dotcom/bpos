"use client";
/**
 * B-POS Servicios → Tarjetas de lealtad → Capturar compra: para el
 * restaurante que usa otro punto de venta. El cajero busca al cliente por
 * teléfono o escanea el QR de su tarjeta, escribe cuánto pagó y se le suman
 * puntos, sellos o cashback (las mismas funciones del club en la nube que
 * usa el POS); ahí mismo canjea premios. Los nuevos se unen con el QR.
 */
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import RequirePermission from "@/components/auth/RequirePermission";
import { AppShell } from "@/components/layout/AppShell";
import { ClubPanel } from "@/components/club/ClubPanel";
import { getCurrentUser } from "@/lib/auth";
import { LOYALTY_EVENT, balanceLabel, clubName, getLoyalty, type LoyaltyConfig } from "@/lib/loyalty";
import { earnLoyalty, type ClubMember } from "@/lib/loyalty-pos";
import { DIGITAL_MENU_EVENT, getDigitalMenu } from "@/lib/digital-menu";
import { getBusinessSettings } from "@/lib/business-settings";
import { PUSH_SERVER as PUBLIC_SITE } from "@/lib/push/rules";

const mxn = (n: number) => `$${(Number.isFinite(n) ? n : 0).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function LoyaltyCapturePage() {
  const [config, setConfig] = useState<LoyaltyConfig | null>(null);
  const [slug, setSlug] = useState("");
  const [qr, setQr] = useState("");
  const [member, setMember] = useState<ClubMember | null>(null);
  const [amount, setAmount] = useState("");
  const [ticket, setTicket] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const load = () => {
      setConfig(getLoyalty());
      setSlug(getDigitalMenu().slug);
    };
    load();
    window.addEventListener(LOYALTY_EVENT, load);
    window.addEventListener(DIGITAL_MENU_EVENT, load);
    return () => {
      window.removeEventListener(LOYALTY_EVENT, load);
      window.removeEventListener(DIGITAL_MENU_EVENT, load);
    };
  }, []);

  const link = slug ? `${PUBLIC_SITE}/fidelidad/${slug}` : "";
  useEffect(() => {
    if (link) void QRCode.toDataURL(link, { margin: 1, width: 400 }).then(setQr);
  }, [link]);

  async function earn() {
    if (!member) return;
    const total = Number(amount);
    if (!(total > 0)) return setMessage({ ok: false, text: "Escribe cuánto pagó el cliente." });
    if (!member.member) return setMessage({ ok: false, text: "Este cliente todavía no es socio del club: pídele que se una con el QR." });
    setBusy(true);
    setMessage(null);
    try {
      const ref = `servicio:${ticket.trim() || Date.now()}`;
      const r = await earnLoyalty(member.account_id, total, ref, getCurrentUser()?.name || "");
      if (!r?.member) throw new Error("No se pudo sumar: revisa que el club esté activado.");
      const next = { ...member, points: r.points ?? member.points, stamps: r.stamps ?? member.stamps, cashback: r.cashback ?? member.cashback };
      setMember(next);
      const earned = r.earned ? balanceLabel(config!, r.earned) : "";
      setMessage({ ok: true, text: `✅ Compra de ${mxn(total)} sumada a ${member.name || member.phone}${earned ? `: +${earned}` : ""}. Ahora tiene ${balanceLabel(config!, next)}.` });
      setAmount("");
      setTicket("");
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "No se pudo sumar la compra." });
    }
    setBusy(false);
  }

  const business = getBusinessSettings().businessName || "";
  return (
    <RequirePermission permission="customers.view">
      <AppShell title="Tarjetas de lealtad" subtitle="Suma las compras de tus clientes y canjea sus premios.">
        <div className="grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {config && !config.enabled ? (
              <section className="rounded-3xl border border-orange-500/40 bg-zinc-950 p-6">
                <p className="text-lg font-black">Activa tu club primero</p>
                <p className="mt-1 text-sm text-zinc-400">Elige si tus clientes juntan puntos, sellos o cashback, el regalo de bienvenida y cómo se ve su tarjeta.</p>
                <Link href="/configuracion/club" className="mt-4 inline-block rounded-2xl bg-orange-500 px-5 py-3 font-black text-black">
                  Configurar mi club
                </Link>
              </section>
            ) : (
              <>
                <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
                  <p className="text-lg font-black">1. Busca al cliente</p>
                  <p className="text-sm text-zinc-400">Teléfono de 10 dígitos o escanea el QR de su tarjeta.</p>
                  <div className="mt-3">
                    <ClubPanel
                      member={member}
                      onChange={(m) => {
                        setMember(m);
                        setMessage(null);
                      }}
                    />
                  </div>
                </section>
                {member && (
                  <section className="rounded-3xl border border-orange-500/40 bg-zinc-950 p-5">
                    <p className="text-lg font-black">2. ¿Cuánto pagó?</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void earn()}
                        placeholder="$ total de la compra"
                        className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-2xl font-black text-white"
                      />
                      <input value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="Ticket o folio (opcional)" className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white" />
                      <button disabled={busy} onClick={() => void earn()} className="rounded-2xl bg-orange-500 px-6 py-3 font-black text-black disabled:opacity-50">
                        {busy ? "Sumando..." : "Sumar compra"}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">Con el folio de tu ticket, la misma compra no se suma dos veces.</p>
                  </section>
                )}
                {message && <p className={`rounded-2xl border p-3 text-sm ${message.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-red-500/40 bg-red-500/10 text-red-200"}`}>{message.text}</p>}
              </>
            )}
          </div>

          <aside className="space-y-4">
            <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5 text-center">
              <p className="font-black">📲 Clientes nuevos</p>
              <p className="mt-1 text-sm text-zinc-400">Que escaneen este QR para unirse a {config ? clubName(config, business) : "tu club"} y guardar su tarjeta en Google Wallet.</p>
              {link ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- QR generado aquí */}
                  {qr && <img src={qr} alt="QR para unirse al club" className="mx-auto mt-3 h-44 w-44 rounded-2xl bg-white p-2" />}
                  <p className="mt-2 break-all text-xs text-zinc-500">{link}</p>
                </>
              ) : (
                <Link href="/configuracion/club" className="mt-3 inline-block rounded-2xl border border-orange-500 px-4 py-2 text-sm font-black text-orange-300">
                  Elegir la liga de mi club
                </Link>
              )}
            </section>
            <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5 text-sm">
              <Link href="/configuracion/club" className="block rounded-2xl border border-zinc-800 p-3 font-black hover:border-orange-500">
                ⚙️ Configurar club, premios y tarjeta
              </Link>
              <Link href="/clientes" className="mt-2 block rounded-2xl border border-zinc-800 p-3 font-black hover:border-orange-500">
                👥 Mis clientes y campañas por WhatsApp
              </Link>
            </section>
          </aside>
        </div>
      </AppShell>
    </RequirePermission>
  );
}
