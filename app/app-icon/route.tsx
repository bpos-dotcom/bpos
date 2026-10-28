import type { NextRequest } from "next/server";
import { appIcon } from "@/lib/app-icon";

// Íconos del manifest: /app-icon?size=192 y /app-icon?size=512
// "maskable" sin esquinas redondas: Android recorta la forma por su cuenta.
export function GET(request: NextRequest) {
  const size = Number(request.nextUrl.searchParams.get("size")) === 192 ? 192 : 512;
  const maskable = request.nextUrl.searchParams.get("maskable") === "1";
  return appIcon(size, { rounded: !maskable });
}
