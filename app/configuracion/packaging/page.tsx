"use client";
import { SuppliesManager } from "@/components/inventory/SuppliesManager";

/** Tu negocio → Packaging: empaques (se descuentan por producto, no por receta) */
export default function PackagingPage() {
  return <SuppliesManager kind="packaging" />;
}
