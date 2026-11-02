/**
 * Demo guiada pública (www.bpos.com.mx/demo): un recorrido de 6 pasos por
 * B-POS con pantallas recreadas de un restaurante ficticio ("Taquería La
 * Esquina"). No pide cuenta (ver PUBLIC_PATHS en CloudGate). No usa datos
 * de ningún negocio real.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/layout/TopCorner";
import { TRIAL_DAYS } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Demo · B-POS, punto de venta para restaurantes",
  description: "Recorre B-POS en 2 minutos: cobrar, cocina, pedidos de delivery, caja, app del dueño, menú digital y club de clientes.",
};

const button = "inline-flex items-center justify-center rounded-2xl px-6 py-4 text-center font-black transition";
const card = "rounded-3xl border border-zinc-800 bg-zinc-950 p-4 shadow-[0_0_40px_rgba(249,115,22,0.08)]";

type Step = { n: number; title: string; text: string; bullets: string[]; screen: React.ReactNode };

export default function DemoPage() {
  const steps: Step[] = [
    {
      n: 1,
      title: "Cobras en segundos",
      text: "Toca los productos, elige opciones y cobra en efectivo, tarjeta o transferencia. Funciona en la computadora, una tablet o el celular.",
      bullets: ["Combos, extras y comentarios para cocina", "Descuentos y cupones con permiso por usuario", "Terminal de Mercado Pago integrada"],
      screen: <PosScreen />,
    },
    {
      n: 2,
      title: "La comanda llega sola a cocina",
      text: "Cada estación ve lo suyo: parrilla, freidora, barra. En pantalla (KDS) o en su impresora de tickets. Nadie grita pedidos.",
      bullets: ["Una impresora por estación", "Tiempos de preparación en vivo", "Marcar listo y avisar al mesero"],
      screen: <KitchenScreen />,
    },
    {
      n: 3,
      title: "Los pedidos de delivery entran solos",
      text: "B-POS Bridge lee los pedidos de Rappi, Uber Eats y DiDi Food y los manda a cocina sin volver a capturarlos. Cero errores de dedo.",
      bullets: ["Rappi, Uber Eats y DiDi Food", "Descuenta inventario como una venta normal", "Equivalencias de productos una sola vez"],
      screen: <BridgeScreen />,
    },
    {
      n: 4,
      title: "Caja, inventario y reportes al día",
      text: "Cada venta descuenta sus ingredientes. Cortes de caja por método de pago y canal, avisos de faltantes y lista de compras lista para el proveedor.",
      bullets: ["Apertura y corte con diferencia de efectivo", "Recetas con costo y margen por platillo", "Bitácora de todo lo sensible"],
      screen: <DashboardScreen />,
    },
    {
      n: 5,
      title: "El dueño lo ve todo desde el celular",
      text: "Ventas en vivo de todas tus sucursales y avisos al instante: caja abierta, pedido cancelado, inventario bajo. Estés donde estés.",
      bullets: ["Todas las sucursales en una pantalla", "Avisos al celular", "Asesor con inteligencia artificial cada lunes"],
      screen: <OwnerScreen />,
    },
    {
      n: 6,
      title: "Menú digital, kiosco y club de clientes",
      text: "Tu menú con QR para pedir desde la mesa o a domicilio, un kiosco de autoservicio con terminal, y un club de puntos con tarjeta en Google Wallet.",
      bullets: ["Pedidos en línea con pago por Mercado Pago", "Kiosco con pantalla táctil y terminal", "Tarjeta del club en el celular con avisos"],
      screen: <ClubScreen />,
    },
  ];

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo fijo */}
          <img src="/bpos-logo.png" alt="B-POS" className="h-11 w-11 object-contain" />
          <span className="text-2xl font-black">B-POS</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/pos" className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-black hover:border-orange-500">
            Entrar
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6 lg:pt-12">
        <p className="font-black text-orange-500">Demo guiada · 2 minutos</p>
        <h1 className="mt-3 text-4xl font-black leading-tight sm:text-6xl">
          Así trabaja un restaurante <span className="text-orange-500">con B-POS.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-zinc-400">
          Sigue un día en la Taquería La Esquina, un restaurante de ejemplo: desde que cobra el primer taco hasta que el dueño revisa las ventas desde su celular.
        </p>
        <nav className="mt-6 flex flex-wrap gap-2 text-sm">
          {steps.map((s) => (
            <a key={s.n} href={`#paso-${s.n}`} className="rounded-full border border-zinc-800 px-3 py-1.5 font-bold text-zinc-300 hover:border-orange-500">
              {s.n}. {s.title}
            </a>
          ))}
        </nav>
      </section>

      {steps.map((s, i) => (
        <section key={s.n} id={`paso-${s.n}`} className={`scroll-mt-6 border-t border-zinc-800 py-14 ${i % 2 ? "" : "bg-zinc-950"}`}>
          <div className={`mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2 ${i % 2 ? "lg:[&>*:first-child]:order-2" : ""}`}>
            <div>
              <p className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500 font-black text-black">{s.n}</p>
              <h2 className="mt-4 text-3xl font-black sm:text-4xl">{s.title}</h2>
              <p className="mt-4 text-lg leading-7 text-zinc-400">{s.text}</p>
              <ul className="mt-5 space-y-2 text-sm text-zinc-300">
                {s.bullets.map((b) => (
                  <li key={b}>✓ {b}</li>
                ))}
              </ul>
            </div>
            <div className="min-w-0">{s.screen}</div>
          </div>
        </section>
      ))}

      <section className="border-t border-zinc-800 py-16">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-black sm:text-4xl">¿Lo quieres en tu restaurante?</h2>
          <p className="mt-3 text-zinc-400">Crea tu cuenta y úsalo {TRIAL_DAYS} días gratis, sin tarjeta. Si prefieres que te lo mostremos en vivo, escríbenos y agendamos una demo.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href="/pos" className={`${button} bg-orange-500 text-black hover:bg-orange-400`}>
              Prueba {TRIAL_DAYS} días gratis
            </Link>
            <a href="mailto:equipo@bpos.com.mx?subject=Quiero%20una%20demo%20de%20B-POS" className={`${button} border border-orange-500 text-orange-300 hover:bg-orange-500/10`}>
              ✉️ Agendar una demo en vivo
            </a>
          </div>
          <p className="mt-6 text-sm">
            <Link href="/#planes" className="font-bold text-zinc-400 underline hover:text-orange-400">
              Ver planes y precios
            </Link>
          </p>
        </div>
      </section>

      <footer className="border-t border-zinc-800 py-8 text-center text-sm text-zinc-500">
        <p>© {new Date().getFullYear()} B-POS · Punto de venta para restaurantes · Las pantallas son de un restaurante de ejemplo.</p>
      </footer>
    </main>
  );
}

// ------------------------------------------------------------ pantallas recreadas

function Window({ title, children, badge }: { title: string; children: React.ReactNode; badge?: string }) {
  return (
    <div className={card}>
      <div className="mb-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <span className="ml-2 font-bold text-zinc-400">{title}</span>
        </div>
        {badge && <span className="rounded-full bg-orange-500/15 px-2 py-0.5 font-black text-orange-300">{badge}</span>}
      </div>
      {children}
    </div>
  );
}

function Phone({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="mx-auto w-full max-w-[300px] rounded-[2rem] border-4 border-zinc-800 bg-zinc-950 p-3 shadow-[0_0_40px_rgba(249,115,22,0.1)]">
      <div className="mx-auto mb-2 h-1.5 w-16 rounded-full bg-zinc-700" />
      <p className="mb-2 text-center text-[11px] font-bold text-zinc-500">{title}</p>
      {children}
    </div>
  );
}

const PRODUCTS = [
  ["🌮", "Taco pastor", 22],
  ["🌮", "Taco bistec", 25],
  ["🌯", "Gringa", 55],
  ["🥤", "Agua de horchata", 25],
  ["🧀", "Queso fundido", 70],
  ["🍟", "Papas", 45],
] as const;

function PosScreen() {
  return (
    <Window title="Punto de venta · Caja 1" badge="Turno abierto">
      <div className="grid grid-cols-[1.2fr_1fr] gap-3">
        <div className="grid grid-cols-2 gap-2">
          {PRODUCTS.map(([icon, name, price]) => (
            <div key={name} className="rounded-2xl border border-zinc-800 bg-black p-2.5">
              <p className="text-2xl">{icon}</p>
              <p className="mt-1 truncate text-xs font-black">{name}</p>
              <p className="text-xs font-bold text-orange-400">${price}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-col rounded-2xl border border-zinc-800 bg-black p-3 text-xs">
          <p className="font-black text-zinc-400">Mesa 4 · Ana</p>
          <div className="mt-2 flex-1 space-y-1.5">
            <Row l="3 × Taco pastor" r="$66" />
            <p className="pl-3 text-[10px] text-zinc-500">sin cebolla</p>
            <Row l="1 × Gringa" r="$55" />
            <Row l="2 × Agua de horchata" r="$50" />
            <Row l="Cupón MARTES10" r="−$17" muted />
          </div>
          <div className="mt-3 border-t border-zinc-800 pt-2">
            <Row l="Total" r="$154" big />
          </div>
          <div className="mt-2 rounded-xl bg-orange-500 py-2 text-center font-black text-black">Cobrar</div>
          <div className="mt-1.5 grid grid-cols-3 gap-1 text-center text-[9px] font-bold text-zinc-400">
            <span className="rounded-lg border border-zinc-800 py-1">Efectivo</span>
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

const TICKETS = [
  { id: "#1042", where: "Mesa 4", min: 2, color: "border-green-500/40", items: ["3 Taco pastor · sin cebolla", "1 Gringa"] },
  { id: "#1041", where: "Rappi", min: 6, color: "border-yellow-500/40", items: ["2 Queso fundido", "4 Taco bistec", "1 Papas"] },
  { id: "#1040", where: "Para llevar", min: 11, color: "border-red-500/50", items: ["6 Taco pastor", "2 Horchata"] },
];

function KitchenScreen() {
  return (
    <Window title="Cocina · Parrilla" badge="3 en preparación">
      <div className="grid grid-cols-3 gap-2">
        {TICKETS.map((t) => (
          <div key={t.id} className={`rounded-2xl border-2 bg-black p-2.5 text-xs ${t.color}`}>
            <div className="flex items-center justify-between">
              <span className="font-black">{t.id}</span>
              <span className={`font-black ${t.min > 10 ? "text-red-400" : t.min > 5 ? "text-yellow-400" : "text-green-400"}`}>{t.min} min</span>
            </div>
            <p className="text-[10px] text-zinc-500">{t.where}</p>
            <ul className="mt-2 space-y-1 text-[11px]">
              {t.items.map((i) => (
                <li key={i}>• {i}</li>
              ))}
            </ul>
            <div className="mt-2 rounded-lg border border-zinc-700 py-1 text-center text-[10px] font-black">Listo ✓</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-[11px] text-zinc-500">🖨️ Freidora y barra reciben su propio ticket en su impresora</p>
    </Window>
  );
}

const DELIVERY = [
  { app: "Rappi", color: "bg-pink-500", code: "RP-8821", total: 268, state: "En cocina" },
  { app: "Uber Eats", color: "bg-green-500", code: "UE-19C4", total: 145, state: "En cocina" },
  { app: "DiDi Food", color: "bg-orange-400", code: "DD-5530", total: 92, state: "Listo para repartidor" },
];

function BridgeScreen() {
  return (
    <Window title="B-POS Bridge · Pedidos de delivery" badge="Conectado">
      <div className="space-y-2">
        {DELIVERY.map((d) => (
          <div key={d.code} className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-black p-3 text-xs">
            <span className={`h-9 w-9 shrink-0 rounded-xl ${d.color}`} />
            <div className="min-w-0 flex-1">
              <p className="font-black">
                {d.app} <span className="font-bold text-zinc-500">{d.code}</span>
              </p>
              <p className="text-[11px] text-zinc-400">Enviado a cocina solo · inventario descontado</p>
            </div>
            <div className="text-right">
              <p className="font-black">${d.total}</p>
              <p className="text-[10px] font-bold text-green-400">{d.state}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-[11px] text-zinc-500">Sin capturar nada: el pedido se lee del ticket de la plataforma</p>
    </Window>
  );
}

function DashboardScreen() {
  const bars = [40, 55, 35, 70, 85, 100, 65];
  return (
    <Window title="Dashboard · Hoy" badge="Caja abierta">
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Metric t="Ventas hoy" v="$8,420" />
        <Metric t="Pedidos" v="67" />
        <Metric t="Ticket promedio" v="$126" />
      </div>
      <div className="mt-3 grid grid-cols-[1.3fr_1fr] gap-2">
        <div className="rounded-2xl border border-zinc-800 bg-black p-3">
          <p className="text-[11px] font-black text-zinc-400">Ventas por hora</p>
          <div className="mt-2 flex h-20 items-end gap-1.5">
            {bars.map((h, i) => (
              <span key={i} className="flex-1 rounded-t-md bg-orange-500/80" style={{ height: `${h}%` }} />
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
          <p className="mt-2 rounded-lg bg-red-500/15 px-2 py-1 font-bold text-red-300">⚠️ Tortilla: queda para 1 día</p>
          <p className="mt-1 rounded-lg bg-yellow-500/15 px-2 py-1 font-bold text-yellow-300">Carne pastor: 3 kg</p>
          <p className="mt-2 text-[10px] text-zinc-500">Lista de compras lista para el proveedor</p>
        </div>
      </div>
    </Window>
  );
}

function Metric({ t, v }: { t: string; v: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-black p-3">
      <p className="text-[10px] font-bold text-zinc-500">{t}</p>
      <p className="mt-1 text-lg font-black text-orange-400">{v}</p>
    </div>
  );
}

function OwnerScreen() {
  return (
    <Phone title="App del dueño">
      <div className="rounded-2xl bg-black p-3 text-xs">
        <p className="text-[10px] font-bold text-zinc-500">Hoy · 3 sucursales</p>
        <p className="text-2xl font-black text-orange-400">$21,380</p>
        <div className="mt-3 space-y-2">
          <Branch n="Centro" v="$8,420" pct={100} />
          <Branch n="Plaza Norte" v="$7,110" pct={84} />
          <Branch n="Universidad" v="$5,850" pct={69} />
        </div>
        <p className="mt-4 text-[10px] font-bold text-zinc-500">Avisos</p>
        <div className="mt-1 space-y-1.5 text-[11px]">
          <p className="rounded-lg border border-zinc-800 px-2 py-1.5">🟢 Centro abrió caja con $1,000 · 11:02</p>
          <p className="rounded-lg border border-zinc-800 px-2 py-1.5">🔴 Plaza Norte canceló la venta #318 · 14:40</p>
          <p className="rounded-lg border border-zinc-800 px-2 py-1.5">🤖 Asesor: el martes 2x1 subió 18% las ventas</p>
        </div>
      </div>
    </Phone>
  );
}

function Branch({ n, v, pct }: { n: string; v: string; pct: number }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] font-bold">
        <span>{n}</span>
        <span>{v}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-zinc-800">
        <div className="h-1.5 rounded-full bg-orange-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ClubScreen() {
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
          <div className="mt-2 rounded-lg bg-orange-500 py-1.5 text-center font-black text-white">Pedir · $154</div>
        </div>
      </Phone>
      <Phone title="Google Wallet">
        <div className="rounded-2xl bg-orange-500 p-3 text-[11px] text-black">
          <p className="font-black">Club La Esquina</p>
          <div className="mt-2 flex justify-between">
            <span>
              <span className="block text-[9px] font-bold uppercase opacity-70">Sellos</span>
              <span className="font-black">5 de 6</span>
            </span>
            <span className="text-right">
              <span className="block text-[9px] font-bold uppercase opacity-70">Socio</span>
              <span className="font-black">Ana López</span>
            </span>
          </div>
          <div className="mt-2 flex h-12 items-center justify-center rounded-lg bg-white">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-black text-[8px] text-white">QR</span>
          </div>
        </div>
        <p className="mt-2 rounded-lg border border-zinc-800 px-2 py-1.5 text-[10px] text-zinc-300">🔔 ¡Sumaste 1 sello! Te falta 1 para tu orden de tacos gratis.</p>
      </Phone>
    </div>
  );
}
