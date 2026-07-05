import { Ingredient } from "@/data/inventory";

export type PurchaseAlias = {
  id: number;
  ticketName: string;
  ingredientId: number;
  ingredientName: string;
  quantity: number;
  unit: Ingredient["unit"];
};

const PURCHASE_ALIASES_KEY = "bpos_purchase_aliases";

export function getPurchaseAliases(): PurchaseAlias[] {
  if (typeof window === "undefined") return [];

  const savedAliases = localStorage.getItem(PURCHASE_ALIASES_KEY);

  return savedAliases ? JSON.parse(savedAliases) : [];
}

export function savePurchaseAliases(aliases: PurchaseAlias[]) {
  localStorage.setItem(PURCHASE_ALIASES_KEY, JSON.stringify(aliases));
}

export function addPurchaseAlias(alias: Omit<PurchaseAlias, "id">) {
  const aliases = getPurchaseAliases();

  const newAlias: PurchaseAlias = {
    id: Date.now(),
    ...alias,
  };

  savePurchaseAliases([...aliases, newAlias]);

  return newAlias;
}

export function findAliasByTicketName(ticketName: string) {
  const aliases = getPurchaseAliases();

  return aliases.find(
    (alias) =>
      alias.ticketName.trim().toLowerCase() === ticketName.trim().toLowerCase()
  );
}