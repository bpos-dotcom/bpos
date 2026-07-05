export type Ingredient = {
  id: number;
  name: string;
  unit: "pza" | "g" | "ml";
  stock: number;
  minimum: number;
};

export const initialIngredients: Ingredient[] = [
  { id: 1, name: "Pan brioche", unit: "pza", stock: 60, minimum: 15 },
  { id: 2, name: "Carne smash", unit: "g", stock: 12000, minimum: 3000 },
  { id: 3, name: "Queso amarillo", unit: "pza", stock: 80, minimum: 20 },
  { id: 4, name: "Alitas", unit: "pza", stock: 180, minimum: 36 },
  { id: 5, name: "Papas", unit: "g", stock: 10000, minimum: 2000 },
  { id: 6, name: "Salsa", unit: "ml", stock: 4000, minimum: 800 },
  { id: 7, name: "Refresco", unit: "pza", stock: 50, minimum: 12 },
];

export type RecipeItem = {
  productId: number;
  ingredientId: number;
  quantity: number;
};

export const recipes: RecipeItem[] = [
  { productId: 1, ingredientId: 1, quantity: 1 },
  { productId: 1, ingredientId: 2, quantity: 150 },
  { productId: 1, ingredientId: 3, quantity: 1 },

  { productId: 2, ingredientId: 1, quantity: 1 },
  { productId: 2, ingredientId: 2, quantity: 300 },
  { productId: 2, ingredientId: 3, quantity: 2 },

  { productId: 3, ingredientId: 4, quantity: 6 },
  { productId: 3, ingredientId: 6, quantity: 60 },

  { productId: 4, ingredientId: 4, quantity: 12 },
  { productId: 4, ingredientId: 6, quantity: 120 },

  { productId: 5, ingredientId: 1, quantity: 1 },
  { productId: 5, ingredientId: 2, quantity: 150 },
  { productId: 5, ingredientId: 3, quantity: 1 },
  { productId: 5, ingredientId: 5, quantity: 150 },

  { productId: 6, ingredientId: 7, quantity: 1 },
];
