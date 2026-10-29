export type KitchenStation =
  | "Parrilla"
  | "Freidora"
  | "Barra"
  | "Cocina";

/**
 * Parte de un producto compuesto (combo). Con una sola opción es fija
 * ("1 Hamburguesa Original"); con varias, la cajera elige al cobrar
 * ("Refresco: Coca, Sprite o Manzanita").
 */
export type ProductComponent = {
  key: string;
  label: string; // "Hamburguesa", "Refresco"...
  quantity: number;
  options: number[]; // ids de productos (no compuestos)
};

export type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  emoji: string;
  station: KitchenStation;
  /** Si tiene partes es un producto compuesto: cada parte va a su estación y descuenta su receta */
  components?: ProductComponent[];
};

export const products: Product[] = [
  {
    id: 1,
    name: "Burger Planet Clásica",
    category: "Burgers",
    price: 115,
    emoji: "🍔",
    station: "Parrilla" as KitchenStation,
  },
  {
    id: 2,
    name: "Burger Doble",
    category: "Burgers",
    price: 149,
    emoji: "🍔",
    station: "Parrilla" as KitchenStation,
  },
  {
    id: 3,
    name: "Alitas 6 pzas",
    category: "Alitas",
    price: 129,
    emoji: "🍗",
    station: "Freidora" as KitchenStation,
  },
  {
    id: 4,
    name: "Alitas 12 pzas",
    category: "Alitas",
    price: 229,
    emoji: "🍗",
    station: "Freidora" as KitchenStation,
  },
  {
    id: 5,
    name: "Combo Burger + Papas",
    category: "Combos",
    price: 159,
    emoji: "🍟",
    station: "Cocina" as KitchenStation,
  },
  {
    id: 6,
    name: "Refresco",
    category: "Bebidas",
    price: 35,
    emoji: "🥤",
    station: "Barra" as KitchenStation,
  },
];
