"use client";

import { useEffect } from "react";
import { isPrimaryDevice } from "@/lib/cloud/sync";
import { processUnappliedOrders } from "@/lib/inventory";

export function InventoryOrderProcessor() {
  useEffect(() => {
    // Con varios dispositivos en la nube, solo la caja principal descuenta
    // inventario para no hacerlo dos veces.
    const process = () => {
      if (isPrimaryDevice()) processUnappliedOrders();
    };
    process();
    window.addEventListener("bpos:orders-updated", process);
    window.addEventListener("storage", process);
    const timer = window.setInterval(process, 4000);
    return () => {
      window.removeEventListener("bpos:orders-updated", process);
      window.removeEventListener("storage", process);
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
