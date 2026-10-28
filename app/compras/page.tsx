"use client";
import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { getInventory } from "@/lib/inventory";
import { addPurchaseAlias, type PurchaseSuggestion } from "@/lib/purchases";
import { blocksToPurchaseDraft, ticketProductName, type TicketTrainingBlock } from "@/lib/purchase-ticket-training";
import PurchaseAliases from "./PurchaseAliases";
import PurchaseForm, { type PurchasePrefill } from "./PurchaseForm";
import PurchaseHistory from "./PurchaseHistory";
import PurchasePhoto from "./PurchasePhoto";
import PurchaseSuggestions from "./PurchaseSuggestions";
import SuppliersPanel from "./SuppliersPanel";
import TicketTrainer from "./TicketTrainer";

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
  const [ocr, setOcr] = useState<{ key: number; text: string; imageName?: string } | null>(null);
  const [ocrSupplier, setOcrSupplier] = useState("");

  const refresh = () => setRefreshKey((x) => x + 1);

  function fromTicket(blocks: TicketTrainingBlock[]) {
    const draft = blocksToPurchaseDraft(blocks);
    const supplier = ocrSupplier.trim() || draft.supplier || "";

    if (draft.lines.length === 0) {
      alert("Marca al menos una línea como 📦 Producto y relaciónala con un ingrediente.");
      return;
    }

    // Aprender: la próxima vez estas líneas se reconocen solas
    const inventory = getInventory();
    blocks
      .filter((b) => b.role === "product" && b.ingredientId && b.inventoryPerUnit && b.inventoryPerUnit > 0)
      .forEach((b) => {
        try {
          addPurchaseAlias({
            ticketName: ticketProductName(b.text) || b.text,
            supplier: supplier || undefined,
            ingredientId: b.ingredientId!,
            ingredientName: b.ingredientName || "",
            quantity: b.inventoryPerUnit!,
            unit: inventory.find((i) => i.id === b.ingredientId)?.unit ?? "pza",
          });
        } catch {
          // una línea sin datos suficientes no debe frenar la compra
        }
      });

    setPrefill({
      key: Date.now(),
      supplier,
      invoice: draft.invoice,
      source: "ocr",
      ocrText: ocr?.text,
      imageName: ocr?.imageName,
      lines: draft.lines,
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

        {tab === "foto" && (
          <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
            <div className="space-y-4">
              <PurchasePhoto onTextDetected={(text, imageName) => setOcr({ key: Date.now(), text, imageName })} />
              <input
                value={ocrSupplier}
                onChange={(e) => setOcrSupplier(e.target.value)}
                placeholder="Proveedor del ticket (ayuda a reconocer los artículos)"
                className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3"
              />
            </div>
            {ocr ? (
              <TicketTrainer key={ocr.key} text={ocr.text} supplier={ocrSupplier} onSupplier={setOcrSupplier} onReady={(blocks) => fromTicket(blocks)} />
            ) : (
              <section className="flex items-center justify-center rounded-3xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">
                Toma la foto del ticket y presiona “Leer ticket”. Aquí vas a revisar cada línea; lo que ya tenga
                equivalencia se reconoce solo.
              </section>
            )}
          </div>
        )}

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
