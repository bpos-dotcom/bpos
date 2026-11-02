"use client";
/**
 * Configuración → Métodos de pago → Propinas: si al cobrar se pregunta la
 * propina (opcional) y con qué porcentajes sugeridos. Las propinas se
 * guardan aparte de la venta y salen en el corte de caja.
 */
import { useEffect, useState } from "react";
import { getBusinessSettings, saveBusinessSettings } from "@/lib/business-settings";

export function TipsCard() {
  const [enabled, setEnabled] = useState(false);
  const [suggestions, setSuggestions] = useState("10, 15, 20");
  useEffect(() => {
    const s = getBusinessSettings();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- configuración del navegador: solo después de montar
    setEnabled(s.tipsEnabled);
    setSuggestions(s.tipSuggestions.join(", "));
  }, []);

  function save(next: { enabled?: boolean; suggestions?: string }) {
    const on = next.enabled ?? enabled;
    const text = next.suggestions ?? suggestions;
    const list = text.split(/[,\s]+/).map((n) => Number(n)).filter((n) => n > 0);
    const saved = saveBusinessSettings({ tipsEnabled: on, tipSuggestions: list.length ? list : [10, 15, 20] });
    setEnabled(saved.tipsEnabled);
    setSuggestions(saved.tipSuggestions.join(", "));
  }

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-orange-500">💛 Propinas</h2>
          <p className="mt-1 text-sm text-zinc-400">Al cobrar se pregunta la propina (opcional, el cliente puede decir que no). Se registra aparte de la venta y sale en el corte de caja.</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 font-black">
          <input type="checkbox" checked={enabled} onChange={(e) => save({ enabled: e.target.checked })} className="h-5 w-5 accent-orange-500" />
          {enabled ? "Activas" : "Apagadas"}
        </label>
      </div>
      {enabled && (
        <label className="mt-4 block text-sm font-bold text-zinc-400">
          Porcentajes sugeridos (separados por coma, máximo 4)
          <input value={suggestions} onChange={(e) => setSuggestions(e.target.value)} onBlur={() => save({ suggestions })} placeholder="10, 15, 20" className="mt-1 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white sm:w-72" />
        </label>
      )}
    </section>
  );
}
