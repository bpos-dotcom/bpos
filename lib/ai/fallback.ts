// lib/ai/fallback.ts

import { extractBridgeItemsFromText } from "@/lib/bridge/parser";
import { AIParsedTicket } from "@/lib/ai/schemas";

export function fallbackParseTicket(ticketText: string): AIParsedTicket {
  const items = extractBridgeItemsFromText(ticketText);

  return {
    platform: detectPlatform(ticketText),
    orderNumber: detectOrderNumber(ticketText),
    confidence: 0.5,
    generalNotes: "Interpretado con parser local, sin IA.",
    items: items.map((item) => ({
      originalName: item.cleanName,
      normalizedName: item.cleanName,
      quantity: item.quantity,
    })),
  };
}

function detectPlatform(text: string): AIParsedTicket["platform"] {
  const clean = text.toLowerCase();

  if (clean.includes("didi")) return "Didi Food";
  if (clean.includes("uber")) return "Uber Eats";
  if (clean.includes("rappi")) return "Rappi";

  return "Otro";
}

function detectOrderNumber(text: string) {
  const match = text.match(/pedido\s*#?\s*([a-z0-9-]+)/i);

  return match ? match[1] : `LOCAL-${Date.now()}`;
}