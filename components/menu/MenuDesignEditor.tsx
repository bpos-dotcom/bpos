"use client";
/**
 * Configuración → Menú digital → Diseño: textos, imágenes y botones de cada
 * sección del menú público. Cada sección se puede apagar. Los cambios se
 * guardan solos y se ven en la liga en menos de un minuto.
 */
import { useState } from "react";
import type { Product } from "@/data/products";
import type { Align, ChannelLink, MenuDesign } from "@/lib/digital-menu";
import { uploadBusinessImage } from "@/lib/media";

const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";
const label = "block text-sm font-bold text-zinc-300";

function Section({ title, hint, on, onToggle, children }: { title: string; hint: string; on: boolean; onToggle: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border p-4 ${on ? "border-zinc-700 bg-black" : "border-zinc-900 bg-black/40"}`}>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} className="mt-1 h-5 w-5 accent-orange-500" />
        <span>
          <span className="font-black">{title}</span>
          <span className="block text-xs text-zinc-500">{hint}</span>
        </span>
      </label>
      {on && <div className="mt-4 grid gap-3 md:grid-cols-2">{children}</div>}
    </div>
  );
}

function Text({ text, value, onChange, max = 60, placeholder = "", wide = false }: { text: string; value: string; onChange: (v: string) => void; max?: number; placeholder?: string; wide?: boolean }) {
  return (
    <label className={`${label} ${wide ? "md:col-span-2" : ""}`}>
      {text}
      <input value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${input} mt-1`} />
    </label>
  );
}

function ImageField({ text, value, onChange, maxSide = 1600 }: { text: string; value: string; onChange: (v: string) => void; maxSide?: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onChange(await uploadBusinessImage(file, "menu", maxSide));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo subir la imagen.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="md:col-span-2">
      <p className={label}>{text}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        {value && (
          // eslint-disable-next-line @next/next/no-img-element -- imagen del menú en la nube
          <img src={value} alt="" className="h-20 w-32 rounded-xl object-cover" />
        )}
        <label className="cursor-pointer rounded-2xl border border-orange-500 px-4 py-2 text-sm font-black text-orange-300 hover:bg-orange-500/10">
          {busy ? "Subiendo..." : value ? "Cambiar imagen" : "📷 Subir imagen"}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
        {value && (
          <button onClick={() => onChange("")} className="rounded-2xl border border-zinc-800 px-4 py-2 text-sm text-zinc-400">
            Quitar
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs font-bold text-red-300">{error}</p>}
    </div>
  );
}

/** De qué lado salen los textos y botones encima de la imagen */
function AlignPicker({ value, onChange }: { value: Align; onChange: (v: Align) => void }) {
  const options: [Align, string][] = [
    ["left", "⬅️ Izquierda"],
    ["center", "⬆️ Centro"],
    ["right", "➡️ Derecha"],
  ];
  return (
    <div className="md:col-span-2">
      <p className={label}>Textos y botones encima de la imagen</p>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`rounded-2xl border px-3 py-2 text-sm font-black ${value === v ? "border-orange-500 bg-orange-500/15 text-orange-300" : "border-zinc-800 text-zinc-400"}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Channel({ name, hint, value, onChange }: { name: string; hint: string; value: ChannelLink; onChange: (v: ChannelLink) => void }) {
  // La liga se guarda al salir del campo (a medio escribir todavía no es válida)
  const [draft, setDraft] = useState(value.url);
  return (
    <div className="rounded-2xl border border-zinc-800 p-3 md:col-span-2">
      <label className="flex items-center gap-2 font-black">
        <input type="checkbox" checked={value.on} onChange={(e) => onChange({ ...value, on: e.target.checked })} className="h-5 w-5 accent-orange-500" />
        {name}
      </label>
      {value.on && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.trim())}
          onBlur={() => onChange({ ...value, url: draft })}
          placeholder={hint}
          className={`${input} mt-2 text-sm`}
        />
      )}
      {value.on && draft && !/^https:\/\/\S+$/i.test(draft) && <p className="mt-1 text-xs text-red-300">La liga debe empezar con https://</p>}
    </div>
  );
}

export function MenuDesignEditor({ design, products, onChange }: { design: MenuDesign; products: Product[]; onChange: (d: MenuDesign) => void }) {
  const set = <K extends keyof MenuDesign>(key: K, patch: Partial<MenuDesign[K]>) => onChange({ ...design, [key]: { ...design[key], ...patch } });
  const sellable = products.filter((p) => !p.notSoldAlone);

  return (
    <div className="space-y-3">
      <Section title="Barra de arriba" hint="Frase corta, ciudad y horario (el horario sale de tu configuración)." on={design.topBar.on} onToggle={(on) => set("topBar", { on })}>
        <Text text="Frase" value={design.topBar.text} max={90} placeholder="Hamburguesas que hacen un mejor día" onChange={(text) => set("topBar", { text })} />
        <Text text="Ciudad" value={design.topBar.city} placeholder="Lerdo, Durango" onChange={(city) => set("topBar", { city })} />
      </Section>

      <Section title="Portada" hint="La imagen grande de arriba, a todo lo ancho, con tu mensaje encima a la izquierda." on={design.hero.on} onToggle={(on) => set("hero", { on })}>
        <ImageField text="Imagen de portada: horizontal a todo lo ancho (ej. 1600 × 600). Mejor una ilustración sin texto, tus textos van encima" value={design.hero.image} onChange={(image) => set("hero", { image })} />
        <AlignPicker value={design.hero.align} onChange={(align) => set("hero", { align })} />
        <Text text="Texto pequeño de arriba" value={design.hero.eyebrow} placeholder="MÁS QUE HAMBURGUESAS" onChange={(eyebrow) => set("hero", { eyebrow })} />
        <Text text="Botón" value={design.hero.button} placeholder="Ver menú" onChange={(button) => set("hero", { button })} />
        <Text text="Título" value={design.hero.title} placeholder="SABOR QUE" onChange={(title) => set("hero", { title })} />
        <Text text="Título (segunda línea, en tu color)" value={design.hero.highlight} placeholder="TE HACE FELIZ" onChange={(highlight) => set("hero", { highlight })} />
        <Text text="Texto" wide max={200} value={design.hero.text} placeholder="Hamburguesas, alitas, hot dogs y más." onChange={(text) => set("hero", { text })} />
        {[0, 1, 2].map((i) => (
          <Text
            key={i}
            text={`Etiqueta ${i + 1}`}
            max={30}
            value={design.hero.badges[i] || ""}
            placeholder={["Ingredientes premium", "Recetas originales", "Buena actitud"][i]}
            onChange={(v) => set("hero", { badges: design.hero.badges.map((b, j) => (j === i ? v : b)) })}
          />
        ))}
      </Section>

      <Section title="Combo destacado" hint="Un producto en grande con su precio y botón de pedir." on={design.featured.on} onToggle={(on) => set("featured", { on })}>
        <label className={`${label} md:col-span-2`}>
          Producto
          <select
            value={design.featured.productId ?? ""}
            onChange={(e) => set("featured", { productId: e.target.value ? Number(e.target.value) : null })}
            className={`${input} mt-1`}
          >
            <option value="">— Elige un producto —</option>
            {sellable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · ${Number(p.price).toFixed(2)}
              </option>
            ))}
          </select>
        </label>
        <ImageField text="Imagen del banner (si no, usa la foto del producto)" value={design.featured.image} onChange={(image) => set("featured", { image })} />
        <Text text="Texto pequeño de arriba" value={design.featured.eyebrow} placeholder="COMBO DESTACADO" onChange={(eyebrow) => set("featured", { eyebrow })} />
        <Text text="Sello" value={design.featured.badge} placeholder="El combo favorito" onChange={(badge) => set("featured", { badge })} />
        <Text text="Descripción (si no, usa la del producto)" wide max={200} value={design.featured.text} onChange={(text) => set("featured", { text })} />
      </Section>

      <Section title="Los más pedidos" hint="Automático: lo más vendido de los últimos 30 días en esta sucursal." on={design.top.on} onToggle={(on) => set("top", { on })}>
        <Text text="Título" value={design.top.title} placeholder="Los más pedidos" onChange={(title) => set("top", { title })} />
        <label className={label}>
          Cuántos mostrar
          <select value={design.top.count} onChange={(e) => set("top", { count: Number(e.target.value) })} className={`${input} mt-1`}>
            {[3, 4, 5, 6, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </Section>

      <Section title="Pide donde quieras" hint="Botones a tu WhatsApp, DiDi Food, Uber Eats y Rappi." on={design.channels.on} onToggle={(on) => set("channels", { on })}>
        <ImageField text="Imagen horizontal a todo lo ancho (ilustración sin texto, ej. 1600 × 500); los botones van encima. Una mascota cuadrada sale de lado" value={design.channels.image} onChange={(image) => set("channels", { image })} />
        <AlignPicker value={design.channels.align} onChange={(align) => set("channels", { align })} />
        <Text text="Título" value={design.channels.title} placeholder="Pide" onChange={(title) => set("channels", { title })} />
        <Text text="Título (en tu color)" value={design.channels.highlight} placeholder="donde quieras" onChange={(highlight) => set("channels", { highlight })} />
        <Text text="Texto" wide max={120} value={design.channels.text} placeholder="Tu Burger Planet favorito, ahora más cerca de ti." onChange={(text) => set("channels", { text })} />
        <div className="rounded-2xl border border-zinc-800 p-3 md:col-span-2">
          <label className="flex items-center gap-2 font-black">
            <input
              type="checkbox"
              checked={design.channels.whatsapp.on}
              onChange={(e) => set("channels", { whatsapp: { ...design.channels.whatsapp, on: e.target.checked } })}
              className="h-5 w-5 accent-orange-500"
            />
            WhatsApp
          </label>
          <p className="mt-1 text-xs text-zinc-500">Usa el WhatsApp del negocio de la sección de abajo.</p>
        </div>
        <Channel name="DiDi Food" hint="https://... (liga de tu tienda en DiDi Food)" value={design.channels.didi} onChange={(didi) => set("channels", { didi })} />
        <Channel name="Uber Eats" hint="https://www.ubereats.com/mx/store/..." value={design.channels.uber} onChange={(uber) => set("channels", { uber })} />
        <Channel name="Rappi" hint="https://www.rappi.com.mx/restaurantes/..." value={design.channels.rappi} onChange={(rappi) => set("channels", { rappi })} />
      </Section>

      <Section title="Banner final" hint="Imagen con un mensaje al final del menú." on={design.banner.on} onToggle={(on) => set("banner", { on })}>
        <ImageField text="Imagen del banner: horizontal a todo lo ancho, se ve completa" value={design.banner.image} onChange={(image) => set("banner", { image })} />
        <Text text="Título" value={design.banner.title} placeholder="HAMBURGUESAS" onChange={(title) => set("banner", { title })} />
        <Text text="Título (en tu color)" value={design.banner.highlight} placeholder="CON GRAN ACTITUD" onChange={(highlight) => set("banner", { highlight })} />
        <Text text="Texto al lado" wide value={design.banner.side} placeholder="Buena comida, mejores momentos" onChange={(side) => set("banner", { side })} />
      </Section>
    </div>
  );
}
