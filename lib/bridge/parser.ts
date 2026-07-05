import { Product } from "@/data/products";
import { getAdminProducts } from "@/lib/admin";
import { getBridgeAliasProduct } from "@/lib/bridge/aliases";

export type ParsedBridgeItem = {
  originalLine: string;
  quantity: number;
  cleanName: string;
  product?: Product;
  matched: boolean;
  matchType: "catalog" | "alias" | "none";
};

export function normalizeBridgeText(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

export function parseBridgeLine(line: string) {
  const cleanLine = line.trim();
  const match = cleanLine.match(/^(\d+)\s*x?\s+(.+)$/i);

  if (!match) {
    return {
      quantity: 1,
      cleanName: cleanLine,
    };
  }

  return {
    quantity: Number(match[1]),
    cleanName: match[2].trim(),
  };
}

export function findBridgeProduct(name: string) {
  const products = getAdminProducts();
  const cleanName = normalizeBridgeText(name);

  const catalogMatch = products.find((product) => {
    const cleanProductName = normalizeBridgeText(product.name);

    return (
      cleanProductName === cleanName ||
      cleanProductName.includes(cleanName) ||
      cleanName.includes(cleanProductName)
    );
  });

  if (catalogMatch) {
    return {
      product: catalogMatch,
      matchType: "catalog" as const,
    };
  }

  const aliasMatch = getBridgeAliasProduct(name);

  if (aliasMatch) {
    return {
      product: aliasMatch,
      matchType: "alias" as const,
    };
  }

  return {
    product: undefined,
    matchType: "none" as const,
  };
}

export function parseBridgeTicketLines(lines: string[]): ParsedBridgeItem[] {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parsed = parseBridgeLine(line);
      const result = findBridgeProduct(parsed.cleanName);

      return {
        originalLine: line,
        quantity: parsed.quantity,
        cleanName: parsed.cleanName,
        product: result.product,
        matched: Boolean(result.product),
        matchType: result.matchType,
      };
    });
}

export function extractBridgeItemsFromText(rawText: string) {
  const ignoredWords = [
    "didi",
    "uber",
    "pedido",
    "notas",
    "sin",
    "enviar",
    "cliente",
    "food",
    "eats",
  ];

  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const clean = normalizeBridgeText(line);
      return !ignoredWords.some((word) => clean.startsWith(word));
    });

  return parseBridgeTicketLines(lines);
}