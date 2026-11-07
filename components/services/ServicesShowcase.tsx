"use client";
/**
 * Cada servicio de B-POS por separado explicado como en la demo guiada:
 * título, para qué sirve, ventajas, qué incluye, precio y su pantalla
 * animada. Lo usan la página pública de /servicios (sin cuenta) y el panel
 * de Mis servicios; cada uno pone sus botones con `action`.
 */
import { SERVICE_SCREENS } from "@/components/services/ServiceScreens";
import { SERVICE_PITCH } from "@/lib/services-pitch";
import { money, serviceInfo, type CatalogEntry, type ServiceInfo } from "@/lib/services";

type Props = {
  services: ServiceInfo[];
  catalog: CatalogEntry[];
  action: (s: ServiceInfo, entry: CatalogEntry | undefined) => React.ReactNode;
  /** "page": a todo lo ancho como /demo · "panel": tarjetas dentro de B-POS */
  variant?: "page" | "panel";
  hidePrice?: boolean;
};

export function ServicesShowcase({ services, catalog, action, variant = "page", hidePrice }: Props) {
  return (
    <>
      {services.map((s, i) => {
        const pitch = SERVICE_PITCH[s.id];
        const Screen = SERVICE_SCREENS[s.id];
        const entry = catalog.find((c) => c.service === s.id);
        const flip = i % 2 === 1;
        const body = (
          <div className={`grid items-center gap-10 lg:grid-cols-2 ${flip ? "lg:[&>*:first-child]:order-2" : ""}`}>
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-orange-500/50 bg-orange-500/10 px-3 py-1 text-sm font-black text-orange-300">
                <span className="text-lg">{s.emoji}</span> {s.name}
              </p>
              <h2 className="mt-4 text-3xl font-black sm:text-4xl">{pitch.headline}</h2>
              <p className="mt-4 text-lg leading-7 text-zinc-400">{pitch.pitch}</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {pitch.benefits.map((b) => (
                  <div key={b.title} className="rounded-2xl border border-zinc-800 bg-black p-3">
                    <p className="font-black text-white">{b.title}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-400">{b.text}</p>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-sm font-black text-zinc-300">Incluye</p>
              <ul className="mt-2 space-y-1.5 text-sm text-zinc-400">
                {s.features.map((f) => (
                  <li key={f}>✓ {f}</li>
                ))}
              </ul>
              {!hidePrice && (
                <p className="mt-5 text-2xl font-black text-orange-400">
                  {money(entry?.price ?? s.price)}
                  <span className="text-base text-zinc-400"> /mes</span>
                  {s.addonOf && <span className="ml-2 text-sm font-bold text-zinc-400">extra de {serviceInfo(s.addonOf)!.name}</span>}
                  {(entry?.trial_days ?? 14) > 0 && <span className="ml-2 text-sm font-bold text-zinc-400">· {entry?.trial_days ?? 14} días gratis</span>}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">{action(s, entry)}</div>
            </div>
            <div className="min-w-0">
              <Screen />
            </div>
          </div>
        );
        return variant === "page" ? (
          <section key={s.id} id={s.id} className={`scroll-mt-6 border-t border-zinc-800 py-14 ${flip ? "" : "bg-zinc-950"}`}>
            <div className="mx-auto max-w-6xl px-4 sm:px-6">{body}</div>
          </section>
        ) : (
          <section key={s.id} id={s.id} className="scroll-mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-5 sm:p-8">
            {body}
          </section>
        );
      })}
    </>
  );
}
