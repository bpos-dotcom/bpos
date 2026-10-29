import { NextResponse } from "next/server";

/**
 * Descargar B-POS para Windows: lleva al instalador de la versión más nueva
 * publicada en GitHub (lee latest.yml para saber el nombre del archivo).
 */
export const dynamic = "force-dynamic";

const RELEASES = "https://github.com/bpos-dotcom/bpos/releases/latest";

export async function GET() {
  try {
    const response = await fetch(`${RELEASES}/download/latest.yml`, { cache: "no-store" });
    const text = await response.text();
    const file = text.match(/^path:\s*(\S+\.exe)\s*$/m)?.[1];
    if (response.ok && file) return NextResponse.redirect(`${RELEASES}/download/${encodeURIComponent(file)}`);
  } catch {
    // sin GitHub: se manda a la página de versiones
  }
  return NextResponse.redirect(RELEASES);
}
