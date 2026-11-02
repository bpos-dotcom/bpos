"use client";
/**
 * Configuración → Club → "Tarjeta en Google Wallet": cómo se ve la tarjeta
 * del club en el celular (portada, color, tipo de código, texto) con vista
 * previa, y los avisos que llegan como notificación a todas las tarjetas.
 * Cada cambio se manda a Google (lib/customer-accounts/wallet.ts) para que
 * las tarjetas ya guardadas también cambien.
 */
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { aiFetch } from "@/lib/ai/client";
import { BARCODES, clubName, howItWorks, type LoyaltyConfig } from "@/lib/loyalty";
import { uploadBusinessImage } from "@/lib/media";

const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";
const label = "block text-sm font-bold text-zinc-300";

type Props = {
  c: LoyaltyConfig;
  update: (patch: Partial<LoyaltyConfig>) => void;
  business: string;
  brandColor: string;
  brandLogo: string;
  slug: string;
};

async function call<T>(body: object): Promise<T> {
  const r = await aiFetch("/api/club/wallet", { method: "POST", body: JSON.stringify(body) });
  const b = await r.json().catch(() => null);
  if (!r.ok || !b?.success) throw new Error(b?.error || "No se pudo.");
  return b as T;
}

/** Vista previa: imita la tarjeta de fidelidad de Google Wallet */
function Preview({ c, business, brandColor, brandLogo }: { c: LoyaltyConfig; business: string; brandColor: string; brandLogo: string }) {
  const [qr, setQr] = useState("");
  const color = c.cardColor || brandColor;
  const name = clubName(c, business);
  const sample = c.kind === "sellos" ? `4 de ${c.stampsGoal} sellos` : c.kind === "cashback" ? "$85 de saldo" : "120 puntos";
  useEffect(() => {
    if (c.cardBarcode === "QR_CODE" || c.cardBarcode === "AZTEC") void QRCode.toDataURL("BP-4K7Q2", { margin: 0, width: 180 }).then(setQr);
  }, [c.cardBarcode]);
  // Google decide si el texto va blanco o negro según el fondo
  const dark = (() => {
    const n = parseInt(color.slice(1), 16);
    const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return l < 0.6;
  })();
  const fg = dark ? "text-white" : "text-black";
  const muted = dark ? "text-white/70" : "text-black/60";
  return (
    <div className={`w-full max-w-xs overflow-hidden rounded-3xl shadow-xl ${fg}`} style={{ background: color }}>
      <div className="flex items-center gap-3 p-4">
        {brandLogo ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo del negocio
          <img src={brandLogo} alt="" className="h-9 w-9 rounded-full bg-white object-contain p-0.5" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-lg font-black text-black">{business.slice(0, 1)}</div>
        )}
        <p className="text-sm font-bold">{business}</p>
      </div>
      <p className="px-4 text-xl font-black leading-tight">{name}</p>
      <div className="mt-3 grid grid-cols-2 gap-3 px-4">
        <div>
          <p className={`text-[11px] font-bold uppercase ${muted}`}>{c.kind === "sellos" ? "Sellos" : c.kind === "cashback" ? "Saldo" : "Puntos"}</p>
          <p className="font-black">{sample}</p>
        </div>
        <div>
          <p className={`text-[11px] font-bold uppercase ${muted}`}>Socio</p>
          <p className="font-black">Ana López</p>
        </div>
      </div>
      <div className="mx-4 mt-4 rounded-2xl bg-white p-3 text-center text-black">
        {(c.cardBarcode === "QR_CODE" || c.cardBarcode === "AZTEC") && qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- QR de muestra
          <img src={qr} alt="" className="mx-auto h-28 w-28" />
        ) : (
          <div className="mx-auto flex h-14 w-48 items-end justify-center gap-[2px]">
            {Array.from({ length: 40 }).map((_, i) => (
              <span key={i} className="block bg-black" style={{ width: (i * 7) % 3 === 0 ? 3 : 1, height: c.cardBarcode === "PDF_417" ? 40 : 56 }} />
            ))}
          </div>
        )}
        <p className="mt-1 font-mono text-xs">BP-4K7Q2</p>
      </div>
      {c.cardHero ? (
        // eslint-disable-next-line @next/next/no-img-element -- portada del negocio
        <img src={c.cardHero} alt="" className="mt-4 aspect-[3/1] w-full object-cover" />
      ) : (
        <div className="mt-4 h-2" />
      )}
      <div className={`space-y-2 p-4 text-sm ${dark ? "bg-black/20" : "bg-white/40"}`}>
        {c.cardNote.trim() && (
          <div>
            <p className={`text-[11px] font-bold uppercase ${muted}`}>{name}</p>
            <p>{c.cardNote.trim()}</p>
          </div>
        )}
        <div>
          <p className={`text-[11px] font-bold uppercase ${muted}`}>Cómo funciona</p>
          <p>{howItWorks(c)}</p>
        </div>
      </div>
    </div>
  );
}

export default function WalletCardSettings({ c, update, business, brandColor, brandLogo, slug }: Props) {
  const [uploading, setUploading] = useState(false);
  const [sync, setSync] = useState<{ state: "idle" | "sending" | "ok" | "error"; text: string }>({ state: "idle", text: "" });
  const [saved, setSaved] = useState<number | null>(null);
  const [ready, setReady] = useState(true);
  const [header, setHeader] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState("");
  const first = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    aiFetch("/api/club/wallet")
      .then((r) => r.json())
      .then((b) => {
        if (b?.success) {
          setSaved(Number(b.saved) || 0);
          setReady(Boolean(b.ready));
        }
      })
      .catch(() => undefined);
  }, []);

  // Cada cambio del club se manda a Google un par de segundos después (las tarjetas ya guardadas cambian solas)
  const fingerprint = JSON.stringify([c.enabled, c.name, c.kind, c.pesosPerPoint, c.stampsGoal, c.stampReward, c.stampMinPurchase, c.cashbackPercent, c.links, c.cardHero, c.cardColor, c.cardBarcode, c.cardNote]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!c.enabled || !slug) return;
    if (timer.current) clearTimeout(timer.current);
    const pending = setTimeout(() => setSync({ state: "sending", text: "Guardando en Google Wallet..." }), 0);
    timer.current = setTimeout(() => {
      call<{ result?: string; skipped?: string }>({ accion: "clase", config: c })
        .then(() => setSync({ state: "ok", text: "Tarjeta actualizada en Google Wallet ✓" }))
        .catch((e) => setSync({ state: "error", text: e instanceof Error ? e.message : "No se pudo actualizar en Google Wallet." }));
    }, 2000);
    return () => {
      clearTimeout(pending);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando cambia algo que va en la tarjeta
  }, [fingerprint, slug]);

  async function pickHero(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      update({ cardHero: await uploadBusinessImage(file, "club", 1200) });
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo subir la imagen.");
    } finally {
      setUploading(false);
    }
  }

  async function sendNotice() {
    setSending(true);
    setSent("");
    try {
      await call({ accion: "aviso", header, body });
      setSent(`Aviso enviado a ${saved ?? "las"} tarjetas ✓`);
      setHeader("");
      setBody("");
    } catch (e) {
      setSent(e instanceof Error ? e.message : "No se pudo mandar.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h2 className="text-lg font-black">👛 Tarjeta en Google Wallet</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Así se ve el club en el celular de tus clientes. Lo que cambies aquí se actualiza solo en las tarjetas que ya guardaron.
          {saved !== null && (
            <>
              {" "}
              <b className="text-zinc-300">{saved}</b> {saved === 1 ? "socio la tiene" : "socios la tienen"} en su celular.
            </>
          )}
        </p>
        {!ready && <p className="mt-2 text-sm text-yellow-300">Google Wallet todavía no está activado en B-POS.</p>}
        <div className="mt-5 grid gap-6 md:grid-cols-[1fr_auto]">
          <div className="space-y-4">
            <div>
              <span className={label}>Imagen de portada (opcional)</span>
              <p className="text-xs text-zinc-500">Franja ancha debajo del código. Ideal 1032 × 336 píxeles (3:1), por ejemplo una foto de tu platillo estrella.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="cursor-pointer rounded-2xl border border-zinc-700 px-4 py-2 text-sm font-black">
                  {uploading ? "Subiendo..." : c.cardHero ? "Cambiar imagen" : "Subir imagen"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploading} onChange={(e) => void pickHero(e.target.files?.[0])} />
                </label>
                {c.cardHero && (
                  <button onClick={() => update({ cardHero: "" })} className="rounded-2xl px-3 py-2 text-sm font-bold text-red-300">
                    Quitar
                  </button>
                )}
              </div>
            </div>
            <div>
              <span className={label}>Color de la tarjeta</span>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <input type="color" value={c.cardColor || brandColor} onChange={(e) => update({ cardColor: e.target.value })} className="h-11 w-16 cursor-pointer rounded-xl border border-zinc-700 bg-black" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!c.cardColor} onChange={(e) => update({ cardColor: e.target.checked ? "" : brandColor })} className="h-5 w-5 accent-orange-500" />
                  Usar el color de mi marca ({brandColor})
                </label>
              </div>
            </div>
            <div>
              <span className={label}>Tipo de código</span>
              <p className="text-xs text-zinc-500">Es el que escanean en caja para encontrar al socio. El dibujo lo genera Google; no se le puede cambiar el color ni ponerle logo.</p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {BARCODES.map((b) => (
                  <button
                    key={b.type}
                    onClick={() => update({ cardBarcode: b.type })}
                    title={b.hint}
                    className={`rounded-2xl border px-3 py-2 text-sm font-black ${c.cardBarcode === b.type ? "border-orange-500 bg-orange-500/10 text-orange-300" : "border-zinc-800 text-zinc-300"}`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
            <label className={label}>
              Texto en la tarjeta (opcional)
              <textarea value={c.cardNote} maxLength={200} rows={2} placeholder="Muestra tu tarjeta en caja antes de pagar. Martes 2x1 para socios." onChange={(e) => update({ cardNote: e.target.value })} className={`${input} mt-1`} />
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-zinc-800 px-4 py-3">
              <input type="checkbox" checked={c.cardNotify} onChange={(e) => update({ cardNotify: e.target.checked })} className="mt-1 h-5 w-5 accent-orange-500" />
              <span>
                <span className="block text-sm font-black">Avisar al socio cada vez que suma o canjea</span>
                <span className="block text-xs text-zinc-400">
                  Le llega una notificación a su tarjeta con lo que ganó y lo que le falta
                  {c.kind === "sellos" ? ' ("¡Sumaste 1 sello! Llevas 5 de 6...")' : c.kind === "cashback" ? ' ("¡Ganaste $12 de saldo! Ya tienes $85...")' : ' ("¡Sumaste 12 puntos! Te faltan 30 para...")'}. Google permite 3 avisos al
                  día por tarjeta.
                </span>
              </span>
            </label>
            {sync.state !== "idle" && (
              <p className={`text-sm font-bold ${sync.state === "error" ? "text-red-300" : sync.state === "ok" ? "text-green-300" : "text-zinc-400"}`}>{sync.text}</p>
            )}
          </div>
          <div className="flex justify-center md:justify-end">
            <Preview c={c} business={business} brandColor={brandColor} brandLogo={brandLogo} />
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h2 className="text-lg font-black">🔔 Aviso a las tarjetas</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Llega como notificación al celular de todos los socios que tienen tu tarjeta en Google Wallet. Google permite hasta 3 avisos al día.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_2fr]">
          <label className={label}>
            Título
            <input value={header} maxLength={40} placeholder="Martes de 2x1" onChange={(e) => setHeader(e.target.value)} className={`${input} mt-1`} />
          </label>
          <label className={label}>
            Mensaje
            <input value={body} maxLength={300} placeholder="Hoy todas las hamburguesas al 2x1 para socios del club. ¡Te esperamos!" onChange={(e) => setBody(e.target.value)} className={`${input} mt-1`} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            disabled={sending || header.trim().length < 2 || body.trim().length < 2 || !ready}
            onClick={() => void sendNotice()}
            className="rounded-2xl bg-orange-500 px-5 py-2 font-black text-black disabled:opacity-40"
          >
            {sending ? "Enviando..." : "Enviar aviso"}
          </button>
          {sent && <p className={`text-sm font-bold ${sent.endsWith("✓") ? "text-green-300" : "text-red-300"}`}>{sent}</p>}
        </div>
      </section>
    </>
  );
}
