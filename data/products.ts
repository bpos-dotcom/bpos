import type { SaleSchedule } from "@/lib/sale-schedule";
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

/**
 * Modificador: opción que no se vende sola ("Ranch: Sí / No, gracias /
 * Aparte", "Salsas a elegir"). Puede descontar un insumo. No tiene precio:
 * el grupo trae unas incluidas gratis y cobra solo las que pasen de ahí.
 */
export type ModifierOption = {
  key: string;
  name: string;
  /** Enlazada a un producto existente: descuenta su receta y sale en la comanda de su estación */
  productId?: number;
  ingredientId?: number;
  quantity?: number; // del insumo, por cada vez que se elige
};

export type ModifierGroup = {
  key: string;
  name: string; // "Aderezo", "Salsas"
  min: number; // 1 o más = obligatorio
  included: number; // cuántas van gratis
  extraPrice: number; // precio de cada una de más (0 = no se cobran)
  max: number; // tope total (0 = sin tope)
  options: ModifierOption[];
  /** Copiado de otro producto (la copia es independiente; `edited` cuando ya se cambió) */
  copiedFrom?: { productName: string; edited: boolean };
  /** Multidestino: estaciones extra que también ven lo elegido aquí (las salsas del boneless → Freidora) */
  stations?: KitchenStation[];
};

/** Multidestino: otra estación prepara una parte ("Boneless para Boneless Burger" en Freidora). */
export type ExtraStation = { station: KitchenStation; text: string };

export type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  emoji: string;
  station: KitchenStation;
  /** Antes (1.10): partes de un combo. Se convierten solas en opciones enlazadas (ver migrateComponents). */
  components?: ProductComponent[];
  /** Combo: no manda comanda propia, solo salen sus opciones enlazadas en sus estaciones */
  noOwnTicket?: boolean;
  /** Multidestino: además de su estación, estas preparan una parte (con su indicación) */
  extraStations?: ExtraStation[];
  /**
   * No se vende por separado: no aparece en el POS, pero sirve para enlazarlo
   * (parte de un combo, opción) o como equivalencia de un modificador de
   * DiDi/Uber/Rappi ("Ranch aparte"): descuenta su receta y va a su estación.
   */
  notSoldAlone?: boolean;
  /** Opciones a elegir al venderlo (aderezos, salsas, término...) */
  modifierGroups?: ModifierGroup[];
  /** Horario de venta en el POS (ej. promoción solo los viernes). Sin horario se vende siempre. */
  saleSchedule?: SaleSchedule;
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
