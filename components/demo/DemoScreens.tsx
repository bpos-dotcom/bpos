"use client";
/**
 * Pantallas animadas de la demo guiada (/demo). Cada una repite una escena
 * corta en bucle (como un GIF, pero nítido y ligero): se tocan productos,
 * entra la comanda a cocina, llega un pedido de Rappi, etc. Todo con datos
 * de un restaurante de ejemplo; nada real.
 */
import { useEffect, useState } from "react";

/** Fase de la escena: 0..n-1, avanza cada `ms` y vuelve a empezar */
export function useScene(n: number, ms = 1300) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setPhase((p) => (p + 1) % n), ms);
    return () => window.clearInterval(id);
  }, [n, ms]);
  return phase;
}

const card = "rounded-3xl border border-zinc-800 bg-zinc-950 p-4 shadow-[0_0_40px_rgba(249,115,22,0.08)]";
export const pop = "animate-[demo-pop_.45s_ease-out]";
export const slide = "animate-[demo-slide_.5s_ease-out]";

export function Window({ title, children, badge, badgeTone = "orange" }: { title: string; children: React.ReactNode; badge?: string; badgeTone?: "orange" | "green" }) {
  return (
    <div className={card}>
      <div className="mb-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <span className="ml-2 font-bold text-zinc-400">{title}</span>
        </div>
        {badge && (
          <span key={badge} className={`rounded-full px-2 py-0.5 font-black ${pop} ${badgeTone === "green" ? "bg-green-500/15 text-green-300" : "bg-orange-500/15 text-orange-300"}`}>
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function Phone({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="mx-auto w-full max-w-[300px] rounded-[2rem] border-4 border-zinc-800 bg-zinc-950 p-3 shadow-[0_0_40px_rgba(249,115,22,0.1)]">
      <div className="mx-auto mb-2 h-1.5 w-16 rounded-full bg-zinc-700" />
      <p className="mb-2 text-center text-[11px] font-bold text-zinc-500">{title}</p>
      {children}
    </div>
  );
}

/** Dedo que toca algo (aparece sobre el elemento) */
export function Finger() {
  return <span className={`pointer-events-none absolute -bottom-2 -right-1 text-2xl drop-shadow ${pop}`}>👆</span>;
}

const PRODUCTS = [
  ["🌮", "Taco pastor", 22],
  ["🌮", "Taco bistec", 25],
  ["🌯", "Gringa", 55],
  ["🥤", "Agua de horchata", 25],
  ["🧀", "Queso fundido", 70],
  ["🍟", "Papas", 45],
] as const;

// ------------------------------------------------------------ 1 · cobrar

const TICKET = [
  { tap: 0, l: "3 × Taco pastor", r: 66, note: "sin cebolla" },
  { tap: 2, l: "1 × Gringa", r: 55 },
  { tap: 3, l: "2 × Agua de horchata", r: 50 },
];

export function PosScreen() {
  // 0-2: toca productos · 3: cupón · 4: toca cobrar · 5: pagado · 6: pausa
  const phase = useScene(7);
  const lines = TICKET.slice(0, Math.min(phase + 1, 3));
  const coupon = phase >= 3;
  const paid = phase >= 5;
  const tapping = phase < 3 ? TICKET[phase].tap : -1;
  const total = lines.reduce((s, l) => s + l.r, 0) - (coupon ? 17 : 0);
  return (
    <Window title="Punto de venta · Caja 1" badge={paid ? "Pagado ✓" : "Turno abierto"} badgeTone={paid ? "green" : "orange"}>
      <div className="grid grid-cols-[1.2fr_1fr] gap-3">
        <div className="grid grid-cols-2 gap-2">
          {PRODUCTS.map(([icon, name, price], i) => (
            <div key={name} className={`relative rounded-2xl border bg-black p-2.5 transition-all duration-300 ${tapping === i ? "scale-95 border-orange-500 bg-orange-500/10" : "border-zinc-800"}`}>
              <p className="text-2xl">{icon}</p>
              <p className="mt-1 truncate text-xs font-black">{name}</p>
              <p className="text-xs font-bold text-orange-400">${price}</p>
              {tapping === i && <Finger />}
            </div>
          ))}
        </div>
        <div className="flex flex-col rounded-2xl border border-zinc-800 bg-black p-3 text-xs">
          <p className="font-black text-zinc-400">Mesa 4 · Ana</p>
          <div className="mt-2 flex-1 space-y-1.5">
            {lines.map((l) => (
              <div key={l.l} className={slide}>
                <Row l={l.l} r={`$${l.r}`} />
                {l.note && <p className="pl-3 text-[10px] text-zinc-500">{l.note}</p>}
              </div>
            ))}
            {coupon && (
              <div className={slide}>
                <Row l="Cupón MARTES10" r="−$17" muted />
              </div>
            )}
          </div>
          <div className="mt-3 border-t border-zinc-800 pt-2">
            <Row l="Total" r={`$${total}`} big />
          </div>
          <div className={`relative mt-2 rounded-xl py-2 text-center font-black transition-all duration-300 ${paid ? "bg-green-500 text-black" : phase === 4 ? "scale-95 bg-orange-400 text-black" : "bg-orange-500 text-black"}`}>
            {paid ? "Cobrado ✓" : "Cobrar"}
            {phase === 4 && <Finger />}
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-1 text-center text-[9px] font-bold text-zinc-400">
            <span className={`rounded-lg border py-1 transition-colors ${paid ? "border-green-500 text-green-300" : "border-zinc-800"}`}>Efectivo</span>
            <span className="rounded-lg border border-zinc-800 py-1">Tarjeta</span>
            <span className="rounded-lg border border-zinc-800 py-1">Transfer.</span>
          </div>
        </div>
      </div>
    </Window>
  );
}

function Row({ l, r, muted, big }: { l: string; r: string; muted?: boolean; big?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-green-400" : ""} ${big ? "text-base font-black" : ""}`}>
      <span>{l}</span>
      <span className="font-bold">{r}</span>
    </div>
  );
}

// ------------------------------------------------------------ 2 · cocina

const TICKETS = [
  { id: "#1040", where: "Para llevar", min: 9, items: ["6 Taco pastor", "2 Horchata"] },
  { id: "#1041", where: "Rappi", min: 4, items: ["2 Queso fundido", "4 Taco bistec", "1 Papas"] },
  { id: "#1042", where: "Mesa 4", min: 0, items: ["3 Taco pastor · sin cebolla", "1 Gringa"] },
];

export function KitchenScreen() {
  // 0: dos tickets · 1: entra #1042 · 2-3: pasan minutos · 4: #1040 listo · 5: sale
  const phase = useScene(6, 1400);
  const shown = TICKETS.filter((t) => (phase >= 1 || t.id !== "#1042") && !(phase >= 5 && t.id === "#1040"));
  const extra = Math.min(phase, 3);
  return (
    <Window title="Cocina · Parrilla" badge={phase === 1 ? "🔔 Nueva comanda" : `${shown.length} en preparación`} badgeTone={phase === 1 ? "green" : "orange"}>
      <div className="grid min-h-[9.5rem] grid-cols-3 gap-2">
        {shown.map((t) => {
          const min = t.min + extra;
          const done = phase === 4 && t.id === "#1040";
          return (
            <div key={t.id} className={`rounded-2xl border-2 bg-black p-2.5 text-xs transition-all duration-500 ${t.id === "#1042" && phase === 1 ? slide : ""} ${done ? "border-green-500 bg-green-500/10" : min > 10 ? "border-red-500/60" : min > 5 ? "border-yellow-500/50" : "border-green-500/40"}`}>
              <div className="flex items-center justify-between">
                <span className="font-black">{t.id}</span>
                <span className={`font-black ${min > 10 ? "text-red-400" : min > 5 ? "text-yellow-400" : "text-green-400"}`}>{min} min</span>
              </div>
              <p className="text-[10px] text-zinc-500">{t.where}</p>
              <ul className="mt-2 space-y-1 text-[11px]">
                {t.items.map((i) => (
                  <li key={i}>• {i}</li>
                ))}
              </ul>
              <div className={`relative mt-2 rounded-lg border py-1 text-center text-[10px] font-black transition-colors ${done ? "border-green-500 bg-green-500 text-black" : "border-zinc-700"}`}>
                {done ? "¡Listo!" : "Listo ✓"}
                {done && <Finger />}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-center text-[11px] text-zinc-500">🖨️ Freidora y barra reciben su propio ticket en su impresora</p>
    </Window>
  );
}

// ------------------------------------------------------------ 3 · delivery

const DELIVERY = [
  { app: "Uber Eats", color: "bg-green-500", code: "UE-19C4", total: 145 },
  { app: "DiDi Food", color: "bg-orange-400", code: "DD-5530", total: 92 },
  { app: "Rappi", color: "bg-pink-500", code: "RP-8821", total: 268 },
];

export function BridgeScreen() {
  // 0: dos pedidos · 1: llega Rappi (nuevo) · 2: leyendo ticket · 3: enviado a cocina · 4: pausa
  const phase = useScene(5, 1400);
  const rows = phase >= 1 ? DELIVERY : DELIVERY.slice(0, 2);
  const state = (code: string) => {
    if (code !== "RP-8821") return { t: "En cocina", c: "text-green-400" };
    if (phase === 1) return { t: "🔔 Nuevo pedido", c: "text-pink-300" };
    if (phase === 2) return { t: "Leyendo el ticket...", c: "text-yellow-300" };
    return { t: "En cocina · inventario descontado", c: "text-green-400" };
  };
  return (
    <Window title="B-POS Bridge · Pedidos de delivery" badge={phase === 3 ? "Enviado a cocina ✓" : "Conectado"} badgeTone={phase === 3 ? "green" : "orange"}>
      <div className="min-h-[10rem] space-y-2">
        {rows.map((d) => {
          const s = state(d.code);
          return (
            <div key={d.code} className={`flex items-center gap-3 rounded-2xl border bg-black p-3 text-xs transition-colors duration-500 ${d.code === "RP-8821" && phase === 1 ? `${slide} border-pink-500/60` : "border-zinc-800"}`}>
              <span className={`h-9 w-9 shrink-0 rounded-xl ${d.color}`} />
              <div className="min-w-0 flex-1">
                <p className="font-black">
                  {d.app} <span className="font-bold text-zinc-500">{d.code}</span>
                </p>
                <p className={`text-[11px] font-bold ${s.c}`}>{s.t}</p>
              </div>
              <p className="font-black">${d.total}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-center text-[11px] text-zinc-500">Sin capturar nada: el pedido se lee del ticket de la plataforma</p>
    </Window>
  );
}

// ------------------------------------------------------------ 4 · dashboard

export function DashboardScreen() {
  // 0-4: crece la gráfica y las ventas · 5: aviso de inventario · 6: pausa
  const phase = useScene(7, 1100);
  const bars = [40, 55, 35, 70, 85, 100, 65];
  const grown = Math.min(phase + 2, bars.length);
  const sales = [3120, 4210, 5080, 6450, 7890, 8420, 8420][phase];
  const orders = [24, 33, 41, 52, 61, 67, 67][phase];
  return (
    <Window title="Dashboard · Hoy" badge="Caja abierta">
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Metric t="Ventas hoy" v={`$${sales.toLocaleString("es-MX")}`} />
        <Metric t="Pedidos" v={String(orders)} />
        <Metric t="Ticket promedio" v={`$${Math.round(sales / orders)}`} />
      </div>
      <div className="mt-3 grid grid-cols-[1.3fr_1fr] gap-2">
        <div className="rounded-2xl border border-zinc-800 bg-black p-3">
          <p className="text-[11px] font-black text-zinc-400">Ventas por hora</p>
          <div className="mt-2 flex h-20 items-end gap-1.5">
            {bars.map((h, i) => (
              <span key={i} className="flex-1 rounded-t-md bg-orange-500/80 transition-all duration-700" style={{ height: i < grown ? `${h}%` : "4%" }} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-zinc-600">
            <span>12 pm</span>
            <span>3 pm</span>
            <span>6 pm</span>
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-black p-3 text-[11px]">
          <p className="font-black text-zinc-400">Inventario</p>
          {phase >= 5 ? (
            <p className={`mt-2 rounded-lg bg-red-500/15 px-2 py-1 font-bold text-red-300 ${slide}`}>⚠️ Tortilla: queda para 1 día</p>
          ) : (
            <p className="mt-2 rounded-lg bg-green-500/10 px-2 py-1 font-bold text-green-300">✓ Todo en orden</p>
          )}
          <p className="mt-1 rounded-lg bg-yellow-500/15 px-2 py-1 font-bold text-yellow-300">Carne pastor: {Math.max(3, 9 - phase)} kg</p>
          <p className="mt-2 text-[10px] text-zinc-500">Cada venta descuenta sus ingredientes</p>
        </div>
      </div>
    </Window>
  );
}

function Metric({ t, v }: { t: string; v: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-black p-3">
      <p className="text-[10px] font-bold text-zinc-500">{t}</p>
      <p className="mt-1 text-lg font-black text-orange-400 tabular-nums">{v}</p>
    </div>
  );
}

// ------------------------------------------------------------ 5 · dueño

const ALERTS = ["🟢 Centro abrió caja con $1,000 · 11:02", "🔴 Plaza Norte canceló la venta #318 · 14:40", "🤖 Asesor: el martes 2x1 subió 18% las ventas", "🛵 Universidad: 3 pedidos de Rappi en 10 min"];

export function OwnerScreen() {
  // van subiendo las ventas y entran avisos uno por uno
  const phase = useScene(6, 1300);
  const total = 18900 + phase * 496;
  const alerts = ALERTS.slice(0, Math.min(phase + 1, 4)).reverse();
  return (
    <Phone title="App del dueño">
      <div className="rounded-2xl bg-black p-3 text-xs">
        <p className="text-[10px] font-bold text-zinc-500">Hoy · 3 sucursales</p>
        <p className="text-2xl font-black text-orange-400 tabular-nums">${total.toLocaleString("es-MX")}</p>
        <div className="mt-3 space-y-2">
          <Branch n="Centro" v={`$${(7500 + phase * 184).toLocaleString("es-MX")}`} pct={100} />
          <Branch n="Plaza Norte" v={`$${(6300 + phase * 162).toLocaleString("es-MX")}`} pct={78 + phase} />
          <Branch n="Universidad" v={`$${(5100 + phase * 150).toLocaleString("es-MX")}`} pct={64 + phase} />
        </div>
        <p className="mt-4 text-[10px] font-bold text-zinc-500">Avisos</p>
        <div className="mt-1 min-h-[6.5rem] space-y-1.5 text-[11px]">
          {alerts.map((a, i) => (
            <p key={a} className={`rounded-lg border px-2 py-1.5 ${i === 0 && phase < 4 ? `${slide} border-orange-500/60` : "border-zinc-800"}`}>
              {a}
            </p>
          ))}
        </div>
      </div>
    </Phone>
  );
}

function Branch({ n, v, pct }: { n: string; v: string; pct: number }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] font-bold tabular-nums">
        <span>{n}</span>
        <span>{v}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-zinc-800">
        <div className="h-1.5 rounded-full bg-orange-500 transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ 6 · menú y club

export function ClubScreen() {
  // 0: menú · 1: toca pedir · 2: pedido enviado · 3: sello nuevo en la tarjeta · 4: aviso · 5: pausa
  const phase = useScene(6, 1300);
  const ordered = phase >= 2;
  const stamps = phase >= 3 ? 5 : 4;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Phone title="Menú digital">
        <div className="rounded-2xl bg-white p-2.5 text-[11px] text-zinc-900">
          <p className="font-black">Taquería La Esquina</p>
          <p className="text-[10px] text-zinc-500">Abierto · entrega 25 min</p>
          <div className="mt-2 space-y-1.5">
            {PRODUCTS.slice(0, 3).map(([icon, name, price]) => (
              <div key={name} className="flex items-center justify-between rounded-lg border border-zinc-200 px-2 py-1">
                <span>
                  {icon} {name}
                </span>
                <span className="font-black">${price}</span>
              </div>
            ))}
          </div>
          <div className={`relative mt-2 rounded-lg py-1.5 text-center font-black text-white transition-all duration-300 ${ordered ? "bg-green-600" : phase === 1 ? "scale-95 bg-orange-400" : "bg-orange-500"}`}>
            {ordered ? "Pedido enviado ✓ · pagado" : "Pedir · $154"}
            {phase === 1 && <Finger />}
          </div>
        </div>
      </Phone>
      <Phone title="Google Wallet">
        <div className="rounded-2xl bg-orange-500 p-3 text-[11px] text-black">
          <p className="font-black">Club La Esquina</p>
          <div className="mt-2 flex justify-between">
            <span>
              <span className="block text-[9px] font-bold uppercase opacity-70">Sellos</span>
              <span key={stamps} className={`inline-block font-black ${phase === 3 ? pop : ""}`}>
                {stamps} de 6
              </span>
            </span>
            <span className="text-right">
              <span className="block text-[9px] font-bold uppercase opacity-70">Socio</span>
              <span className="font-black">Ana López</span>
            </span>
          </div>
          <div className="mt-2 flex gap-1">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className={`h-3 flex-1 rounded-full transition-colors duration-500 ${i < stamps ? "bg-black" : "bg-black/20"}`} />
            ))}
          </div>
          <div className="mt-2 flex h-12 items-center justify-center rounded-lg bg-white">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-black text-[8px] text-white">QR</span>
          </div>
        </div>
        <div className="mt-2 min-h-[2.6rem]">
          {phase >= 4 && <p className={`rounded-lg border border-orange-500/60 bg-black px-2 py-1.5 text-[10px] text-zinc-200 ${slide}`}>🔔 ¡Sumaste 1 sello! Te falta 1 para tu orden de tacos gratis.</p>}
        </div>
      </Phone>
    </div>
  );
}
