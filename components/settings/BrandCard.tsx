"use client";
/**
 * Configuración → Sistema: cómo se ve tu negocio en el menú lateral (logo,
 * nombre y su color). Se guarda en los ajustes del negocio, que se
 * sincronizan con la nube: se ve igual en todos los dispositivos.
 */
import { useEffect, useState } from "react";
import { getBusinessSettings, saveBusinessSettings } from "@/lib/business-settings";

const BRAND_LOGO_PX = 160;

/** Reduce el logo a 160 px (conserva lo transparente) para que pese poco en la nube. */
async function toBrandLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("No se pudo abrir la imagen."));
      i.src = url;
    });
    const scale = Math.min(1, BRAND_LOGO_PX / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("El navegador no pudo procesar la imagen.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BrandCard({ className = "" }: { className?: string }) {
  const [name, setName] = useState("");
  const [logo, setLogo] = useState("");
  const [color, setColor] = useState("#f97316");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const s = getBusinessSettings();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ajustes del navegador: solo después de montar
    setName(s.businessName);
    setLogo(s.brandLogo);
    setColor(s.brandColor);
  }, []);

  async function onLogo(file: File | undefined) {
    if (!file) return;
    try {
      setLogo(await toBrandLogo(file));
      setMessage("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo usar esa imagen.");
    }
  }

  function save() {
    saveBusinessSettings({ businessName: name.trim() || "Mi negocio", brandLogo: logo, brandColor: color });
    setMessage("✅ Guardado. Ya se ve en el menú de todos tus dispositivos.");
  }

  return (
    <section className={`rounded-3xl border border-zinc-800 bg-zinc-950 p-6 ${className}`}>
      <h2 className="text-lg font-black">🏷️ Tu negocio en el menú</h2>
      <p className="mt-1 text-sm text-zinc-400">El logo y el nombre que aparecen arriba del menú lateral.</p>

      <div className="mt-5 flex flex-wrap items-start gap-6">
        <div className="w-56 rounded-2xl border border-zinc-800 bg-black p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- vista previa (data URL) */}
          <img src={logo || "/bpos-logo.png"} alt="" className="h-14 w-14 rounded-lg object-contain" />
          <p className="mt-3 break-words text-xl font-black leading-tight" style={{ color }}>
            {name || "Mi negocio"}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-zinc-500">Operado por bpos.com.mx</p>
        </div>

        <div className="min-w-60 flex-1 space-y-4">
          <label className="block text-sm font-bold text-zinc-300">
            Nombre del negocio
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              className="mt-1 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="cursor-pointer rounded-2xl border border-orange-500 px-4 py-3 text-sm font-black text-orange-300 hover:bg-orange-500/10">
              {logo ? "Cambiar logo" : "Subir logo"}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void onLogo(e.target.files?.[0])} />
            </label>
            {logo && (
              <button onClick={() => setLogo("")} className="rounded-2xl border border-zinc-800 px-4 py-3 text-sm text-zinc-400">
                Usar el de B-POS
              </button>
            )}
            <label className="flex items-center gap-2 text-sm font-bold text-zinc-300">
              Color del nombre
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-11 w-14 cursor-pointer rounded-xl border border-zinc-800 bg-black" />
            </label>
          </div>
          <button onClick={save} className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black hover:bg-orange-400">
            Guardar
          </button>
          {message && <p className="text-sm font-bold text-zinc-300">{message}</p>}
        </div>
      </div>
    </section>
  );
}
