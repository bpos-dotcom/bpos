"use client";
import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { getInventory } from "@/lib/inventory";
import { addPurchaseAlias, type PurchaseSuggestion } from "@/lib/purchases";
import PurchaseAiCapture, { type AiPurchaseResult } from "./PurchaseAiCapture";
import PurchaseAliases from "./PurchaseAliases";
import PurchaseForm, { type PurchasePrefill } from "./PurchaseForm";
import PurchaseHistory from "./PurchaseHistory";
import PurchaseSuggestions from "./PurchaseSuggestions";
import SuppliersPanel from "./SuppliersPanel";

type Tab = "nueva" | "foto" | "sugerencias" | "proveedores" | "equivalencias";

const TABS: { id: Tab; label: string }[] = [
  { id: "nueva", label: "🧾 Nueva compra" },
  { id: "foto", label: "📸 Foto de ticket" },
  { id: "sugerencias", label: "🧠 Sugerencias" },
  { id: "proveedores", label: "🏪 Proveedores" },
  { id: "equivalencias", label: "🔗 Equivalencias" },
];

export default function ComprasPage() {
  const [tab, setTab] = useState<Tab>("nueva");
  const [refreshKey, setRefreshKey] = useState(0);
  const [prefill, setPrefill] = useState<PurchasePrefill | null>(null);

  const refresh = () => setRefreshKey((x) => x + 1);

  /** Ticket leído con IA (plan Max): aprende las equivalencias y llena la compra. */
  function fromAi(result: AiPurchaseResult) {
    const inventory = getInventory();
    result.lines.forEach((line) => {
      const ingredient = inventory.find((i) => i.id === line.ingredientId);
      if (!ingredient || !(line.presentations > 0)) return;
      try {
        addPurchaseAlias({
          ticketName: line.ticketName,
          supplier: result.supplier || undefined,
          ingredientId: ingredient.id,
          ingredientName: ingredient.name,
          quantity: line.inventoryQuantity / line.presentations,
          unit: ingredient.unit,
        });
      } catch {
        // una línea sin datos suficientes no debe frenar la compra
      }
    });

    setPrefill({
      key: Date.now(),
      supplier: result.supplier,
      invoice: result.invoice,
      source: "ocr",
      imageName: result.imageName,
      lines: result.lines,
    });
    setTab("nueva");
  }

  function fromSuggestions(items: PurchaseSuggestion[]) {
    const counts = new Map<string, number>();
    items.forEach((i) => i.lastSupplier && counts.set(i.lastSupplier, (counts.get(i.lastSupplier) || 0) + 1));
    const supplier = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    setPrefill({
      key: Date.now(),
      supplier,
      source: "shopping-list",
      lines: items.map((i) => ({
        ingredientId: i.ingredientId,
        ticketName: i.ingredientName,
        presentations: 1,
        inventoryQuantity: i.suggestedQuantity,
        lineTotal: i.estimatedCost ? Math.round(i.estimatedCost * 100) / 100 : 0,
      })),
    });
    setTab("nueva");
  }

  return (
    <AppShell title="Compras" subtitle="Ticket con foto → Equivalencias → Inventario → Kardex → Costos">
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-2xl border px-4 py-3 text-sm font-black ${
                tab === t.id ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-orange-500"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "nueva" && <PurchaseForm prefill={prefill} onPurchaseCreated={() => { setPrefill(null); refresh(); }} />}

        {tab === "foto" && <PurchaseAiCapture onReady={fromAi} onManual={() => setTab("nueva")} />}

        {tab === "sugerencias" && <PurchaseSuggestions onUse={fromSuggestions} />}
        {tab === "proveedores" && <SuppliersPanel />}
        {tab === "equivalencias" && <PurchaseAliases />}

        <div key={refreshKey}>
          <PurchaseHistory />
        </div>
      </div>
    </AppShell>
  );
}
