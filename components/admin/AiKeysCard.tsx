"use client";
import { ask } from "@/components/layout/Dialogs";
/**
 * Administrador de B-POS → Claves de IA: proveedor, modelo y clave por
 * función (solo el dueño de la plataforma). Se guarda una clave por
 * proveedor (Claude y Gemini): se cambia de uno a otro sin volver a pegarla.
 * La clave se guarda cifrada en el servidor y no se vuelve a mostrar (solo
 * los últimos 4). "Probar" prueba lo que está elegido, aunque no se guarde.
 * El Estudio de fotos solo usa Gemini y además lleva sus BPOS Credits.
 */
import { useCallback, useEffect, useState } from "react";
import { aiFetch } from "@/lib/ai/client";

type Provider = "anthropic" | "gemini" | "openai";
type Model = { id: string; label: string; priceIn?: number; priceOut?: number };
type Feature = {
  id: "interprete" | "asesor" | "fotos";
  title: string;
  text: string;
  providers: Provider[];
  /** Modelos propios (Estudio de fotos: modelos de imagen) */
  models?: Partial<Record<Provider, Model[]>>;
  /** BPOS Credits del Estudio de fotos */
  credits?: { perDay: number; perUse: number };
  /** Falta la migración 0029 */
  missingTable?: boolean;
  provider: Provider;
  model: string;
  keyHints: Partial<Record<Provider, string>>;
  /** Lo que de verdad se usa ahora (null = sin clave) */
  running: { provider: Provider; model: string } | null;
  priceIn: number;
  priceOut: number;
  updatedBy: string;
  updatedAt: string;
  active: "admin" | "vercel" | "ninguna";
};
type Data = { models: Record<Provider, Model[]>; vercelFallback: boolean; features: Feature[] };

const NAME: Record<Provider, string> = { anthropic: "Claude", gemini: "Gemini", openai: "OpenAI" };
const COMPANY: Record<Provider, string> = { anthropic: "Anthropic (Claude)", gemini: "Google (Gemini)", openai: "OpenAI" };
const KEY_FROM: Record<Provider, string> = { anthropic: "Anthropic", gemini: "Google AI Studio", openai: "OpenAI" };
const KEY_HINT: Record<Provider, string> = { anthropic: "sk-ant-...", gemini: "AIza...", openai: "sk-..." };

const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";
const label = "block text-sm font-bold text-zinc-300";

function FeatureCard({ f, models, vercel, onSaved }: { f: Feature; models: Data["models"]; vercel: boolean; onSaved: (d: Data) => void }) {
  const [provider, setProvider] = useState<Provider>(f.provider);
  const [model, setModel] = useState(f.model);
  const [key, setKey] = useState("");
  const [priceIn, setPriceIn] = useState(String(f.priceIn));
  const [priceOut, setPriceOut] = useState(String(f.priceOut));
  const [perDay, setPerDay] = useState(String(f.credits?.perDay ?? ""));
  const [perUse, setPerUse] = useState(String(f.credits?.perUse ?? ""));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const modelsFor = (p: Provider) => f.models?.[p] || models[p];
  const list = modelsFor(provider);
  const known = list.find((m) => m.id === model);

  const hint = f.keyHints[provider];
  const changed = provider !== f.provider || model !== f.model;
  const modelName = (p: Provider, id: string) => modelsFor(p).find((m) => m.id === id)?.label.replace(/ \(.*\)$/, "") || id;

  function pickProvider(p: Provider) {
    setProvider(p);
    setKey("");
    // De regreso al proveedor guardado: su modelo y precio
    if (p === f.provider) {
      setModel(f.model);
      setPriceIn(String(f.priceIn));
      setPriceOut(String(f.priceOut));
      return;
    }
    const first = modelsFor(p)[0];
    setModel(first.id);
    if (first.priceIn !== undefined) setPriceIn(String(first.priceIn));
    if (first.priceOut !== undefined) setPriceOut(String(first.priceOut));
  }

  function pickModel(id: string) {
    setModel(id);
    const m = list.find((x) => x.id === id);
    if (m?.priceIn !== undefined) setPriceIn(String(m.priceIn));
    if (m?.priceOut !== undefined) setPriceOut(String(m.priceOut));
  }

  async function call(body: object) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await aiFetch("/api/admin/ia", { method: "POST", body: JSON.stringify({ feature: f.id, ...body }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "No se pudo.");
      return b;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "No se pudo." });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const b = await call({
      action: "guardar",
      provider,
      model,
      key,
      priceIn: Number(priceIn),
      priceOut: Number(priceOut),
      ...(f.credits ? { creditsPerDay: Number(perDay), creditsPerUse: Number(perUse) } : {}),
    });
    if (b) {
      setKey("");
      onSaved(b as Data);
      setMsg({ ok: true, text: "✅ Guardado. Toca Probar para revisar que funciona." });
    }
  }

  async function test() {
    if (key) return setMsg({ ok: false, text: "Toca Guardar para guardar la clave nueva y luego Probar." });
    const b = await call({ action: "probar", provider, model });
    if (b)
      setMsg({
        ok: true,
        text: `✅ Funciona con ${b.model} (${b.source === "admin" ? "tu clave" : "clave de Vercel"}) · respondió "${b.answer}" en ${(b.ms / 1000).toFixed(1)} s${changed ? ". Todavía no está guardado: toca Guardar para usarlo." : ""}`,
      });
  }

  async function remove() {
    const back = provider === "anthropic" ? (vercel ? "la clave de Vercel" : "nada (se queda sin IA)") : vercel ? "Claude Opus con la clave de Vercel" : "nada (se queda sin IA)";
    if (!(await ask(`¿Quitar la clave de ${NAME[provider]}?${provider === f.provider ? ` Esta función usará ${back}.` : ""}`, { ok: "Quitar" }))) return;
    const b = await call({ action: "quitar", provider });
    if (b) onSaved(b as Data);
  }

  return (
    <div className="rounded-3xl border border-zinc-800 bg-black p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lg font-black">{f.title}</p>
          <p className="text-xs text-zinc-500">{f.text}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${f.active === "admin" ? "bg-emerald-500/20 text-emerald-300" : f.active === "vercel" ? "bg-sky-500/20 text-sky-300" : "bg-red-500/20 text-red-300"}`}>
          {f.running ? `Usando ${modelName(f.running.provider, f.running.model)} · ${f.active === "admin" ? `tu clave ${f.keyHints[f.running.provider]}` : "clave de Vercel"}` : "Sin clave"}
        </span>
      </div>

      {f.missingTable && <p className="mt-3 rounded-2xl border border-red-500/50 bg-red-500/10 p-3 text-sm font-bold text-red-200">Falta aplicar la migración 0029 en Supabase para guardar el Estudio de fotos.</p>}

      <div className={`mt-4 grid gap-2 ${f.providers.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {f.providers.map((p) => (
          <button key={p} onClick={() => pickProvider(p)} className={`rounded-2xl border px-3 py-3 font-black ${provider === p ? "border-orange-500 bg-orange-500/10 text-orange-200" : "border-zinc-800 text-zinc-400"}`}>
            {COMPANY[p]}
            <span className="block text-[11px] font-bold text-zinc-500">
              {f.keyHints[p] ? `Clave guardada ${f.keyHints[p]}` : p === "anthropic" && vercel && f.id !== "fotos" ? "Usa la clave de Vercel" : "Sin clave"}
              {f.provider === p && f.running?.provider === p ? " · en uso" : ""}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className={label}>
          Modelo
          <select value={known ? model : "__otro"} onChange={(e) => (e.target.value === "__otro" ? setModel("") : pickModel(e.target.value))} className={`${input} mt-1`}>
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value="__otro">Otro (escribirlo)</option>
          </select>
          {!known && <input value={model} onChange={(e) => setModel(e.target.value.trim())} placeholder="nombre exacto del modelo" className={`${input} mt-2 font-mono text-sm`} />}
        </label>
        <label className={label}>
          Clave de {KEY_FROM[provider]} {hint ? `(vacío = dejar la guardada ${hint})` : provider === "anthropic" && vercel ? "(vacío = usar la de Vercel)" : ""}
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            placeholder={KEY_HINT[provider]}
            className={`${input} mt-1 font-mono text-sm`}
          />
        </label>
        <label className={label}>
          Precio entrada (USD por millón de tokens)
          <input type="number" min={0} step={0.01} value={priceIn} onChange={(e) => setPriceIn(e.target.value)} className={`${input} mt-1`} />
        </label>
        <label className={label}>
          Precio salida (USD por millón de tokens)
          <input type="number" min={0} step={0.01} value={priceOut} onChange={(e) => setPriceOut(e.target.value)} className={`${input} mt-1`} />
        </label>
      </div>
      {f.credits && (
        <div className="mt-3 grid gap-3 rounded-2xl border border-violet-500/40 bg-violet-500/5 p-3 md:grid-cols-2">
          <label className={label}>
            BPOS Credits al día por negocio
            <input type="number" min={0} step={1} value={perDay} onChange={(e) => setPerDay(e.target.value)} className={`${input} mt-1`} />
          </label>
          <label className={label}>
            BPOS Credits por foto
            <input type="number" min={1} step={1} value={perUse} onChange={(e) => setPerUse(e.target.value)} className={`${input} mt-1`} />
          </label>
          <p className="text-xs text-zinc-400 md:col-span-2">
            Con estos números cada negocio Max puede mejorar {Math.floor((Number(perDay) || 0) / Math.max(1, Number(perUse) || 1))} foto(s) al día. Se reinician a medianoche (hora de México) y si la IA falla no se gastan.
          </p>
        </div>
      )}
      <p className="mt-2 text-xs text-zinc-500">
        El precio sirve para llevar el presupuesto de IA de cada negocio. Revísalo en la página de precios del proveedor; si lo dejas en 0, no se cuenta el gasto.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button disabled={busy || !model} onClick={() => void save()} className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black disabled:opacity-40">
          Guardar
        </button>
        <button disabled={busy} onClick={() => void test()} className="rounded-2xl border border-emerald-500 px-5 py-3 font-black text-emerald-300 disabled:opacity-40">
          Probar
        </button>
        {hint && (
          <button disabled={busy} onClick={() => void remove()} className="rounded-2xl border border-zinc-700 px-5 py-3 font-black text-zinc-400 disabled:opacity-40">
            Quitar clave de {NAME[provider]}
          </button>
        )}
      </div>
      {changed && !busy && !msg && (
        <p className="mt-2 text-xs font-bold text-yellow-300">
          Elegiste {NAME[provider]} · {modelName(provider, model)}. Puedes probarlo antes; se usa hasta que toques Guardar.
        </p>
      )}
      {busy && <p className="mt-2 text-sm text-zinc-400">Un momento...</p>}
      {msg && <p className={`mt-2 text-sm font-bold ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</p>}
      {f.updatedAt && <p className="mt-2 text-xs text-zinc-600">Cambiada por {f.updatedBy} el {new Date(f.updatedAt).toLocaleString("es-MX")}</p>}
    </div>
  );
}

export function AiKeysCard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await aiFetch("/api/admin/ia", { cache: "no-store" });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || "No se pudo leer.");
      setData(b as Data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga desde el servidor
    void load();
  }, [load]);

  return (
    <section className="rounded-3xl border border-orange-500/40 bg-zinc-950 p-6">
      <h2 className="text-xl font-black">🔑 Claves de IA</h2>
      <p className="mt-1 text-sm text-zinc-400">Solo tú ves esto. Elige proveedor, modelo y clave para cada función. Puedes tener guardada la de Claude y la de Gemini y cambiar cuando quieras. Las claves se guardan cifradas y no se vuelven a mostrar.</p>
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      {!data && !error && <p className="mt-3 text-sm text-zinc-500">Cargando...</p>}
      {data && (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {data.features.map((f) => (
            <FeatureCard key={`${f.id}-${f.updatedAt}`} f={f} models={data.models} vercel={data.vercelFallback} onSaved={setData} />
          ))}
        </div>
      )}
    </section>
  );
}
