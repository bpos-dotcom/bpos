import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { guardBridgeRequest } from "@/lib/bridge/api-guard";
import { BRIDGE_DATA_DIR } from "@/lib/bridge/data-dir";

/**
 * Respaldos automáticos guardados en la computadora de la caja
 * (BRIDGE_DATA_DIR/respaldos). Se conservan los últimos 30.
 *   POST            guarda el respaldo del día (lo manda la pantalla de B-POS)
 *   GET             lista los respaldos
 *   GET ?archivo=…  descarga uno
 */
export const dynamic = "force-dynamic";

const DIR = path.join(BRIDGE_DATA_DIR, "respaldos");
const KEEP = 30;
const NAME = /^respaldo-\d{4}-\d{2}-\d{2}\.json$/;

function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((n) => NAME.test(n))
    .sort()
    .reverse()
    .map((name) => ({ name, size: fs.statSync(path.join(DIR, name)).size }));
}

export async function GET(request: NextRequest) {
  const denied = await guardBridgeRequest(request);
  if (denied) return denied;

  const file = request.nextUrl.searchParams.get("archivo");
  if (file) {
    if (!NAME.test(file) || !fs.existsSync(path.join(DIR, file))) {
      return NextResponse.json({ success: false, error: "Respaldo no encontrado." }, { status: 404 });
    }
    return new NextResponse(fs.readFileSync(path.join(DIR, file)), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${file}"` },
    });
  }
  return NextResponse.json({ success: true, folder: DIR, backups: list() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const denied = await guardBridgeRequest(request);
  if (denied) return denied;

  try {
    const backup = (await request.json()) as { app?: string; version?: number; records?: unknown[]; createdAt?: string };
    if (backup?.app !== "B-POS" || !Array.isArray(backup.records)) {
      return NextResponse.json({ success: false, error: "Respaldo inválido." }, { status: 400 });
    }
    fs.mkdirSync(DIR, { recursive: true });
    const name = `respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    const tmp = path.join(DIR, `${name}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(backup));
    fs.renameSync(tmp, path.join(DIR, name));
    for (const old of list().slice(KEEP)) fs.rmSync(path.join(DIR, old.name), { force: true });
    return NextResponse.json({ success: true, name, records: backup.records.length });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "No se pudo guardar." }, { status: 500 });
  }
}
