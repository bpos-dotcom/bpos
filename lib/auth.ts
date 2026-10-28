export type UserRole = "Cajero" | "Gerente" | "Admin" | "Cocina" | "Inventario" | "Consulta";

export type CurrentUser = { id: number; name: string; role: UserRole; };
const USER_KEY = "bpos_current_user";
const defaultUser: CurrentUser = { id: 1, name: "Gerardo", role: "Admin" };

export function getCurrentUser(): CurrentUser {
  if (typeof window === "undefined") return defaultUser;
  try {
    const saved = localStorage.getItem(USER_KEY);
    if (!saved) return defaultUser;
    return JSON.parse(saved);
  } catch { return defaultUser; }
}
export function setCurrentUser(user: CurrentUser) { localStorage.setItem(USER_KEY, JSON.stringify(user)); window.dispatchEvent(new Event("bpos:user-changed")); }
export function clearCurrentUser(){ localStorage.removeItem(USER_KEY); window.dispatchEvent(new Event("bpos:user-changed")); }
export function canViewCosts(role: UserRole){return role==="Admin";}
export function canManageSettings(role: UserRole){return role==="Admin";}
export function canManageCash(role: UserRole){return role==="Admin"||role==="Gerente";}
export function canManageInventory(role: UserRole){return role==="Admin"||role==="Gerente"||role==="Inventario";}
