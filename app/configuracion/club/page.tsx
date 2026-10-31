"use client";
/**
 * Configuración → Club: el club de clientes del restaurante. Nombre, tipo
 * (puntos, sellos o cashback), premios, regalo de bienvenida, botones de
 * comunidad y redes, y el QR que lleva a bpos.com.mx/fidelidad/<liga>.
 */
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { getBusinessSettings } from "@/lib/business-settings";
import { DIGITAL_MENU_EVENT, getDigitalMenu } from "@/lib/digital-menu";
import {
  LOYALTY_EVENT,
  SOCIALS,
  clubName,
  getLoyalty,
  howItWorks,
  saveLoyalty,
  welcomeLabel,
  type LoyaltyConfig,
  type LoyaltyKind,
  type SocialKey,
} from "@/lib/loyalty";
import { PUSH_SERVER as PUBLIC_SITE } from "@/lib/push/rules";

const card = "rounded-3xl border border-zinc-800 bg-zinc-950 p-6";
const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";
const label = "block text-sm font-bold text-zinc-300";

const KINDS: { kind: LoyaltyKind; icon: string; title: string; text: string }[] = [
  { kind: "puntos", icon: "⭐", title: "Puntos", text: "Gana puntos por cada peso y los cambia por premios." },
  { kind: "sellos", icon: "🎟️", title: "Sellos", text: "Un sello por compra; al completar la tarjeta, su premio." },
  { kind: "cashback", icon: "💰", title: "Cashback", text: "Le regresas un % de cada compra como saldo." },
];

/** Liga de una red: se guarda al salir del campo (a medio escribir no es válida) */
function LinkField({ k, value, onChange }: { k: (typeof SOCIALS)[number]; value: { on: boolean; url: string }; onChange: (v: { on: boolean; url: string }) => void }) {
  const [draft, setDraft] = useState(value.url);
  const bad = draft && !/^https:\/\/\S+$/i.test(draft);
  return (
    <div className={`rounded-2xl border p-3 ${value.on ? "border-zinc-700" : "border-zinc-900 opacity-60"}`}>
      <label className="flex items-center gap-2 font-black">
        <input type="checkbox" checked={value.on} onChange={(e) => onChange({ ...value, on: e.target.checked })} className="h-5 w-5 accent-orange-500" />
        <span>{k.icon}</span> {k.label}
        {!value.on && <span className="ml-auto text-xs font-bold text-zinc-500">Apagado</span>}
      </label>
      {value.on && (
        <>
          <input value={draft} onChange={(e) => setDraft(e.target.value.trim())} onBlur={() => onChange({ ...value, url: draft })} placeholder={k.hint} className={`${input} mt-2 text-sm`} />
          {bad && <p className="mt-1 text-xs text-red-300">La liga debe empezar con https://</p>}
          {!draft && <p className="mt-1 text-xs text-yellow-300">Pon la liga para que el botón aparezca.</p>}
        </>
      )}
    </div>
  );
}

export default function ClubPage() {
  const [c, setC] = useState<LoyaltyConfig | null>(null);
  const [slug, setSlug] = useState("");
  const [qr, setQr] = useState("");
  const [rewardName, setRewardName] = useState("");
  const [rewardPoints, setRewardPoints] = useState("");
  const business = getBusinessSettings().businessName || "tu restaurante";
  const link = slug ? `${PUBLIC_SITE}/fidelidad/${slug}` : "";

  useEffect(() => {
    const load = () => {
      setC(getLoyalty());
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

  useEffect(() => {
    if (!link) return;
    void QRCode.toDataURL(link, { margin: 1, width: 600 }).then(setQr);
  }, [link]);

  if (!c) return null;
  const update = (patch: Partial<LoyaltyConfig>) => setC(saveLoyalty(patch));
  const setLink = (key: SocialKey, v: { on: boolean; url: string }) => update({ links: { ...c.links, [key]: v } });
  const name = clubName(c, business);

  function printQr() {
    if (!qr || !c) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const safe = (s: string) => s.replace(/[<>&"]/g, "");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR ${safe(name)}</title><style>
      body{font-family:Arial,sans-serif;text-align:center;padding:40px} img{width:340px} h1{margin:8px 0} p{color:#444;font-size:18px}
    </style></head><body><h1>${safe(name)}</h1><p>${safe(howItWorks(c))}</p><img src="${qr}"/><p><b>Escanea y únete gratis</b></p>
    ${welcomeLabel(c) ? `<p>🎁 ${safe(welcomeLabel(c))}</p>` : ""}<p style="font-size:13px;color:#888">${safe(link)}</p>
    <script>setTimeout(()=>print(),300)</script></body></html>`);
    w.document.close();
  }

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Club de clientes" subtitle="Tu programa de fidelidad: tus clientes juntan puntos, sellos o saldo y regresan más seguido.">
        <div className="space-y-6">
          <section className={card}>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={c.enabled} onChange={(e) => update({ enabled: e.target.checked })} className="mt-1 h-6 w-6 accent-orange-500" />
              <span>
                <span className="text-lg font-black">Club activado</span>
                <span className="block text-sm text-zinc-500">Apagado, nadie se puede unir ni juntar. Lo que ya tienen tus socios se guarda.</span>
              </span>
            </label>
            <label className={`${label} mt-4`}>
              Nombre del club
              <input value={c.name} maxLength={40} placeholder={`Club ${business}`} onChange={(e) => update({ name: e.target.value })} className={`${input} mt-1`} />
            </label>
          </section>

          <section className={card}>
            <h2 className="text-lg font-black">¿Cómo juntan tus clientes?</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {KINDS.map((k) => (
                <button
                  key={k.kind}
                  onClick={() => update({ kind: k.kind })}
                  className={`rounded-2xl border p-4 text-left ${c.kind === k.kind ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 bg-black"}`}
                >
                  <p className="text-2xl">{k.icon}</p>
                  <p className="font-black">{k.title}</p>
                  <p className="text-xs text-zinc-400">{k.text}</p>
                </button>
              ))}
            </div>

            {c.kind === "puntos" && (
              <div className="mt-5 space-y-4">
                <label className={label}>
                  1 punto por cada $
                  <input type="number" min={1} value={c.pesosPerPoint} onChange={(e) => update({ pesosPerPoint: Number(e.target.value) || 10 })} className={`${input} mt-1 md:w-48`} />
                </label>
                <div>
                  <p className={label}>Premios para canjear</p>
                  <div className="mt-2 space-y-2">
                    {c.rewards.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 rounded-2xl bg-black p-3 text-sm">
                        <span className="flex-1 font-bold">{r.name}</span>
                        <span className="font-black text-orange-300">{r.points} pts</span>
                        <button onClick={() => update({ rewards: c.rewards.filter((x) => x.id !== r.id) })} className="px-2 text-red-300" aria-label="Quitar">✕</button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-[1fr_8rem_auto]">
                    <input value={rewardName} onChange={(e) => setRewardName(e.target.value)} placeholder="Papas gratis" className={input} />
                    <input type="number" min={1} value={rewardPoints} onChange={(e) => setRewardPoints(e.target.value)} placeholder="Puntos" className={input} />
                    <button
                      onClick={() => {
                        if (!rewardName.trim() || !(Number(rewardPoints) > 0)) return;
                        update({ rewards: [...c.rewards, { id: Math.random().toString(36).slice(2, 8), name: rewardName.trim(), points: Math.round(Number(rewardPoints)) }] });
                        setRewardName("");
                        setRewardPoints("");
                      }}
                      className="rounded-2xl bg-orange-500 px-4 py-3 font-black text-black"
                    >
                      Agregar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {c.kind === "sellos" && (
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <label className={label}>
                  Sellos para el premio
                  <input type="number" min={2} max={30} value={c.stampsGoal} onChange={(e) => update({ stampsGoal: Number(e.target.value) || 6 })} className={`${input} mt-1`} />
                </label>
                <label className={label}>
                  Premio
                  <input value={c.stampReward} maxLength={80} placeholder="1 hamburguesa gratis" onChange={(e) => update({ stampReward: e.target.value })} className={`${input} mt-1`} />
                </label>
                <label className={label}>
                  Compra mínima para el sello $
                  <input type="number" min={0} value={c.stampMinPurchase || ""} placeholder="0 = cualquiera" onChange={(e) => update({ stampMinPurchase: Number(e.target.value) || 0 })} className={`${input} mt-1`} />
                </label>
              </div>
            )}

            {c.kind === "cashback" && (
              <label className={`${label} mt-5`}>
                % que regresa como saldo
                <input type="number" min={0.5} max={50} step={0.5} value={c.cashbackPercent} onChange={(e) => update({ cashbackPercent: Number(e.target.value) || 5 })} className={`${input} mt-1 md:w-48`} />
              </label>
            )}
            <p className="mt-4 rounded-2xl bg-black p-3 text-sm text-zinc-300">Tus clientes verán: <b className="text-white">{howItWorks(c)}</b></p>
          </section>

          <section className={card}>
            <h2 className="text-lg font-black">🎁 Regalo de bienvenida</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className={label}>
                {c.kind === "sellos" ? "Sellos de regalo" : c.kind === "cashback" ? "Saldo de regalo $" : "Puntos de regalo"} (0 = ninguno)
                <input type="number" min={0} value={c.welcomeAmount || ""} onChange={(e) => update({ welcomeAmount: Number(e.target.value) || 0 })} className={`${input} mt-1`} />
              </label>
              <label className={label}>
                Otro regalo (opcional)
                <input value={c.welcomeText} maxLength={100} placeholder="Papas gratis en tu siguiente visita" onChange={(e) => update({ welcomeText: e.target.value })} className={`${input} mt-1`} />
              </label>
            </div>
            {welcomeLabel(c) && <p className="mt-3 text-sm text-zinc-300">Al unirse: <b className="text-white">{welcomeLabel(c)}</b></p>}
          </section>

          <section className={card}>
            <h2 className="text-lg font-black">📣 Comunidad y redes</h2>
            <p className="mt-1 text-sm text-zinc-500">Botones en la página del club. Solo aparecen los que actives con su liga.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {SOCIALS.map((s) => (
                <LinkField key={s.key} k={s} value={c.links[s.key]} onChange={(v) => setLink(s.key, v)} />
              ))}
            </div>
            <label className={`${label} mt-4`}>
              Reglas del club (opcional)
              <textarea value={c.terms} maxLength={500} rows={3} placeholder="Los puntos vencen al año. No acumulable con otras promociones." onChange={(e) => update({ terms: e.target.value })} className={`${input} mt-1`} />
            </label>
          </section>

          <section className={card}>
            <h2 className="text-lg font-black">🔳 QR para tu restaurante</h2>
            {!slug ? (
              <p className="mt-2 text-sm text-yellow-300">Primero elige la liga de tu menú en Configuración → Menú digital.</p>
            ) : (
              <div className="mt-4 flex flex-wrap items-center gap-5">
                {/* eslint-disable-next-line @next/next/no-img-element -- QR generado aquí */}
                {qr && <img src={qr} alt="QR del club" className="h-40 w-40 rounded-2xl bg-white p-2" />}
                <div className="space-y-2">
                  <p className="text-sm text-zinc-400">Tus clientes lo escanean, entran con su cuenta y ven su tarjeta.</p>
                  <a href={link} target="_blank" rel="noreferrer" className="block font-mono text-sm text-orange-300 underline">{link}</a>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={printQr} className="rounded-2xl bg-orange-500 px-4 py-2 font-black text-black">🖨️ Imprimir QR</button>
                    {qr && (
                      <a href={qr} download={`club-${slug}.png`} className="rounded-2xl border border-zinc-700 px-4 py-2 font-black">
                        Descargar QR
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </AppShell>
    </RequireRole>
  );
}
