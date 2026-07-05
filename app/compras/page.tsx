"use client";

import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { adjustInventory } from "@/lib/inventory";
import { findAliasByTicketName, PurchaseAlias } from "@/lib/purchases";
import PurchaseAliases from "./PurchaseAliases";
import PurchaseForm from "./PurchaseForm";
import PurchaseHistory from "./PurchaseHistory";
import PurchasePhoto from "./PurchasePhoto";

type DetectedLine = {
  originalLine: string;
  cleanName: string;
  multiplier: number;
  alias?: PurchaseAlias;
  status: "Encontrado" | "Sin equivalencia";
};

function parseTicketLine(line: string) {
  const cleanLine = line.trim();

  const match = cleanLine.match(/^(\d+)\s*x?\s+(.+)$/i);

  if (!match) {
    return {
      multiplier: 1,
      cleanName: cleanLine,
    };
  }

  return {
    multiplier: Number(match[1]),
    cleanName: match[2].trim(),
  };
}

export default function ComprasPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [detectedLines, setDetectedLines] = useState<DetectedLine[]>([]);

  function refreshPurchases() {
    setRefreshKey((current) => current + 1);
  }

  function processLines(lines: string[]) {
    const detected = lines.map((line) => {
      const parsed = parseTicketLine(line);
      const alias = findAliasByTicketName(parsed.cleanName);

      return {
        originalLine: line,
        cleanName: parsed.cleanName,
        multiplier: parsed.multiplier,
        alias,
        status: alias ? "Encontrado" : "Sin equivalencia",
      } as DetectedLine;
    });

    setDetectedLines(detected);
  }

  function applyDetectedPurchases() {
    const matched = detectedLines.filter((line) => line.alias);

    if (matched.length === 0) {
      alert("No hay productos con equivalencia para aplicar.");
      return;
    }

    matched.forEach((line) => {
      if (!line.alias) return;

      adjustInventory({
        ingredientId: line.alias.ingredientId,
        quantity: line.alias.quantity * line.multiplier,
        adjustmentType: "Ajuste positivo",
        reason: `Compra inteligente · Ticket: ${line.originalLine}`,
      });
    });

    setDetectedLines([]);
    refreshPurchases();

    alert("Inventario actualizado desde ticket.");
  }

  return (
    <AppShell
      title="Compras Inteligentes"
      subtitle="Foto, equivalencias, multiplicadores e inventario automático."
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_1fr]">
        <div className="space-y-6">
          <PurchasePhoto onLinesDetected={processLines} />
          <PurchaseAliases />
        </div>

        <div className="space-y-6">
          {detectedLines.length > 0 && (
            <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
              <h2 className="text-xl font-black text-orange-500">
                Productos detectados
              </h2>

              <p className="mt-2 text-sm text-zinc-400">
                Revisa las equivalencias encontradas antes de actualizar el
                inventario.
              </p>

              <div className="mt-6 space-y-3">
                {detectedLines.map((line) => (
                  <div
                    key={line.originalLine}
                    className="rounded-2xl border border-zinc-800 bg-black p-4"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-black">{line.originalLine}</p>

                        <p className="mt-1 text-xs text-zinc-500">
                          Cantidad detectada: {line.multiplier} · Producto:{" "}
                          {line.cleanName}
                        </p>

                        {line.alias ? (
                          <p className="mt-1 text-sm text-zinc-400">
                            → {line.alias.ingredientName} · +
                            {line.alias.quantity * line.multiplier}{" "}
                            {line.alias.unit}
                          </p>
                        ) : (
                          <p className="mt-1 text-sm text-red-400">
                            Sin equivalencia configurada
                          </p>
                        )}
                      </div>

                      <span
                        className={`rounded-xl px-3 py-1 text-xs font-black ${
                          line.alias
                            ? "bg-green-500/10 text-green-400"
                            : "bg-red-500/10 text-red-400"
                        }`}
                      >
                        {line.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={applyDetectedPurchases}
                className="mt-6 w-full rounded-2xl bg-orange-500 py-3 font-black text-black"
              >
                Aplicar productos detectados al inventario
              </button>
            </section>
          )}

          <PurchaseForm onPurchaseCreated={refreshPurchases} />

          <div key={refreshKey}>
            <PurchaseHistory />
          </div>
        </div>
      </div>
    </AppShell>
  );
}