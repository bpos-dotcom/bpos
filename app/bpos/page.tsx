/**
 * Bloque 15 · Página pública de B-POS (/bpos): qué es, planes, cómo empezar
 * y descargar el instalador. No pide cuenta (ver PUBLIC_PATHS en CloudGate).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/layout/TopCorner";
import { PLANS, TRIAL_DAYS, type PlanId } from "@/lib/plans";

export const metadata: Metadata = {
  title: "B-POS · Punto de venta para restaurantes",
  description: "Caja, cocina, inventario y pedidos de Rappi, Uber Eats y DiDi Food en un solo sistema. Prueba gratis.",
};

const FEATURES = [
  ["🛒", "Punto de venta táctil", "Cobra desde la computadora, una tablet o el celular. Combos, opciones, comentarios y descuentos."],
  ["👨‍🍳", "Cocina y comandas", "Pantalla de cocina (KDS) y una impresora por estación: parrilla, freidora, barra..."],
  ["🌉", "Pedidos de delivery solos", "B-POS Bridge lee los tickets de Rappi, Uber Eats y DiDi Food y los manda a cocina sin capturarlos."],
  ["📦", "Inventario y recetas", "Cada venta descuenta sus ingredientes. Avisos de faltantes y lista de compras."],
  ["💵", "Caja y cortes", "Apertura, cortes por método de pago y canal, y bitácora de todo lo sensible."],
  ["📱", "App del dueño", "Ventas en vivo de todas tus sucursales y avisos al celular, estés donde estés."],
  ["☁️", "Nube y sin internet", "Todo se respalda en la nube; la caja instalada sigue vendiendo aunque se vaya el internet."],
  ["🤖", "Inteligencia artificial", "Sube la foto de tu menú y B-POS registra tus productos (plan Max)."],
] as const;

const STEPS = [
  ["1", "Crea tu cuenta", `Da de alta tu negocio. ${TRIAL_DAYS} días gratis, sin tarjeta.`],
  ["2", "Instala la caja", "Descarga B-POS para Windows en la computadora de la caja. Se actualiza solo."],
  ["3", "Conecta tus equipos", "Abre B-POS en tablets y celulares con la misma cuenta: cocina, meseros y tú."],
] as const;

const FAQ = [
  ["¿Necesito tarjeta para la prueba?", `No. Tienes ${TRIAL_DAYS} días gratis y eliges tu plan cuando quieras.`],
  ["¿Cómo se paga?", "Cada mes con Mercado Pago, por sucursal. Cancelas cuando quieras desde Mi plan."],
  ["¿Funciona sin internet?", "Sí. La computadora de la caja con B-POS instalado sigue vendiendo e imprimiendo; se sincroniza al volver el internet."],
  ["¿Qué impresoras usa?", "Impresoras térmicas de tickets (USB o red). Puedes tener una por estación de cocina."],
] as const;

const button = "inline-flex items-center justify-center rounded-2xl px-6 py-4 text-center font-black transition";

export default function BposLanding() {
  return (
    <main className="min-h-screen bg-black text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo fijo */}
          <img src="/bpos-logo.png" alt="B-POS" className="h-11 w-11 object-contain" />
          <span className="text-2xl font-black">B-POS</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/" className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-black hover:border-orange-500">
            Entrar
          </Link>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-8 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:pt-16">
        <div>
          <p className="font-black text-orange-500">Punto de venta para restaurantes</p>
          <h1 className="mt-3 text-4xl font-black leading-tight sm:text-6xl">
            Caja, cocina y delivery <span className="text-orange-500">en un solo lugar.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-zinc-400">
            Cobra rápido, manda las comandas a cada estación y recibe los pedidos de Rappi, Uber Eats y DiDi Food sin volver a capturarlos.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/" className={`${button} bg-orange-500 text-black hover:bg-orange-400`}>
              Prueba {TRIAL_DAYS} días gratis
            </Link>
            <a href="/api/descargar" className={`${button} border border-orange-500 text-orange-300 hover:bg-orange-500/10`}>
              ⬇️ Descargar para Windows
            </a>
          </div>
          <p className="mt-3 text-sm text-zinc-500">Sin tarjeta. Desde ${PLANS.basic.price} MXN al mes por sucursal.</p>
        </div>
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo fijo */}
          <img src="/bpos-logo.png" alt="" className="w-56 drop-shadow-[0_0_60px_rgba(249,115,22,0.35)] sm:w-72" />
        </div>
      </section>

      <section className="border-t border-zinc-800 bg-zinc-950 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-3xl font-black sm:text-4xl">Todo lo que tu restaurante necesita</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(([icon, title, text]) => (
              <div key={title} className="rounded-3xl border border-zinc-800 bg-black p-5">
                <p className="text-4xl">{icon}</p>
                <h3 className="mt-3 text-lg font-black text-orange-500">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="planes" className="py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-3xl font-black sm:text-4xl">Planes</h2>
          <p className="mt-2 text-zinc-400">Precio por sucursal al mes, en pesos mexicanos. Todos empiezan con {TRIAL_DAYS} días gratis.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {(Object.keys(PLANS) as PlanId[]).map((id) => {
              const plan = PLANS[id];
              const featured = id === "pro";
              return (
                <div key={id} className={`flex flex-col rounded-3xl border p-6 ${featured ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 bg-zinc-950"}`}>
                  {featured && <p className="mb-2 w-fit rounded-full bg-orange-500 px-3 py-1 text-xs font-black text-black">El más elegido</p>}
                  <p className="text-2xl font-black">{plan.name}</p>
                  <p className="mt-2 text-4xl font-black text-orange-400">
                    ${plan.price} <span className="text-sm font-bold text-zinc-400">/ sucursal / mes</span>
                  </p>
                  <ul className="mt-5 flex-1 space-y-2 text-sm text-zinc-300">
                    {plan.features.map((f) => (
                      <li key={f}>✓ {f}</li>
                    ))}
                  </ul>
                  <Link href="/" className={`${button} mt-6 ${featured ? "bg-orange-500 text-black hover:bg-orange-400" : "border border-zinc-700 hover:border-orange-500"}`}>
                    Empezar gratis
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-zinc-800 bg-zinc-950 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-3xl font-black sm:text-4xl">Empieza hoy en 3 pasos</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map(([n, title, text]) => (
              <div key={n} className="rounded-3xl border border-zinc-800 bg-black p-6">
                <p className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500 font-black text-black">{n}</p>
                <h3 className="mt-4 text-xl font-black">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-3xl font-black sm:text-4xl">Preguntas frecuentes</h2>
          <div className="mt-6 space-y-3">
            {FAQ.map(([q, a]) => (
              <details key={q} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                <summary className="cursor-pointer font-black">{q}</summary>
                <p className="mt-3 text-sm leading-6 text-zinc-400">{a}</p>
              </details>
            ))}
          </div>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href="/" className={`${button} bg-orange-500 text-black hover:bg-orange-400`}>
              Crear mi cuenta gratis
            </Link>
            <a href="/api/descargar" className={`${button} border border-orange-500 text-orange-300 hover:bg-orange-500/10`}>
              ⬇️ Descargar para Windows
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-800 py-8 text-center text-sm text-zinc-500">© {new Date().getFullYear()} B-POS · Punto de venta para restaurantes</footer>
    </main>
  );
}
