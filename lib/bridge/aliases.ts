import { Product } from "@/data/products";
import { getAdminProducts } from "@/lib/admin";

export type BridgeAlias = {
  id: number;
  externalName: string;
  productId: number;
  productName: string;
};

const BRIDGE_ALIASES_KEY = "bpos_bridge_aliases";

export function getBridgeAliases(): BridgeAlias[] {
  if (typeof window === "undefined") return [];

  const saved = localStorage.getItem(BRIDGE_ALIASES_KEY);
  return saved ? JSON.parse(saved) : [];
}

export function saveBridgeAliases(aliases: BridgeAlias[]) {
  localStorage.setItem(BRIDGE_ALIASES_KEY, JSON.stringify(aliases));
}

export function findBridgeAlias(externalName: string) {
  const cleanName = externalName.trim().toLowerCase();

  return getBridgeAliases().find(
    (alias) => alias.externalName.trim().toLowerCase() === cleanName
  );
}

export function getBridgeAliasProduct(externalName: string): Product | undefined {
  const alias = findBridgeAlias(externalName);

  if (!alias) return undefined;

  return getAdminProducts().find((product) => product.id === alias.productId);
}

export function addBridgeAlias(alias: Omit<BridgeAlias, "id">) {
  const aliases = getBridgeAliases();

  const newAlias: BridgeAlias = {
    id: Date.now(),
    ...alias,
  };

  saveBridgeAliases([...aliases, newAlias]);

  return newAlias;
}