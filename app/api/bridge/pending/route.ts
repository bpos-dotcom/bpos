import { NextResponse, type NextRequest } from "next/server";
import { guardBridgeRequest } from "@/lib/bridge/api-guard";
import { BRIDGE_DATA_DIR } from "@/lib/bridge/data-dir";
import { bridgeOrders } from "@/lib/bridge/orders-store";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AliasActionType = "product" | "ingredient" | "bundle" | "ignore";

type BridgeAlias = {
  id: string;
  normalizedExternalName: string;
  externalName: string;
  platform?: string | null;
  actionType: AliasActionType;
};

type BridgeOrder = {
  orderId?: string | null;
  platform?: string;
  rawText?: string;
  status?: string;
  [key: string]: unknown;
};


const DATA_FILE = path.join(BRIDGE_DATA_DIR, "bridge-aliases.json");

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanExternalName(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(
      /\s+(?:MX\$|\$)\s*-?\d[\d,]*(?:\.\d{1,2})?\s*(?:MXN)?\s*$/i,
      ""
    )
    .trim();
}

function extractQuantifiedItems(rawText: string) {
  return String(rawText || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\s*(\d{1,4})\s*[xX×]\s*(.+?)\s*$/);
      if (!match) return null;
      const qty = Number(match[1]);
      const externalName = cleanExternalName(match[2]);
      if (!Number.isInteger(qty) || qty <= 0 || !externalName) return null;
      return { qty, externalName, rawLine: line };
    })
    .filter(
      (item): item is { qty: number; externalName: string; rawLine: string } =>
        Boolean(item)
    );
}

function readAliases(): BridgeAlias[] {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as {
      aliases?: BridgeAlias[];
    };
    return Array.isArray(parsed.aliases) ? parsed.aliases : [];
  } catch {
    return [];
  }
}

function findAlias(
  aliases: BridgeAlias[],
  externalName: string,
  platform: string
) {
  const normalizedName = normalize(externalName);
  const normalizedPlatform = normalize(platform);

  return (
    aliases.find(
      (alias) =>
        alias.normalizedExternalName === normalizedName &&
        normalize(alias.platform) === normalizedPlatform
    ) ||
    aliases.find(
      (alias) =>
        alias.normalizedExternalName === normalizedName && !alias.platform
    )
  );
}

export async function GET(request: NextRequest) {
  const denied = await guardBridgeRequest(request);
  if (denied) return denied;

  const aliases = readAliases();
  const orders = bridgeOrders<BridgeOrder>();
  const pending: Array<{
    platform: string;
    orderId: string;
    externalName: string;
    rawLine: string;
  }> = [];

  for (const order of orders) {
    if (order.status === "Finalizado" || order.status === "Error") continue;

    const platform = normalize(order.platform);
    const orderId = String(order.orderId ?? "SIN-ID");
    const items = extractQuantifiedItems(String(order.rawText ?? ""));
    const unresolved = items.filter(
      (item) => !findAlias(aliases, item.externalName, platform)
    );

    for (const item of unresolved) {
      pending.push({
        platform,
        orderId,
        externalName: item.externalName,
        rawLine: item.rawLine,
      });
    }

    // Este endpoint solo calcula alertas pendientes.
    // El cambio Recibido -> Interpretado pertenece al Motor 2.3 y se
    // realiza al guardar una OrderInterpretation resuelta en /orders.
  }

  const unique = Array.from(
    new Map(
      pending.map((item) => [
        `${item.platform}|${normalize(item.externalName)}`,
        item,
      ])
    ).values()
  );

  const signature = unique
    .map((item) => `${item.platform}:${normalize(item.externalName)}`)
    .sort()
    .join("|");

  return NextResponse.json(
    {
      success: true,
      count: unique.length,
      pending: unique,
      signature,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
