"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { syncStationPrinters, toStationPrintersConfig } from "@/lib/localService";

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

type SavedConfig = Record<Station, string> & { paperWidthMm?: 58 | 80; printMode?: "escpos" | "windows" };

export default function PrinterSettingsPage() {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(false);
  const [agentError, setAgentError] = useState("");

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
    }

    loadPrinters();
  }, []);

  async function loadPrinters() {
    setLoading(true);
    setAgentError("");

    try {
      const response = await fetch("http://localhost:4850/printers");
      const data = (await response.json()) as { printers?: Printer[]; error?: string };
      if (!Array.isArray(data.printers)) throw new Error(data.error || "Respuesta inválida del Agent.");
      setPrinters(data.printers);
    } catch {
      setAgentError(
        "No se pudo conectar con B-POS en esta computadora. Abre esta pantalla en la caja donde está instalado B-POS."
      );
    }

    setLoading(false);
  }

  async function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    try {
      // El Agent también la guarda: con ella imprime el ticket original y el respaldo a Cocina
      await syncStationPrinters(toStationPrintersConfig(config));
      alert("Configuración guardada.");
    } catch {
      alert("Se guardó en B-POS, pero el Agent de esta computadora no respondió. Ábrela en la caja para que se aplique.");
    }
  }

  return (
    <AppShell
      title="Impresoras"
      subtitle="Asigna la impresora física para cada estación."
    >
      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-8">

        <p className="text-sm text-zinc-400">
          Los pedidos de delivery (Rappi, Uber Eats, DiDi Food) imprimen un <b className="text-zinc-200">ticket de Burger Planet</b> en
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

              <select
                value={config[station]}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    [station]: e.target.value,
                  })
                }
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-3"
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
