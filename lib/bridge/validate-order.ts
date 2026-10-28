import type {
  CatalogIngredient,
  CatalogProduct,
  OrderInterpretation,
} from "./interpret-order";

export type ValidationIssueCode =
  | "MISSING_INTERPRETATION"
  | "INTERPRETATION_NOT_RESOLVED"
  | "PENDING_EQUIVALENCES"
  | "INTERPRETATION_ERRORS"
  | "NO_ACTIONABLE_LINES"
  | "PRODUCT_NOT_FOUND"
  | "INGREDIENT_NOT_FOUND"
  | "INVALID_PRODUCT_QUANTITY"
  | "INVALID_INGREDIENT_QUANTITY"
  | "EMPTY_BUNDLE";

export type ValidationIssue = {
  code: ValidationIssueCode;
  severity: "error";
  message: string;
  externalName?: string;
  targetId?: string;
};

export type FinalOrderValidation = {
  version: 1;
  valid: boolean;
  readyForSale: boolean;
  issueCount: number;
  issues: ValidationIssue[];
  checkedAt: string;
};

function hasPositiveQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0;
}

function hasCatalogId(
  entries: Array<{ id: string | number }>,
  id: string | number
) {
  return entries.some((entry) => String(entry.id) === String(id));
}

export function validateInterpretedOrder(input: {
  interpretation?: OrderInterpretation;
  products: CatalogProduct[];
  ingredients: CatalogIngredient[];
}): FinalOrderValidation {
  const issues: ValidationIssue[] = [];
  const interpretation = input.interpretation;

  if (!interpretation) {
    issues.push({
      code: "MISSING_INTERPRETATION",
      severity: "error",
      message: "El pedido todavía no tiene una interpretación generada.",
    });
  } else {
    if (!interpretation.resolved) {
      issues.push({
        code: "INTERPRETATION_NOT_RESOLVED",
        severity: "error",
        message: "El motor de interpretación todavía no ha resuelto el pedido.",
      });
    }

    if (interpretation.pendingCount > 0 || interpretation.pending.length > 0) {
      issues.push({
        code: "PENDING_EQUIVALENCES",
        severity: "error",
        message: `Quedan ${Math.max(
          interpretation.pendingCount,
          interpretation.pending.length
        )} equivalencia(s) pendientes.`,
      });
    }

    if (interpretation.errorCount > 0 || interpretation.errors.length > 0) {
      issues.push({
        code: "INTERPRETATION_ERRORS",
        severity: "error",
        message: `El motor reportó ${Math.max(
          interpretation.errorCount,
          interpretation.errors.length
        )} error(es) de interpretación.`,
      });
    }

    const actionableCount =
      interpretation.products.length +
      interpretation.ingredients.length +
      interpretation.bundles.length;

    if (actionableCount === 0) {
      issues.push({
        code: "NO_ACTIONABLE_LINES",
        severity: "error",
        message:
          "El pedido no contiene productos ni movimientos de inventario aplicables.",
      });
    }

    for (const product of interpretation.products) {
      if (!hasCatalogId(input.products, product.productId)) {
        issues.push({
          code: "PRODUCT_NOT_FOUND",
          severity: "error",
          externalName: product.externalName,
          targetId: product.productId,
          message: `El producto ${product.productName} ya no existe en el catálogo.`,
        });
      }

      if (!hasPositiveQuantity(product.quantity)) {
        issues.push({
          code: "INVALID_PRODUCT_QUANTITY",
          severity: "error",
          externalName: product.externalName,
          targetId: product.productId,
          message: `La cantidad del producto ${product.productName} debe ser mayor a cero.`,
        });
      }
    }

    for (const ingredient of interpretation.ingredients) {
      if (!hasCatalogId(input.ingredients, ingredient.ingredientId)) {
        issues.push({
          code: "INGREDIENT_NOT_FOUND",
          severity: "error",
          externalName: ingredient.externalName,
          targetId: ingredient.ingredientId,
          message: `El ingrediente ${ingredient.ingredientName} ya no existe en el catálogo.`,
        });
      }

      if (
        !hasPositiveQuantity(ingredient.quantityPerSelection) ||
        !hasPositiveQuantity(ingredient.totalQuantity)
      ) {
        issues.push({
          code: "INVALID_INGREDIENT_QUANTITY",
          severity: "error",
          externalName: ingredient.externalName,
          targetId: ingredient.ingredientId,
          message: `La cantidad del ingrediente ${ingredient.ingredientName} debe ser mayor a cero.`,
        });
      }
    }

    for (const bundle of interpretation.bundles) {
      if (bundle.targets.length === 0) {
        issues.push({
          code: "EMPTY_BUNDLE",
          severity: "error",
          externalName: bundle.externalName,
          message: `El grupo ${bundle.externalName} no contiene ingredientes.`,
        });
      }

      for (const target of bundle.targets) {
        if (!hasCatalogId(input.ingredients, target.ingredientId)) {
          issues.push({
            code: "INGREDIENT_NOT_FOUND",
            severity: "error",
            externalName: bundle.externalName,
            targetId: target.ingredientId,
            message: `El ingrediente ${target.ingredientName} del grupo ${bundle.externalName} ya no existe.`,
          });
        }

        if (
          !hasPositiveQuantity(target.quantityPerSelection) ||
          !hasPositiveQuantity(target.totalQuantity)
        ) {
          issues.push({
            code: "INVALID_INGREDIENT_QUANTITY",
            severity: "error",
            externalName: bundle.externalName,
            targetId: target.ingredientId,
            message: `La cantidad de ${target.ingredientName} en ${bundle.externalName} debe ser mayor a cero.`,
          });
        }
      }
    }
  }

  return {
    version: 1,
    valid: issues.length === 0,
    readyForSale: issues.length === 0,
    issueCount: issues.length,
    issues,
    checkedAt: new Date().toISOString(),
  };
}
