/**
 * Demo guiada pública (www.bpos.com.mx/demo): un recorrido de 6 pasos por
 * B-POS con pantallas animadas (components/demo/DemoScreens.tsx) de un
 * restaurante ficticio ("Taquería La Esquina"). No pide cuenta (ver PUBLIC_PATHS en CloudGate). No usa datos
 * de ningún negocio real.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { BridgeScreen, ClubScreen, DashboardScreen, KitchenScreen, OwnerScreen, PosScreen } from "@/components/demo/DemoScreens";
import { ThemeToggle } from "@/components/layout/TopCorner";
import { TRIAL_DAYS } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Demo · B-POS, punto de venta para restaurantes",
  description: "Recorre B-POS en 2 minutos: cobrar, cocina, pedidos de delivery, caja, app del dueño, menú digital y club de clientes.",
};

const button = "inline-flex items-center justify-center rounded-2xl px-6 py-4 text-center font-black transition";

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
        <p>© {new Date().getFullYear()} B-POS · Punto de venta para restaurantes · Las pantallas son animaciones de un restaurante de ejemplo.</p>
      </footer>
    </main>
  );
}
