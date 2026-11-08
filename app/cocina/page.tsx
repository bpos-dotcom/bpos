"use client";

import { PlanGate } from "@/components/cloud/PlanGate";
import { KitchenScreen } from "@/components/kitchen/KitchenScreen";

/** Cocina en pantalla: incluida en Pro y Max (la prueba gratis incluye todo) */
export default function CocinaPage() {
  return (
    <PlanGate feature="kds" title="Cocina KDS">
      <KitchenScreen />
    </PlanGate>
  );
}
