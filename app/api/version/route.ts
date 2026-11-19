import { NextResponse } from "next/server";
import pkg from "@/package.json";

export const dynamic = "force-dynamic";

/** Bloque 13 · Versión que está corriendo (la app de escritorio la revisa al arrancar). */
export function GET() {
  return NextResponse.json(
    {
      name: "B-POS",
      version: process.env.BPOS_APP_VERSION || pkg.version,
      desktop: Boolean(process.env.BPOS_APP_VERSION),
      // Publicación (commit): las pantallas abiertas la comparan para saber si hay versión nueva
      build: process.env.BPOS_BUILD_SHA || "",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
