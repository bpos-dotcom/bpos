"use client";
/**
 * Club del restaurante: bpos.com.mx/fidelidad/<liga> (el QR del local lleva
 * aquí). Si el cliente ya entró en la tienda de ese restaurante en este
 * celular, entra solo (misma sesión); si no, con su teléfono y contraseña o
 * se registra. Ve su tarjeta como imagen (para guardarla), el botón de
 * Google Wallet, sus movimientos y los botones de comunidad y redes.
 */
import { use, useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { AccountSheet, callAccount, useCustomer } from "@/components/menu/CustomerAccount";
import { SOCIALS, type SocialKey } from "@/lib/loyalty";

type Club = {
  enabled: boolean;
  name: string;
  kind: "puntos" | "sellos" | "cashback";
  how: string;
  welcome: string;
  rewards: { name: string; points: number }[];
  stampsGoal: number;
  stampReward: string;
  links: Partial<Record<SocialKey, string>>;
  terms: string;
};
type Member = { code: string; points: number; stamps: number; cashback: number; joined_at: string };
type Movement = { kind: string; points: number; stamps: number; cashback: number; amount: number; note: string; created_at: string };
type ClubData = { business: { name: string; color: string; logo: string; slug: string }; club: Club; member: Member | null; movements: Movement[]; wallet: boolean };

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function balanceText(club: Club, m: Member) {
  if (club.kind === "sellos") return `${m.stamps} de ${club.stampsGoal} sellos`;
  if (club.kind === "cashback") return `${money(m.cashback)} de saldo`;
  return `${Math.floor(Number(m.points))} puntos`;
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

/** Dibuja la tarjeta (1000 × 630) y la regresa como imagen PNG */
async function drawCard(data: ClubData, member: Member, customer: string) {
  const { business, club } = data;
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 630;
  const g = canvas.getContext("2d")!;
  const round = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  // Fondo con el color del restaurante
  const grad = g.createLinearGradient(0, 0, 1000, 630);
  grad.addColorStop(0, business.color);
  grad.addColorStop(1, "#18181b");
  round(0, 0, 1000, 630, 48);
  g.fillStyle = grad;
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.08)";
  g.beginPath();
  g.arc(880, 80, 260, 0, Math.PI * 2);
  g.fill();

  // Logo
  const logo = await loadImage(business.logo);
  round(50, 50, 120, 120, 28);
  g.fillStyle = "#ffffff";
  g.fill();
  if (logo) {
    const s = Math.min(100 / logo.width, 100 / logo.height);
    g.drawImage(logo, 110 - (logo.width * s) / 2, 110 - (logo.height * s) / 2, logo.width * s, logo.height * s);
  }

  g.fillStyle = "#ffffff";
  g.font = "900 46px Arial, sans-serif";
  g.fillText(club.name.slice(0, 26), 200, 102);
  g.font = "600 28px Arial, sans-serif";
  g.globalAlpha = 0.85;
  g.fillText(business.name.slice(0, 34), 200, 145);
  g.globalAlpha = 1;

  // Saldo
  g.font = "700 26px Arial, sans-serif";
  g.globalAlpha = 0.8;
  g.fillText(club.kind === "sellos" ? "TUS SELLOS" : club.kind === "cashback" ? "TU SALDO" : "TUS PUNTOS", 50, 270);
  g.globalAlpha = 1;
  if (club.kind === "sellos") {
    const goal = Math.min(club.stampsGoal, 12);
    const size = goal > 8 ? 46 : 58;
    for (let i = 0; i < goal; i += 1) {
      const x = 50 + (i % 6) * (size + 16) + size / 2;
      const y = 320 + Math.floor(i / 6) * (size + 14) + size / 2;
      g.beginPath();
      g.arc(x, y, size / 2, 0, Math.PI * 2);
      g.fillStyle = i < member.stamps ? "#ffffff" : "rgba(255,255,255,0.18)";
      g.fill();
      if (i < member.stamps) {
        g.fillStyle = business.color;
        g.font = `900 ${size * 0.55}px Arial, sans-serif`;
        g.textAlign = "center";
        g.fillText("★", x, y + size * 0.2);
        g.textAlign = "left";
      }
    }
  } else {
    g.font = "900 96px Arial, sans-serif";
    g.fillStyle = "#ffffff";
    g.fillText(club.kind === "cashback" ? money(member.cashback) : String(Math.floor(Number(member.points))), 50, 370);
  }

  // Socio
  g.fillStyle = "#ffffff";
  g.font = "800 34px Arial, sans-serif";
  g.fillText(customer.slice(0, 28), 50, 540);
  g.font = "600 24px monospace";
  g.globalAlpha = 0.8;
  g.fillText(`Socio ${member.code}`, 50, 580);
  g.globalAlpha = 1;

  // QR para la caja
  const qr = await loadImage(await QRCode.toDataURL(member.code, { margin: 1, width: 400 }));
  round(690, 300, 260, 280, 28);
  g.fillStyle = "#ffffff";
  g.fill();
  if (qr) g.drawImage(qr, 710, 315, 220, 220);
  g.fillStyle = "#18181b";
  g.font = "700 20px Arial, sans-serif";
  g.textAlign = "center";
  g.fillText("Muéstralo en caja", 820, 562);
  g.textAlign = "left";
  return canvas.toDataURL("image/png");
}

export default function FidelidadPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const customer = useCustomer(slug);
  const [data, setData] = useState<ClubData | null>(null);
  const [error, setError] = useState("");
  const [card, setCard] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<"entrar" | "registro" | null>(null);
  const [walletError, setWalletError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await callAccount<ClubData>("club", slug, {}, customer.token));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el club.");
    }
  }, [slug, customer.token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga desde el servidor (con la sesión del celular si hay)
    void load();
  }, [load]);

  const member = data?.member;
  const name = customer.account?.name || "";
  useEffect(() => {
    if (!data || !member) return;
    let alive = true;
    void drawCard(data, member, name).then((png) => alive && setCard(png));
    return () => {
      alive = false;
    };
  }, [data, member, name]);

  async function join() {
    setBusy(true);
    try {
      setData(await callAccount<ClubData>("unirme", slug, {}, customer.token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo.");
    } finally {
      setBusy(false);
    }
  }

  async function wallet() {
    setWalletError("");
    try {
      const { url } = await callAccount<{ url: string }>("wallet", slug, {}, customer.token);
      window.location.href = url;
    } catch (e) {
      setWalletError(e instanceof Error ? e.message : "No se pudo.");
    }
  }

  const color = data?.business.color || "#f97316";
  const club = data?.club;
  const links = SOCIALS.filter((s) => club?.links[s.key]);

  return (
    <div className="min-h-screen w-full bg-[#fff8f1] text-zinc-900 [color-scheme:light]">
      <div className="mx-auto max-w-lg px-4 pb-16 pt-6">
        {!data ? (
          <p className="py-24 text-center text-zinc-500">{error || "Cargando..."}</p>
        ) : (
          <>
            <header className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- logo del negocio */}
              <img src={data.business.logo || "/bpos-logo.png"} alt="" className="h-12 w-12 rounded-xl bg-white object-contain shadow-sm" />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-xl font-black">{club!.name}</h1>
                <p className="truncate text-sm text-zinc-500">{data.business.name}</p>
              </div>
            </header>

            {!club!.enabled ? (
              <p className="mt-8 rounded-2xl bg-white p-6 text-center text-zinc-500 shadow-sm">El club de este restaurante todavía no está activo.</p>
            ) : !customer.account ? (
              <section className="mt-6 rounded-3xl bg-white p-6 text-center shadow-sm">
                <p className="text-4xl">🎁</p>
                <h2 className="mt-2 text-2xl font-black">Únete al {club!.name}</h2>
                <p className="mt-2 text-zinc-600">{club!.how}</p>
                {club!.welcome && <p className="mt-3 rounded-2xl bg-orange-50 p-3 font-bold">Al unirte: {club!.welcome}</p>}
                <button onClick={() => setSheet("registro")} className="mt-5 w-full rounded-2xl py-4 text-lg font-black text-white" style={{ background: color }}>
                  Crear mi cuenta gratis
                </button>
                <button onClick={() => setSheet("entrar")} className="mt-2 w-full rounded-2xl border border-zinc-200 py-3 font-black">
                  Ya tengo cuenta: entrar
                </button>
              </section>
            ) : !member ? (
              <section className="mt-6 rounded-3xl bg-white p-6 text-center shadow-sm">
                <p className="text-4xl">⭐</p>
                <h2 className="mt-2 text-2xl font-black">Hola {name.split(" ")[0]}, únete al {club!.name}</h2>
                <p className="mt-2 text-zinc-600">{club!.how}</p>
                {club!.welcome && <p className="mt-3 rounded-2xl bg-orange-50 p-3 font-bold">🎁 {club!.welcome}</p>}
                <button disabled={busy} onClick={() => void join()} className="mt-5 w-full rounded-2xl py-4 text-lg font-black text-white disabled:opacity-50" style={{ background: color }}>
                  {busy ? "Un momento..." : "Unirme al club"}
                </button>
              </section>
            ) : (
              <>
                <section className="mt-6">
                  {card ? (
                    // eslint-disable-next-line @next/next/no-img-element -- tarjeta dibujada en el celular
                    <img src={card} alt={`Tarjeta ${club!.name}`} className="w-full rounded-3xl shadow-xl" />
                  ) : (
                    <div className="aspect-[1000/630] w-full animate-pulse rounded-3xl" style={{ background: color }} />
                  )}
                  <p className="mt-2 text-center text-xs text-zinc-500">Mantén presionada la tarjeta para guardarla, o descárgala.</p>
                  <div className="mt-3 grid gap-2">
                    {card && (
                      <a href={card} download={`tarjeta-${slug}.png`} className="rounded-2xl border border-zinc-200 bg-white py-3 text-center font-black">
                        ⬇️ Guardar tarjeta en mi galería
                      </a>
                    )}
                    <button
                      onClick={() => void wallet()}
                      disabled={!data.wallet}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-black py-3 font-black text-white disabled:opacity-40"
                    >
                      <span className="text-lg">👛</span> {data.wallet ? "Agregar a Google Wallet" : "Google Wallet · muy pronto"}
                    </button>
                    {walletError && <p className="text-center text-sm font-bold text-red-600">{walletError}</p>}
                  </div>
                </section>

                <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm">
                  <p className="text-sm text-zinc-500">Tienes</p>
                  <p className="text-3xl font-black" style={{ color }}>{balanceText(club!, member)}</p>
                  <p className="mt-1 text-sm text-zinc-600">{club!.how}</p>
                  {club!.kind === "sellos" && member.stamps >= club!.stampsGoal && (
                    <p className="mt-3 rounded-2xl bg-emerald-50 p-3 font-black text-emerald-800">🎉 ¡Ya tienes tu premio! Pídelo en caja: {club!.stampReward}</p>
                  )}
                  {club!.rewards.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <p className="text-sm font-black">Premios</p>
                      {club!.rewards.map((r) => (
                        <p key={r.name} className={`flex justify-between rounded-xl px-3 py-2 text-sm ${member.points >= r.points ? "bg-emerald-50 font-black text-emerald-800" : "bg-zinc-50"}`}>
                          <span>{r.name}</span>
                          <span>{r.points} pts</span>
                        </p>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-xs text-zinc-400">Muestra tu tarjeta en caja para juntar y canjear. En tus pedidos en línea se suma solo.</p>
                </section>

                {data.movements.length > 0 && (
                  <section className="mt-4 rounded-3xl bg-white p-5 shadow-sm">
                    <p className="font-black">Movimientos</p>
                    <div className="mt-2 divide-y divide-zinc-100 text-sm">
                      {data.movements.map((m, i) => {
                        const value = club!.kind === "sellos" ? m.stamps : club!.kind === "cashback" ? m.cashback : m.points;
                        const unit = club!.kind === "sellos" ? "sellos" : club!.kind === "cashback" ? "" : "pts";
                        return (
                          <div key={i} className="flex justify-between gap-2 py-2">
                            <span>
                              {m.kind === "bienvenida" ? "🎁 Bienvenida" : m.kind === "canje" ? "🎉 Canje" : m.kind === "compra" ? `🧾 Compra ${money(m.amount)}` : "Ajuste"}
                              {m.note ? <span className="block text-xs text-zinc-400">{m.note}</span> : null}
                              <span className="block text-xs text-zinc-400">{new Date(m.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</span>
                            </span>
                            <span className={`font-black ${value < 0 ? "text-red-600" : "text-emerald-700"}`}>
                              {value > 0 ? "+" : ""}
                              {club!.kind === "cashback" ? money(value) : value} {unit}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
              </>
            )}

            {links.length > 0 && (
              <section className="mt-6">
                <p className="mb-2 text-center text-sm font-black text-zinc-500">Entérate de promociones</p>
                <div className="grid gap-2">
                  {links.map((s) => (
                    <a key={s.key} href={club!.links[s.key]} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-2xl py-3 font-black text-white" style={{ background: s.color }}>
                      <span>{s.icon}</span> {s.key === "whatsapp" || s.key === "telegram" ? `Unirme a la ${s.label.replace("Comunidad", "comunidad")}` : s.label}
                    </a>
                  ))}
                </div>
              </section>
            )}

            <a href={`/m/${slug}`} className="mt-6 block rounded-2xl border border-zinc-200 bg-white py-3 text-center font-black">
              🍔 Ver el menú y pedir
            </a>
            {customer.account && (
              <button onClick={() => void customer.signOut()} className="mt-3 w-full text-sm font-bold text-zinc-400 underline">
                Salir de mi cuenta
              </button>
            )}
            {club!.terms && <p className="mt-6 whitespace-pre-line text-center text-xs text-zinc-400">{club!.terms}</p>}
            {error && <p className="mt-3 text-center text-sm font-bold text-red-600">{error}</p>}
            <p className="mt-8 text-center text-xs text-zinc-400">Club por bpos.com.mx</p>
          </>
        )}
      </div>
      {sheet && data && (
        <AccountSheet
          slug={slug}
          color={color}
          businessName={data.business.name}
          customer={customer}
          start={sheet}
          onClose={() => setSheet(null)}
          onSignedIn={() => setSheet(null)}
        />
      )}
    </div>
  );
}
