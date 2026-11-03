import type { MetadataRoute } from "next";
import { appManifest, POS_APP } from "@/lib/app-manifest";

// B-POS (punto de venta) instalable en PC, tablet o celular. Abre en /inicio:
// el POS para quien vende, o la primera pantalla permitida (lib/permissions homePathFor).
// La App del dueño, Cocina y Meseros tienen su propio manifest (lib/app-manifest.ts).
export default function manifest(): MetadataRoute.Manifest {
  return appManifest(POS_APP);
}
