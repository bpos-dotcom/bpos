import type { OrderInterpretation } from "./interpret-order";
import type { FinalOrderValidation } from "./validate-order";
import { extractKdsTicketLines, type KdsTicketLine } from "./ticket-structure";

export type PreparedSaleProduct = {
  productId: string;
  name: string;
  quantity: number;
  externalName: string;
  aliasId: string;
  /** Renglón del ticket original (para leer solo las opciones de ese renglón) */
  sourceIndex?: number;
  /** Combo con equivalencia compuesta: elegir opciones con las sub-líneas del ticket */
  compound?: boolean;
};

export type PreparedInventoryAdjustment = {
  ingredientId: string;
  name: string;
  quantity: number;
  unit?: string;
  sourceType: "ingredient" | "bundle";
  externalName: string;
  aliasId: string;
};

export type PreparedIgnoredLine = {
  externalName: string;
  quantity: number;
  aliasId: string;
};

export type SaleReadyPayload = {
  version: 1;
  readyForSale: true;
  externalOrderKey: string;
  platform: string;
  externalOrderId: string;
  customer: {
    name: string | null;
    phone: string | null;
  };
  delivery: {
    address: string | null;
    type: string | null;
  };
  externalTotal: number;
  products: PreparedSaleProduct[];
  inventoryAdjustments: PreparedInventoryAdjustment[];
  ignoredLines: PreparedIgnoredLine[];
  source: "B-POS Bridge";
  rawText: string;
  kdsTicketLines: KdsTicketLine[];
  preparedAt: string;
};

function normalizePlatform(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeOrderId(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export function prepareSalePayload(input: {
  platform?: string;
  orderId?: string | null;
  customer?: { name?: string | null; phone?: string | null };
  delivery?: { address?: string | null; type?: string | null };
  total?: number;
  rawText?: string;
  interpretation?: OrderInterpretation;
  validation?: FinalOrderValidation;
}): SaleReadyPayload | null {
  const platform = normalizePlatform(input.platform);
  const externalOrderId = normalizeOrderId(input.orderId);
  const interpretation = input.interpretation;
  const validation = input.validation;

  if (
    !platform ||
    !externalOrderId ||
    !interpretation ||
    !validation?.readyForSale
  ) {
    return null;
  }

  return {
    version: 1,
    readyForSale: true,
    externalOrderKey: `${platform}:${externalOrderId}`,
    platform,
    externalOrderId,
    customer: {
      name: input.customer?.name ?? null,
      phone: input.customer?.phone ?? null,
    },
    delivery: {
      address: input.delivery?.address ?? null,
      type: input.delivery?.type ?? null,
    },
    externalTotal:
      Number.isFinite(Number(input.total)) && Number(input.total) >= 0
        ? Number(input.total)
        : 0,
    products: interpretation.products.map((product) => ({
      productId: product.productId,
      name: product.productName,
      quantity: product.quantity,
      externalName: product.externalName,
      aliasId: product.aliasId,
      sourceIndex: product.sourceIndex,
      ...(product.compound ? { compound: true } : {}),
    })),
    inventoryAdjustments: [
      ...interpretation.ingredients.map((ingredient) => ({
        ingredientId: ingredient.ingredientId,
        name: ingredient.ingredientName,
        quantity: ingredient.totalQuantity,
        unit: ingredient.unit,
        sourceType: "ingredient" as const,
        externalName: ingredient.externalName,
        aliasId: ingredient.aliasId,
      })),
      ...interpretation.bundles.flatMap((bundle) =>
        bundle.targets.map((target) => ({
          ingredientId: target.ingredientId,
          name: target.ingredientName,
          quantity: target.totalQuantity,
          unit: target.unit,
          sourceType: "bundle" as const,
          externalName: bundle.externalName,
          aliasId: bundle.aliasId,
        }))
      ),
    ],
    ignoredLines: interpretation.ignored.map((ignored) => ({
      externalName: ignored.externalName,
      quantity: ignored.sourceQuantity,
      aliasId: ignored.aliasId,
    })),
    source: "B-POS Bridge",
    rawText: String(input.rawText || ""),
    kdsTicketLines: extractKdsTicketLines(String(input.rawText || "")),
    preparedAt: new Date().toISOString(),
  };
}
