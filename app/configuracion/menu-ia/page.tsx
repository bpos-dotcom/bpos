"use client";
/**
 * Configuración → Subir menú con IA.
 * Fotos o PDF del menú → Claude los lee (app/api/ai/menu) → se revisan aquí
 * → se agregan a Productos. La llave de Anthropic vive solo en la caja.
 */
import { useEffect, useMemo, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { getAdminProducts, saveAdminProducts } from "@/lib/admin";
import { addAuditEvent } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { bridgeFetch } from "@/lib/bridge/bridge-fetch";
import type { KitchenStation, Product } from "@/data/products";

const STATIONS: KitchenStation[] = ["Parrilla", "Freidora", "Barra", "Cocina"];
const MAX_SIDE = 2000; // las fotos se achican para mandarlas rápido (Claude no necesita más)

type Upload = { name: string; mediaType: string; data: string; preview?: string; size: number };
type Row = {
  key: number;
  selected: boolean;
  name: string;
  category: string;
  price: number;
  emoji: string;
  station: KitchenStation;
  description: string;
  existing?: Product; // producto de B-POS con el mismo nombre
};

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function readAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function shrinkImage(file: File): Promise<Upload> {
  const url = await readAsDataUrl(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const jpeg = canvas.toDataURL("image/jpeg", 0.85);
  return { name: file.name, mediaType: "image/jpeg", data: jpeg.split(",")[1], preview: jpeg, size: Math.round((jpeg.length * 3) / 4) };
}

async function toUpload(file: File): Promise<Upload> {
  if (file.type === "application/pdf") {
    const url = await readAsDataUrl(file);
    return { name: file.name, mediaType: "application/pdf", data: url.split(",")[1], size: file.size };
  }
  if (file.type.startsWith("image/")) return shrinkImage(file);
  throw new Error(`${file.name}: solo fotos o PDF.`);
}

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export default function MenuIaPage() {
  // Llave
  const [keyInfo, setKeyInfo] = useState<{ configured: boolean; hint: string | null } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keyMsg, setKeyMsg] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);

  // Menú
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- productos del navegador: solo después de montar
    setProducts(getAdminProducts());
    bridgeFetch("/api/ai/key", { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => setKeyInfo({ configured: Boolean(b.configured), hint: b.hint || null }))
      .catch(() => setKeyInfo({ configured: false, hint: null }));
  }, []);

  async function saveKey() {
    setKeyBusy(true);
    setKeyMsg("Probando la llave con Claude...");
    try {
      const r = await bridgeFetch("/api/ai/key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: keyInput }) });
      const b = await r.json();
      if (!r.ok) {
        setKeyMsg(`❌ ${b.error || "No se pudo guardar."}`);
        return;
      }
      setKeyInfo({ configured: true, hint: b.hint });
      setKeyInput("");
      setKeyMsg("✅ Llave guardada y probada. Ya puedes subir tu menú.");
      addAuditEvent({ category: "Seguridad", action: "ai.key.saved", description: `${getCurrentUser().name} guardó la llave de IA (${b.hint}) en esta caja`, userName: getCurrentUser().name });
    } catch {
      setKeyMsg("❌ No se pudo conectar con B-POS en esta computadora.");
    } finally {
      setKeyBusy(false);
    }
  }

  async function removeKey() {
    if (!confirm("¿Quitar la llave de IA de esta caja?")) return;
    const r = await bridgeFetch("/api/ai/key", { method: "DELETE" });
    const b = await r.json().catch(() => ({}));
    setKeyInfo({ configured: Boolean(b.configured), hint: b.hint || null });
    setKeyMsg("Llave quitada.");
    addAuditEvent({ category: "Seguridad", action: "ai.key.removed", description: `${getCurrentUser().name} quitó la llave de IA de esta caja`, userName: getCurrentUser().name });
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setError("");
    try {
      const next = await Promise.all(Array.from(list).map(toUpload));
      setUploads((prev) => [...prev, ...next].slice(0, 20));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo.");
    }
  }

  async function readMenu() {
    setReading(true);
    setError("");
    setWarnings([]);
    setSaved("");
    try {
      const categories = [...new Set(products.map((p) => p.category))];
      const r = await bridgeFetch("/api/ai/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: uploads.map(({ name, mediaType, data }) => ({ name, mediaType, data })), categories }),
      });
      const b = await r.json();
      if (!r.ok) {
        setError(b.error || "No se pudo leer el menú.");
        return;
      }
      const byName = new Map(products.map((p) => [normalize(p.name), p]));
      setRows(
        (b.items as Omit<Row, "key" | "selected" | "existing">[]).map((item, i) => {
          const existing = byName.get(normalize(item.name));
          return { ...item, key: i, existing, selected: !existing };
        })
      );
      setWarnings(b.warnings || []);
    } catch {
      setError("No se pudo conectar con B-POS en esta computadora.");
    } finally {
      setReading(false);
    }
  }

  function update(key: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const counts = useMemo(() => {
    const chosen = rows.filter((r) => r.selected);
    return {
      add: chosen.filter((r) => !r.existing).length,
      update: chosen.filter((r) => r.existing).length,
      total: chosen.length,
    };
  }, [rows]);

  function saveProducts() {
    const chosen = rows.filter((r) => r.selected && r.name.trim() && r.price > 0);
    if (!chosen.length) return;
    const current = getAdminProducts();
    const updates = new Map(chosen.filter((r) => r.existing).map((r) => [r.existing!.id, r]));
    const base = Date.now();
    const next: Product[] = [
      // Los que ya existían: se actualiza lo que leyó la IA (precio, categoría, estación, emoji)
      ...current.map((p) => {
        const r = updates.get(p.id);
        return r ? { ...p, category: r.category, price: r.price, emoji: r.emoji, station: r.station } : p;
      }),
      ...chosen
        .filter((r) => !r.existing)
        .map((r, i) => ({ id: base + i, name: r.name.trim(), category: r.category.trim(), price: r.price, emoji: r.emoji || "🍽️", station: r.station })),
    ];
    saveAdminProducts(next);
    setProducts(next);
    const user = getCurrentUser();
    addAuditEvent({
      category: "Productos",
      action: "products.imported",
      description: `${user.name} agregó ${counts.add} y actualizó ${counts.update} producto(s) con Subir menú con IA`,
      userName: user.name,
      metadata: { added: counts.add, updated: counts.update },
    });
    setSaved(`✅ Listo: ${counts.add} producto(s) nuevo(s) y ${counts.update} actualizado(s). Ya están en Configuración → Productos.`);
    setRows([]);
    setUploads([]);
  }

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Subir menú con IA" subtitle="Toma fotos de tu menú y Claude registra tus productos. Tú revisas antes de guardar.">
        <div className="space-y-6">
          {/* 1. Llave */}
          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
            <h2 className="text-lg font-black">1. Llave de Anthropic</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Se guarda solo en esta computadora de la caja. No se sube a la nube ni a GitHub. Cada menú leído cuesta centavos de dólar en tu cuenta de Anthropic.
            </p>
            {keyInfo === null ? (
              <p className="mt-3 text-sm text-zinc-500">Revisando...</p>
            ) : keyInfo.configured ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-black text-emerald-400">✅ Llave guardada ({keyInfo.hint})</span>
                <button onClick={removeKey} className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300">Quitar llave</button>
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                type="password"
                autoComplete="off"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={keyInfo?.configured ? "Pegar otra llave (opcional)" : "Pega tu llave: sk-ant-..."}
                className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-black px-4 py-3 font-mono text-sm"
              />
              <button onClick={saveKey} disabled={keyBusy || !keyInput.trim()} className="rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-black disabled:opacity-40">
                {keyBusy ? "Probando..." : "Guardar y probar"}
              </button>
            </div>
            {keyMsg && <p className="mt-2 text-sm text-zinc-300">{keyMsg}</p>}
          </section>

          {/* 2. Archivos */}
          <section className={`rounded-3xl border border-zinc-800 bg-zinc-950 p-5 ${keyInfo?.configured ? "" : "opacity-50"}`}>
            <h2 className="text-lg font-black">2. Fotos o PDF del menú</h2>
            <p className="mt-1 text-sm text-zinc-400">Fotos derechas y con buena luz. Puedes subir varias páginas juntas (hasta 20).</p>
            <label className="mt-3 flex cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-zinc-700 p-6 text-sm font-black text-zinc-300 hover:border-orange-500">
              📷 Elegir fotos o PDF
              <input type="file" accept="image/*,application/pdf" multiple className="hidden" disabled={!keyInfo?.configured} onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
            </label>
            {uploads.length > 0 && (
              <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {uploads.map((u, i) => (
                  <li key={`${u.name}-${i}`} className="relative rounded-2xl border border-zinc-800 bg-black p-2 text-xs text-zinc-400">
                    {u.preview ? <img src={u.preview} alt={u.name} className="h-28 w-full rounded-xl object-cover" /> : <div className="flex h-28 items-center justify-center text-3xl">📄</div>}
                    <p className="mt-1 truncate">{u.name}</p>
                    <p>{kb(u.size)}</p>
                    <button onClick={() => setUploads((prev) => prev.filter((_, j) => j !== i))} className="absolute right-3 top-3 rounded-full bg-black/80 px-2 text-white" aria-label="Quitar">×</button>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={readMenu}
              disabled={!keyInfo?.configured || !uploads.length || reading}
              className="mt-4 w-full rounded-2xl bg-orange-500 px-5 py-4 text-base font-black text-black disabled:opacity-40"
            >
              {reading ? "🤖 Claude está leyendo tu menú... (puede tardar 1 o 2 minutos)" : "🤖 Leer menú con IA"}
            </button>
            {error && <p className="mt-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
            {saved && <p className="mt-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">{saved}</p>}
          </section>

          {/* 3. Revisión */}
          {rows.length > 0 && (
            <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
              <h2 className="text-lg font-black">3. Revisa y guarda</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Claude encontró {rows.length} producto(s). Corrige lo que haga falta. Los que ya existen vienen sin marcar: márcalos solo si quieres actualizar su precio.
              </p>
              {warnings.length > 0 && (
                <ul className="mt-3 space-y-1 rounded-2xl border border-orange-500/40 bg-orange-500/10 p-3 text-sm text-orange-200">
                  {warnings.map((w, i) => <li key={i}>⚠️ {w}</li>)}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <button onClick={() => setRows((p) => p.map((r) => ({ ...r, selected: !r.existing })))} className="rounded-full border border-zinc-700 px-3 py-1">Solo nuevos</button>
                <button onClick={() => setRows((p) => p.map((r) => ({ ...r, selected: true })))} className="rounded-full border border-zinc-700 px-3 py-1">Marcar todos</button>
                <button onClick={() => setRows((p) => p.map((r) => ({ ...r, selected: false })))} className="rounded-full border border-zinc-700 px-3 py-1">Desmarcar todos</button>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="text-left text-xs text-zinc-500">
                    <tr>
                      <th className="p-2"></th>
                      <th className="p-2">Producto</th>
                      <th className="p-2">Categoría</th>
                      <th className="p-2">Precio</th>
                      <th className="p-2">Emoji</th>
                      <th className="p-2">Estación</th>
                      <th className="p-2">En B-POS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const priceChanged = r.existing && r.existing.price !== r.price;
                      return (
                        <tr key={r.key} className={`border-t border-zinc-900 ${r.selected ? "" : "opacity-50"}`}>
                          <td className="p-2"><input type="checkbox" checked={r.selected} onChange={(e) => update(r.key, { selected: e.target.checked })} className="h-5 w-5 accent-orange-500" /></td>
                          <td className="p-2">
                            <input value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} disabled={Boolean(r.existing)} className="w-full rounded-xl border border-zinc-800 bg-black px-2 py-1" />
                            {r.description && <p className="mt-1 text-xs text-zinc-500">{r.description}</p>}
                          </td>
                          <td className="p-2"><input value={r.category} onChange={(e) => update(r.key, { category: e.target.value })} className="w-32 rounded-xl border border-zinc-800 bg-black px-2 py-1" /></td>
                          <td className="p-2"><input type="number" min={0} step="0.5" value={r.price} onChange={(e) => update(r.key, { price: Number(e.target.value) || 0 })} className="w-24 rounded-xl border border-zinc-800 bg-black px-2 py-1 text-right" /></td>
                          <td className="p-2"><input value={r.emoji} onChange={(e) => update(r.key, { emoji: e.target.value })} className="w-14 rounded-xl border border-zinc-800 bg-black px-2 py-1 text-center" /></td>
                          <td className="p-2">
                            <select value={r.station} onChange={(e) => update(r.key, { station: e.target.value as KitchenStation })} className="rounded-xl border border-zinc-800 bg-black px-2 py-1">
                              {STATIONS.map((s) => <option key={s}>{s}</option>)}
                            </select>
                          </td>
                          <td className="p-2 text-xs">
                            {!r.existing ? (
                              <span className="font-black text-emerald-400">Nuevo</span>
                            ) : priceChanged ? (
                              <span className="font-black text-orange-400">Ya existe · precio ${r.existing.price} → ${r.price}</span>
                            ) : (
                              <span className="text-zinc-500">Ya existe, igual</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                onClick={saveProducts}
                disabled={!counts.total}
                className="mt-4 w-full rounded-2xl bg-orange-500 px-5 py-4 text-base font-black text-black disabled:opacity-40"
              >
                Guardar: {counts.add} nuevo(s){counts.update ? ` y ${counts.update} actualizado(s)` : ""}
              </button>
            </section>
          )}
        </div>
      </AppShell>
    </RequireRole>
  );
}
