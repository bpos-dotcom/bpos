export type KitchenStation =
  | "Parrilla"
  | "Freidora"
  | "Barra"
  | "Cocina";

export const products = [
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

export type Product = (typeof products)[number];