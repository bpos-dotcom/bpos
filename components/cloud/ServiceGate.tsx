"use client";
/**
 * Parte de una pantalla que es un servicio aparte (ej. el kiosco dentro del
 * menú digital): en una cuenta de solo servicios sin ese servicio vigente se
 * muestra cómo agregarlo; en B-POS completo se muestra siempre.
 */
import Link from "next/link";
import { openServices, serviceInfo, type ServiceId } from "@/lib/services";
import { useServicesState } from "@/lib/services-client";

export function ServiceGate({ service, children }: { service: ServiceId; children: React.ReactNode }) {
  const state = useServicesState();
  if (state?.kind !== "servicios" || openServices(state.services).includes(service)) return <>{children}</>;
  const info = serviceInfo(service)!;
  const price = state.catalog.find((c) => c.service === service)?.price ?? info.price;
  return (
    <section className="rounded-3xl border border-dashed border-orange-500/40 bg-zinc-950 p-5">
      <p className="text-lg font-black">
        {info.emoji} {info.name}
      </p>
      <p className="mt-1 text-sm text-zinc-400">{info.short}</p>
      <Link href="/servicios" className="mt-3 inline-block rounded-2xl bg-orange-500 px-5 py-2.5 text-sm font-black text-black">
        Agregarlo · ${Math.round(price).toLocaleString("es-MX")}/mes
      </Link>
    </section>
  );
}
