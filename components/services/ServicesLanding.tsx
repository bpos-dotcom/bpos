"use client";
/**
 * bpos.com.mx/servicios sin cuenta: la página de venta de B-POS por separado.
 * Cada servicio con su explicación, ventajas, precio (del catálogo en la
 * nube) y pantalla animada, como la demo guiada. "Probar" abre la entrada
 * con ese servicio ya elegido (/servicios/login?crear=servicio).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ServicesShowcase } from "@/components/services/ServicesShowcase";
import { ThemeToggle } from "@/components/layout/TopCorner";
import { SERVICES, mergeCatalog, type CatalogEntry } from "@/lib/services";
import { getSupabase, isCloudConfigured } from "@/lib/supabase/client";

const button = "inline-flex items-center justify-center rounded-2xl px-6 py-4 text-center font-black transition";

export function ServicesLanding() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>(() => mergeCatalog([]));

  useEffect(() => {
    // La página aparece después de revisar la sesión: baja a mano al servicio de la liga (#lealtad)
    const id = window.location.hash.slice(1);
    if (id) window.setTimeout(() => document.getElementById(id)?.scrollIntoView(), 50);
    if (!isCloudConfigured) return;
    void getSupabase()
      .from("bpos_service_catalog")
      .select("service, price, trial_days, ai_budget_usd, active")
      .then(({ data }) => data && setCatalog(mergeCatalog(data as Partial<CatalogEntry>[])));
  }, []);

  const available = SERVICES.filter((s) => catalog.find((c) => c.service === s.id)?.active !== false);
  const maxTrial = Math.max(0, ...catalog.map((c) => c.trial_days));

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo fijo */}
          <img src="/bpos-logo.png" alt="B-POS" className="h-11 w-11 object-contain" />
          <span className="text-2xl font-black">
            B-POS <span className="text-orange-500">Servicios</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/servicios/login" className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-black hover:border-orange-500">
            Entrar
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6 lg:pt-12">
        <p className="font-black text-orange-500">Servicios por separado</p>
        <h1 className="mt-3 text-4xl font-black leading-tight sm:text-6xl">
          Contrata solo lo que tu restaurante <span className="text-orange-500">necesita.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-zinc-400">
          No tienes que cambiar tu punto de venta ni pagar B-POS completo. Elige el módulo que te hace falta: club de clientes, menú digital, food cost, asesor con IA o reloj checador. Cada uno se paga por mes y lo cancelas cuando quieras.
        </p>
        <nav className="mt-6 flex flex-wrap gap-2 text-sm">
          {available.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-full border border-zinc-800 px-3 py-1.5 font-bold text-zinc-300 hover:border-orange-500">
              {s.emoji} {s.name}
            </a>
          ))}
        </nav>
      </section>

      <ServicesShowcase
        services={available}
        catalog={catalog}
        action={(s, entry) => (
          <Link href={`/servicios/login?crear=${s.id}`} className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black hover:bg-orange-400">
            {(entry?.trial_days ?? 14) > 0 ? `Probar ${entry?.trial_days ?? 14} días gratis` : "Contratar"}
          </Link>
        )}
      />

      <section className="border-t border-zinc-800 py-16">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-black sm:text-4xl">Empieza con uno y agrega más cuando quieras</h2>
          <p className="mt-3 text-zinc-400">
            Crea tu cuenta, elige los servicios que quieres probar{maxTrial > 0 ? ` y úsalos ${maxTrial} días gratis, sin tarjeta` : ""}. Después pagas solo lo que te sirva.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href="/servicios/login?crear=1" className={`${button} bg-orange-500 text-black hover:bg-orange-400`}>
              Crear mi cuenta
            </Link>
            <a href="mailto:equipo@bpos.com.mx?subject=Quiero%20saber%20m%C3%A1s%20de%20B-POS%20Servicios" className={`${button} border border-orange-500 text-orange-300 hover:bg-orange-500/10`}>
              ✉️ Tengo una pregunta
            </a>
          </div>
          <p className="mt-6 text-sm text-zinc-400">
            ¿Quieres todo junto, con caja, cocina, inventario y pedidos de delivery?{" "}
            <Link href="/#planes" className="font-bold underline hover:text-orange-400">
              Ve B-POS completo
            </Link>
          </p>
        </div>
      </section>

      <footer className="border-t border-zinc-800 py-8 text-center text-sm text-zinc-500">
        <p>© {new Date().getFullYear()} B-POS · Las pantallas son animaciones de un restaurante de ejemplo.</p>
      </footer>
    </main>
  );
}
