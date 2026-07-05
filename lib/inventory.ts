import { initialIngredients, Ingredient } from "@/data/inventory";
import { CartItem } from "@/components/CartPanel";
import { getAdminRecipes } from "@/lib/admin";

export type InventoryMovement = {
  id: number;
  createdAt: string;
  type: "Venta POS" | "Ajuste positivo" | "Ajuste negativo";
  orderId?: number;
  ingredientId: number;
  ingredientName: string;
  quantity: number;
  unit: Ingredient["unit"];
  reason?: string;
};

const INVENTORY_KEY = "bpos_inventory";
const KARDEX_KEY = "bpos_kardex";

export function getInventory(): Ingredient[] {
  if (typeof window === "undefined") return initialIngredients;

  const savedInventory = localStorage.getItem(INVENTORY_KEY);

  if (!savedInventory) {
    localStorage.setItem(INVENTORY_KEY, JSON.stringify(initialIngredients));
    return initialIngredients;
  }

  return JSON.parse(savedInventory);
}

export function saveInventory(inventory: Ingredient[]) {
  localStorage.setItem(INVENTORY_KEY, JSON.stringify(inventory));
}

export function getKardex(): InventoryMovement[] {
  if (typeof window === "undefined") return [];

  const savedKardex = localStorage.getItem(KARDEX_KEY);

  return savedKardex ? JSON.parse(savedKardex) : [];
}

export function saveKardex(movements: InventoryMovement[]) {
  localStorage.setItem(KARDEX_KEY, JSON.stringify(movements));
}

export function discountInventoryByOrder(orderId: number, items: CartItem[]) {
  const inventory = getInventory();
  const adminRecipes = getAdminRecipes();
  const movements: InventoryMovement[] = [];

  const nextInventory = inventory.map((ingredient) => {
    let totalToDiscount = 0;

    items.forEach((item) => {
      const recipeItems = adminRecipes.filter(
        (recipe) =>
          recipe.productId === item.id &&
          recipe.ingredientId === ingredient.id
      );

      recipeItems.forEach((recipe) => {
        totalToDiscount += recipe.quantity * item.quantity;
      });
    });

    if (totalToDiscount <= 0) return ingredient;

    movements.push({
      id: Date.now() + ingredient.id,
      createdAt: new Date().toISOString(),
      type: "Venta POS",
      orderId,
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      quantity: totalToDiscount,
      unit: ingredient.unit,
    });

    return {
      ...ingredient,
      stock: ingredient.stock - totalToDiscount,
    };
  });

  saveInventory(nextInventory);
  saveKardex([...getKardex(), ...movements]);
}

export function adjustInventory(params: {
  ingredientId: number;
  quantity: number;
  adjustmentType: "Ajuste positivo" | "Ajuste negativo";
  reason: string;
}) {
  const { ingredientId, quantity, adjustmentType, reason } = params;

  if (quantity <= 0) {
    throw new Error("La cantidad debe ser mayor a cero.");
  }

  if (reason.trim() === "") {
    throw new Error("El motivo del ajuste es obligatorio.");
  }

  const inventory = getInventory();
  const ingredient = inventory.find((item) => item.id === ingredientId);

  if (!ingredient) {
    throw new Error("Ingrediente no encontrado.");
  }

  const nextInventory = inventory.map((item) => {
    if (item.id !== ingredientId) return item;

    return {
      ...item,
      stock:
        adjustmentType === "Ajuste positivo"
          ? item.stock + quantity
          : item.stock - quantity,
    };
  });

  const movement: InventoryMovement = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    type: adjustmentType,
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    quantity,
    unit: ingredient.unit,
    reason,
  };

  saveInventory(nextInventory);
  saveKardex([...getKardex(), movement]);
}