"use client";

import { AppShell } from "@/components/layout/AppShell";
import RequireRole from "@/components/auth/RequireRole";
import BridgeAliases from "@/app/bridge/BridgeAliases";

export default function DeliveryEquivalenciasPage() {
  return (
    <RequireRole allow={["Admin"]}>
      <AppShell
        title="Delivery: equivalencias guardadas"
        subtitle="Administra cómo se traducen las líneas de DiDi Food, Uber Eats, Rappi y futuras plataformas al catálogo real de B-POS."
      >
        <BridgeAliases showSavedAliases />
      </AppShell>
    </RequireRole>
  );
}
