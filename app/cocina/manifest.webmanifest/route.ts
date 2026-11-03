import { KITCHEN_APP, manifestResponse } from "@/lib/app-manifest";

/** Cocina (KDS) instalable en la tablet de cada estación: abre siempre en /cocina. */
export const dynamic = "force-static";

export function GET() {
  return manifestResponse(KITCHEN_APP);
}
