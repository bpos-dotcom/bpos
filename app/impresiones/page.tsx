"use client";
/**
 * Impresiones ya vive en Historial de pedidos: ahí, Imprimir pregunta si
 * reimprimir y abre las opciones (estaciones, ticket del cliente, original).
 * Esta dirección se queda para los accesos viejos y manda al historial.
 */
import { useEffect } from "react";

export default function ImpresionesPage() {
  useEffect(() => {
    window.location.replace("/historial");
  }, []);
  return <p className="p-10 text-center text-zinc-400">Abriendo Historial de pedidos…</p>;
}
