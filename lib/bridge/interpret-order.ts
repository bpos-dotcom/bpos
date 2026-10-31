import { ticketLineParents } from "./ticket-lines";

export type AliasActionType = "product" | "ingredient" | "bundle" | "ignore";

export type AliasTarget = {
  id: string;
  name: string;
  quantity?: number;
  unit?: string;
};

export type BridgeAlias = {
  id: string;
  normalizedExternalName: string;
  externalName: string;
  platform?: string | null;
  actionType: AliasActionType;
  targets: AliasTarget[];
  /**
   * Equivalencia compuesta (solo "product"): el renglón es un combo del POS;
   * sus sub-líneas en el ticket eligen las opciones del combo y ya no
   * necesitan equivalencia propia. Sin esto, el producto se descuenta con su
   * receta tal cual y las sub-líneas van por su propia equivalencia.
   */
  compound?: boolean;
};

export type CatalogProduct = {
  id: string | number;
  name: string;
};

export type CatalogIngredient = {
  id: string | number;
  name: string;
  unit?: string;
};

export type QuantifiedSourceLine = {
  index: number;
  quantity: number;
  externalName: string;
  rawLine: string;
};

export type InterpretedProduct = {
  type: "product";
  aliasId: string;
  sourceIndex: number;
  externalName: string;
  sourceQuantity: number;
  productId: string;
  productName: string;
  quantity: number;
  /** Combo: leer sus sub-líneas para elegir opciones (ver BridgeAlias.compound) */
  compound?: boolean;
};

export type InterpretedIngredient = {
  type: "ingredient";
  aliasId: string;
  sourceIndex: number;
  externalName: string;
  sourceQuantity: number;
  ingredientId: string;
  ingredientName: string;
  quantityPerSelection: number;
  totalQuantity: number;
  unit?: string;
};

export type InterpretedBundleTarget = {
  ingredientId: string;
  ingredientName: string;
  quantityPerSelection: number;
  totalQuantity: number;
  unit?: string;
};

export type InterpretedBundle = {
  type: "bundle";
  aliasId: string;
  sourceIndex: number;
  externalName: string;
  sourceQuantity: number;
  targets: InterpretedBundleTarget[];
};

export type InterpretedIgnored = {
  type: "ignore";
  aliasId: string;
  sourceIndex: number;
  externalName: string;
  sourceQuantity: number;
  /** Sub-línea de un combo (equivalencia compuesta): la leyó el combo, no se interpreta aparte */
  reason?: "compound_option";
  /** Renglón del combo al que pertenece */
  parentIndex?: number;
};

export type PendingInterpretation = {
  sourceIndex: number;
  externalName: string;
  sourceQuantity: number;
  rawLine: string;
  reason: "missing_alias";
};

export type InterpretationError = {
  code:
    | "NO_QUANTIFIED_LINES"
    | "INVALID_ALIAS_TARGET"
    | "MISSING_CATALOG_PRODUCT"
    | "MISSING_CATALOG_INGREDIENT"
    | "INVALID_TARGET_QUANTITY";
  sourceIndex?: number;
  externalName?: string;
  aliasId?: string;
  message: string;
};

export type OrderInterpretation = {
  version: 1;
  platform: string;
  resolved: boolean;
  sourceLineCount: number;
  pendingCount: number;
  errorCount: number;
  products: InterpretedProduct[];
  ingredients: InterpretedIngredient[];
  bundles: InterpretedBundle[];
  ignored: InterpretedIgnored[];
  pending: PendingInterpretation[];
  errors: InterpretationError[];
  interpretedAt: string;
};

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

export function extractQuantifiedSourceLines(rawText: string): QuantifiedSourceLine[] {
  return String(rawText || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => Boolean(line))
    .map(({ line, index }) => {
      const match = line.match(/^\s*(\d{1,4})\s*[xX×]\s*(.+?)\s*$/);
      if (!match) return null;

      const quantity = Number(match[1]);
      const externalName = cleanExternalName(match[2]);

      if (!Number.isInteger(quantity) || quantity <= 0 || !externalName) {
        return null;
      }

      return {
        index,
        quantity,
        externalName,
        rawLine: line,
      } satisfies QuantifiedSourceLine;
    })
    .filter((item): item is QuantifiedSourceLine => Boolean(item));
}

function findAlias(
  aliases: BridgeAlias[],
  externalName: string,
  platform: string
): BridgeAlias | undefined {
  const normalizedName = normalize(externalName);
  const normalizedPlatform = normalize(platform);

  return (
    aliases.find(
      (alias) =>
        normalize(alias.normalizedExternalName || alias.externalName) ===
          normalizedName && normalize(alias.platform) === normalizedPlatform
    ) ||
    aliases.find(
      (alias) =>
        normalize(alias.normalizedExternalName || alias.externalName) ===
          normalizedName && !normalize(alias.platform)
    )
  );
}

function findCatalogEntry<T extends { id: string | number }>(
  entries: T[],
  id: string
): T | undefined {
  return entries.find((entry) => String(entry.id) === String(id));
}

function positiveQuantity(value: unknown): number | null {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

export function interpretOrder(input: {
  platform?: string;
  rawText?: string;
  aliases: BridgeAlias[];
  products: CatalogProduct[];
  ingredients: CatalogIngredient[];
}): OrderInterpretation {
  const platform = normalize(input.platform);
  const lines = extractQuantifiedSourceLines(input.rawText || "");
  const parents = ticketLineParents(input.rawText || "");

  const products: InterpretedProduct[] = [];
  const ingredients: InterpretedIngredient[] = [];
  const bundles: InterpretedBundle[] = [];
  const ignored: InterpretedIgnored[] = [];
  const pending: PendingInterpretation[] = [];
  const errors: InterpretationError[] = [];

  if (lines.length === 0) {
    errors.push({
      code: "NO_QUANTIFIED_LINES",
      message: "No se encontraron líneas con formato cantidad + x.",
    });
  }

  for (const line of lines) {
    // Sub-línea de un combo con equivalencia compuesta: la elige el combo
    // (hamburguesa, refresco...), así que no se interpreta ni se cobra aparte
    const parentIndex = parents.get(line.index);
    const parentCombo = parentIndex === undefined ? undefined : products.find((p) => p.sourceIndex === parentIndex && p.compound);
    if (parentCombo) {
      ignored.push({
        type: "ignore",
        aliasId: parentCombo.aliasId,
        sourceIndex: line.index,
        externalName: line.externalName,
        sourceQuantity: line.quantity,
        reason: "compound_option",
        parentIndex,
      });
      continue;
    }

    const alias = findAlias(input.aliases, line.externalName, platform);

    if (!alias) {
      pending.push({
        sourceIndex: line.index,
        externalName: line.externalName,
        sourceQuantity: line.quantity,
        rawLine: line.rawLine,
        reason: "missing_alias",
      });
      continue;
    }

    if (alias.actionType === "ignore") {
      ignored.push({
        type: "ignore",
        aliasId: alias.id,
        sourceIndex: line.index,
        externalName: line.externalName,
        sourceQuantity: line.quantity,
      });
      continue;
    }

    if (!Array.isArray(alias.targets) || alias.targets.length === 0) {
      errors.push({
        code: "INVALID_ALIAS_TARGET",
        sourceIndex: line.index,
        externalName: line.externalName,
        aliasId: alias.id,
        message: "La equivalencia no tiene destinos configurados.",
      });
      continue;
    }

    if (alias.actionType === "product") {
      const target = alias.targets[0];
      const product = findCatalogEntry(input.products, target.id);

      if (!product) {
        errors.push({
          code: "MISSING_CATALOG_PRODUCT",
          sourceIndex: line.index,
          externalName: line.externalName,
          aliasId: alias.id,
          message: `El producto ${target.name || target.id} ya no existe en el catálogo.`,
        });
        continue;
      }

      products.push({
        type: "product",
        aliasId: alias.id,
        sourceIndex: line.index,
        externalName: line.externalName,
        sourceQuantity: line.quantity,
        productId: String(product.id),
        productName: product.name,
        quantity: line.quantity,
        ...(alias.compound ? { compound: true } : {}),
      });
      continue;
    }

    if (alias.actionType === "ingredient") {
      const target = alias.targets[0];
      const ingredient = findCatalogEntry(input.ingredients, target.id);
      const quantityPerSelection = positiveQuantity(target.quantity);

      if (!ingredient) {
        errors.push({
          code: "MISSING_CATALOG_INGREDIENT",
          sourceIndex: line.index,
          externalName: line.externalName,
          aliasId: alias.id,
          message: `El ingrediente ${target.name || target.id} ya no existe en el catálogo.`,
        });
        continue;
      }

      if (quantityPerSelection === null) {
        errors.push({
          code: "INVALID_TARGET_QUANTITY",
          sourceIndex: line.index,
          externalName: line.externalName,
          aliasId: alias.id,
          message: "La equivalencia de ingrediente necesita una cantidad mayor a cero.",
        });
        continue;
      }

      ingredients.push({
        type: "ingredient",
        aliasId: alias.id,
        sourceIndex: line.index,
        externalName: line.externalName,
        sourceQuantity: line.quantity,
        ingredientId: String(ingredient.id),
        ingredientName: ingredient.name,
        quantityPerSelection,
        totalQuantity: quantityPerSelection * line.quantity,
        unit: ingredient.unit || target.unit,
      });
      continue;
    }

    const bundleTargets: InterpretedBundleTarget[] = [];
    let bundleHasError = false;

    for (const target of alias.targets) {
      const ingredient = findCatalogEntry(input.ingredients, target.id);
      const quantityPerSelection = positiveQuantity(target.quantity);

      if (!ingredient) {
        bundleHasError = true;
        errors.push({
          code: "MISSING_CATALOG_INGREDIENT",
          sourceIndex: line.index,
          externalName: line.externalName,
          aliasId: alias.id,
          message: `El ingrediente ${target.name || target.id} ya no existe en el catálogo.`,
        });
        continue;
      }

      if (quantityPerSelection === null) {
        bundleHasError = true;
        errors.push({
          code: "INVALID_TARGET_QUANTITY",
          sourceIndex: line.index,
          externalName: line.externalName,
          aliasId: alias.id,
          message: `El ingrediente ${ingredient.name} necesita una cantidad mayor a cero.`,
        });
        continue;
      }

      bundleTargets.push({
        ingredientId: String(ingredient.id),
        ingredientName: ingredient.name,
        quantityPerSelection,
        totalQuantity: quantityPerSelection * line.quantity,
        unit: ingredient.unit || target.unit,
      });
    }

    if (!bundleHasError && bundleTargets.length > 0) {
      bundles.push({
        type: "bundle",
        aliasId: alias.id,
        sourceIndex: line.index,
        externalName: line.externalName,
        sourceQuantity: line.quantity,
        targets: bundleTargets,
      });
    }
  }

  return {
    version: 1,
    platform,
    resolved: lines.length > 0 && pending.length === 0 && errors.length === 0,
    sourceLineCount: lines.length,
    pendingCount: pending.length,
    errorCount: errors.length,
    products,
    ingredients,
    bundles,
    ignored,
    pending,
    errors,
    interpretedAt: new Date().toISOString(),
  };
}
