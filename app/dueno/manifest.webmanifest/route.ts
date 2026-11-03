import { manifestResponse, OWNER_APP } from "@/lib/app-manifest";

/** App del dueño instalable: abre siempre en /dueno. */
export const dynamic = "force-static";

export function GET() {
  return manifestResponse(OWNER_APP);
}
