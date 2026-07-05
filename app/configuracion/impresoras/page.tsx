"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";

type Printer = {
  name: string;
  raw?: string;
};

const STATIONS = [
  "Parrilla",
  "Freidora",
  "Barra",
  "Cocina",
] as const;

type Station = (typeof STATIONS)[number];

const STORAGE_KEY = "bpos_station_printers";

export default function PrinterSettingsPage() {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(false);

  const [config, setConfig] = useState<Record<Station, string>>({
    Parrilla: "",
    Freidora: "",
    Barra: "",
    Cocina: "",
  });

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) {
      setConfig(JSON.parse(saved));
    }

    loadPrinters();
  }, []);

  async function loadPrinters() {
    setLoading(true);

    try {
      const response = await fetch("http://localhost:4850/printers");
      const data = await response.json();

      if (data.printers) {
  setPrinters(data.printers);
} else if (data.raw) {
  const parsedPrinters = data.raw
    .split("\n")
    .filter((line: string) => line.includes("usb://") || line.includes("Printer"))
    .map((line: string) => {
      const name =
        line.match(/dispositivo para (.*?):/)?.[1] ||
        line.match(/device for (.*?):/)?.[1] ||
        line.split(":")[0] ||
        line;

      return {
        name: name.trim(),
        raw: line,
      };
    });

  setPrinters(parsedPrinters);
}
    } catch {
      alert("No se pudo conectar con B-POS Local Service.");
    }

    setLoading(false);
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    alert("Configuración guardada.");
  }

  return (
    <AppShell
      title="Impresoras"
      subtitle="Asigna la impresora física para cada estación."
    >
      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-8">

        <button
          onClick={loadPrinters}
          className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black"
        >
          {loading ? "Buscando..." : "Buscar impresoras"}
        </button>

        <div className="mt-8 space-y-6">
          {STATIONS.map((station) => (
            <div
              key={station}
              className="rounded-2xl border border-zinc-800 bg-black p-5"
            >
              <p className="mb-3 text-lg font-black text-orange-500">
                {station}
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
                <option value="">Sin asignar</option>

                {printers.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
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