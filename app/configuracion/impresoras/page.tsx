"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { printDeliveryTickets, syncStationPrinters, toStationPrintersConfig } from "@/lib/localService";
import { listAgents } from "@/lib/agent/client";
import { isCloudConfigured } from "@/lib/supabase/client";
import { DEFAULT_DRAWER_METHODS, DRAWER_MIXED, DRAWER_ORDER_TYPES, type DrawerWhen } from "@/lib/cash-drawer";
import { getEnabledPaymentMethods } from "@/lib/payment-methods";

type Printer = {
  name: string;
  displayName?: string;
  isDefault?: boolean;
};

const STATIONS = [
  "Parrilla",
  "Freidora",
  "Barra",
  "Cocina",
  "Caja",
] as const;

type Station = (typeof STATIONS)[number];

const STORAGE_KEY = "bpos_station_printers";

type SavedConfig = Record<Station, string> & {
  paperWidthMm?: 58 | 80;
  printMode?: "escpos" | "windows";
  /** Cajón (lib/cash-drawer.ts): apagador general, cuándo, formas de pago y tipos de pedido */
  openDrawer?: boolean;
  drawerWhen?: DrawerWhen;
  drawerMethods?: string[];
  drawerOrderTypes?: string[];
};

/** Ticket corto para probar una estación: si sale, la impresora está bien conectada */
function testTicketHtml(station: string, width: 58 | 80) {
  const b = width === 58 ? 20 : 26;
  const now = new Date().toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; background: #fff; color: #000; overflow: hidden; }
    body { width: 100%; padding: 6px 4px 14px; font-family: Arial, Helvetica, sans-serif; font-size: ${b}px; line-height: 1.3; font-weight: 700; text-align: center; }
    .head { font-size: ${b * 1.4}px; font-weight: 900; border: 4px solid #000; padding: 6px 0; margin-bottom: 10px; }
    p { margin: 0 0 4px; }
  </style></head><body>
    <div class="head">PRUEBA DE IMPRESORA</div>
    <p>Estación: ${station.toUpperCase()}</p>
    <p>${now}</p>
    <p>Si puedes leer esto, la impresora quedó lista.</p>
    <p>B-POS</p>
  </body></html>`;
}

const check = "h-5 w-5 accent-orange-500";
const chip = (on: boolean) => `cursor-pointer rounded-xl border px-3 py-2 text-sm font-bold ${on ? "border-orange-500 bg-orange-500/15 text-orange-200" : "border-zinc-800 text-zinc-400"}`;

export default function PrinterSettingsPage() {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(false);
  const [agentError, setAgentError] = useState("");
  /** Lo último que se guardó (el Agent imprime con eso) */
  const [savedConfig, setSavedConfig] = useState<Partial<SavedConfig>>({});
  /** Prueba por estación: "…" mientras imprime, o el resultado */
  const [tests, setTests] = useState<Partial<Record<Station, { ok: boolean; text: string } | "…">>>({});

  const [config, setConfig] = useState<SavedConfig>({
    Parrilla: "",
    Freidora: "",
    Barra: "",
    Cocina: "",
    Caja: "",
    paperWidthMm: 80,
    printMode: "escpos",
  });

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) {
      setConfig((current) => ({ ...current, ...JSON.parse(saved) }));
      setSavedConfig(JSON.parse(saved));
    }

    loadPrinters();
  }, []);

  async function loadPrinters() {
    setLoading(true);
    setAgentError("");

    try {
      if (isCloudConfigured) {
        // Las impresoras de la PC con B-POS Agent (las avisa a la nube cada pocos segundos)
        const agents = await listAgents();
        if (agents.length === 0) throw new Error("Esta sucursal no tiene B-POS Agent vinculado. Vincúlalo en Configuración → Sistema.");
        const seen = new Map<string, Printer>();
        for (const agent of agents) for (const p of agent.printers) if (!seen.has(p.name)) seen.set(p.name, p);
        setPrinters([...seen.values()]);
        if (!agents.some((a) => a.online)) setAgentError("B-POS Agent está desconectado: revisa que la computadora de las impresoras esté prendida.");
      } else {
        const response = await fetch("http://localhost:4850/printers");
        const data = (await response.json()) as { printers?: Printer[]; error?: string };
        if (!Array.isArray(data.printers)) throw new Error(data.error || "Respuesta inválida del Agent.");
        setPrinters(data.printers);
      }
    } catch (error) {
      setAgentError(error instanceof Error && isCloudConfigured ? error.message : "No se pudo conectar con B-POS Agent en esta computadora.");
    }

    setLoading(false);
  }

  async function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    setSavedConfig(config);
    try {
      // El Agent también la guarda: con ella imprime el ticket original y el respaldo a Cocina
      await syncStationPrinters(toStationPrintersConfig(config));
      alert("Configuración guardada.");
    } catch {
      alert("Se guardó en B-POS, pero el Agent no respondió. Se aplicará cuando se conecte.");
    }
  }

  /** Imprime un ticket de prueba en la impresora guardada de esa estación (por el Agent, igual que un pedido) */
  async function testPrinter(station: Station) {
    setTests((t) => ({ ...t, [station]: "…" }));
    try {
      const width = savedConfig.paperWidthMm === 58 ? 58 : 80;
      const result = await printDeliveryTickets({ platform: "prueba", orderId: `${station}-${Date.now()}`, tickets: [{ target: station, html: testTicketHtml(station, width) }], force: true });
      const r = result.results?.[0];
      setTests((t) => ({
        ...t,
        [station]: r?.ok ? { ok: true, text: `Se mandó a "${r.printer}". Revisa que haya salido el papel.` } : { ok: false, text: r?.error || "El Agent no imprimió la prueba." },
      }));
    } catch (error) {
      setTests((t) => ({ ...t, [station]: { ok: false, text: error instanceof Error ? error.message : "No se pudo hablar con B-POS Agent." } }));
    }
  }

  return (
    <AppShell
      title="Impresoras"
      subtitle="Asigna la impresora física para cada estación."
    >
      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-8">

        <p className="text-sm text-zinc-400">
          Los pedidos de delivery (Rappi, Uber Eats, DiDi Food) imprimen un <b className="text-zinc-200">ticket de tu negocio</b> en
          cada estación, solo con lo que le toca, y el <b className="text-zinc-200">ticket de la bolsa</b> en Caja. Lo que no tenga equivalencia sale en <b className="text-zinc-200">Cocina</b>.
        </p>

        <button
          onClick={loadPrinters}
          className="mt-6 rounded-2xl bg-orange-500 px-5 py-3 font-black text-black"
        >
          {loading ? "Buscando..." : "Buscar impresoras"}
        </button>

        {agentError && (
          <p className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{agentError}</p>
        )}

        <div className="mt-8 space-y-6">
          {STATIONS.map((station) => (
            <div
              key={station}
              className="rounded-2xl border border-zinc-800 bg-black p-5"
            >
              <p className="mb-3 text-lg font-black text-orange-500">
                {station}
                {station === "Cocina" && <span className="ml-2 text-xs font-bold text-zinc-500">también recibe lo que no tenga estación</span>}
                {station === "Caja" && <span className="ml-2 text-xs font-bold text-zinc-500">ticket para grapar en la bolsa</span>}
              </p>

              <div className="flex gap-2">
              <select
                value={config[station]}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    [station]: e.target.value,
                  })
                }
                className="w-full min-w-0 rounded-xl border border-zinc-800 bg-zinc-900 p-3"
              >
                <option value="">{station === "Cocina" || station === "Caja" ? "Sin asignar" : "Sin asignar (usa la de Cocina)"}</option>

                {config[station] && !printers.some((p) => p.name === config[station]) && (
                  <option value={config[station]}>{config[station]} (no encontrada)</option>
                )}

                {printers.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.displayName || printer.name}
                    {printer.isDefault ? " · predeterminada" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => testPrinter(station)}
                disabled={tests[station] === "…" || (config[station] || "") !== (savedConfig[station] || "") || (!config[station] && !config.Cocina && station !== "Caja") || (station === "Caja" && !config.Caja)}
                className="shrink-0 rounded-xl border border-orange-500 px-4 font-black text-orange-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
              >
                {tests[station] === "…" ? "Imprimiendo…" : "🖨️ Probar"}
              </button>
              </div>
              {(config[station] || "") !== (savedConfig[station] || "") ? (
                <p className="mt-2 text-xs text-yellow-300">Guarda la configuración (botón verde de abajo) para poder probarla.</p>
              ) : (
                tests[station] &&
                tests[station] !== "…" && (
                  <p className={`mt-2 text-xs font-bold ${(tests[station] as { ok: boolean }).ok ? "text-emerald-400" : "text-red-300"}`}>
                    {(tests[station] as { ok: boolean }).ok ? "✓ " : "✕ "}
                    {(tests[station] as { text: string }).text}
                  </p>
                )
              )}
            </div>
          ))}

          <div className="rounded-2xl border border-zinc-800 bg-black p-5">
            <p className="mb-3 text-lg font-black text-orange-500">Ancho de papel</p>
            <select
              value={config.paperWidthMm === 58 ? 58 : 80}
              onChange={(e) => setConfig({ ...config, paperWidthMm: Number(e.target.value) === 58 ? 58 : 80 })}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-3"
            >
              <option value={80}>80 mm (térmica estándar)</option>
              <option value={58}>58 mm</option>
            </select>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-black p-5">
            <p className="mb-3 text-lg font-black text-orange-500">Tipo de impresora</p>
            <select
              value={config.printMode === "windows" ? "windows" : "escpos"}
              onChange={(e) => setConfig({ ...config, printMode: e.target.value === "windows" ? "windows" : "escpos" })}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-3"
            >
              <option value="escpos">Térmica de tickets (recomendado)</option>
              <option value="windows">Impresora de hojas (usa el controlador de Windows)</option>
            </select>
            <p className="mt-2 text-xs text-zinc-500">
              Las térmicas (XP-58, EPSON, etc.) reciben el ticket directo en su idioma (ESC/POS). Si un ticket sale en blanco, revisa que aquí diga Térmica.
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-black p-5">
            <p className="mb-3 text-lg font-black text-orange-500">Cajón de dinero</p>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={config.openDrawer !== false} onChange={(e) => setConfig({ ...config, openDrawer: e.target.checked })} className={`mt-1 ${check}`} />
              <span>
                <span className="font-black">Abrir el cajón solo al cobrar</span>
                <span className="mt-1 block text-xs text-zinc-500">
                  El cajón va conectado a la impresora de Caja (cable RJ11). Apagado, solo se abre con el botón Abrir cajón de la ventana de cobro. Necesita B-POS Agent 2.0.8 o más nuevo.
                </span>
              </span>
            </label>
            {config.openDrawer !== false && (
              <div className="mt-5 space-y-5 border-t border-zinc-800 pt-5">
                <div>
                  <p className="mb-2 text-sm font-black text-zinc-300">¿Cuándo?</p>
                  <div className="space-y-2">
                    {([
                      ["al-abrir", "Al abrir la ventana de cobro", "En cuanto el cajero da Cobrar y elige la forma de pago: el cajón ya está abierto mientras cuenta el dinero."],
                      ["al-cobrar", "Al confirmar el cobro", "Hasta que se confirma el pago (y antes del ticket). Útil si no quieres el cajón abierto mientras capturas."],
                    ] as const).map(([value, label, hint]) => (
                      <label key={value} className="flex cursor-pointer items-start gap-3">
                        <input type="radio" name="drawerWhen" checked={(config.drawerWhen || "al-abrir") === value} onChange={() => setConfig({ ...config, drawerWhen: value })} className={`mt-1 ${check}`} />
                        <span>
                          <span className="font-bold">{label}</span>
                          <span className="block text-xs text-zinc-500">{hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-black text-zinc-300">¿Con qué forma de pago?</p>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(new Set([...getEnabledPaymentMethods().map((m) => m.name), DRAWER_MIXED])).map((name) => {
                      const methods = config.drawerMethods ?? DEFAULT_DRAWER_METHODS;
                      const on = methods.includes(name);
                      return (
                        <button key={name} type="button" onClick={() => setConfig({ ...config, drawerMethods: on ? methods.filter((x) => x !== name) : [...methods, name] })} className={chip(on)}>
                          {name}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">Mixto = parte efectivo y parte tarjeta o transferencia. Con las que no marques, el cajón no se abre (ej. tarjeta).</p>
                </div>
                <div>
                  <p className="mb-2 text-sm font-black text-zinc-300">¿Para qué tipos de pedido?</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setConfig({ ...config, drawerOrderTypes: [] })} className={chip((config.drawerOrderTypes ?? []).length === 0)}>
                      Todos
                    </button>
                    {DRAWER_ORDER_TYPES.map((t) => {
                      const types = config.drawerOrderTypes ?? [];
                      const on = types.includes(t);
                      return (
                        <button key={t} type="button" onClick={() => setConfig({ ...config, drawerOrderTypes: on ? types.filter((x) => x !== t) : [...types, t] })} className={chip(on)}>
                          {t}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">Ej. solo Mostrador: a domicilio el dinero lo trae el repartidor después, y el cajón no se abre al cobrar.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={save}
          className="mt-8 rounded-2xl bg-green-500 px-6 py-3 font-black text-black"
        >
          Guardar configuración
        </button>

      </div>
    </AppShell>
  );
}
