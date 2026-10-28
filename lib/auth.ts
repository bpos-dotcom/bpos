export type UserRole = "Cajero" | "Gerente" | "Admin" | "Cocina" | "Inventario" | "Consulta";

export type CurrentUser = { id: number; name: string; role: UserRole; };
const USER_KEY = "bpos_current_user";
const ROLES: UserRole[] = ["Cajero", "Gerente", "Admin", "Cocina", "Inventario", "Consulta"];
/** Usuario sin sesión: id 0, sin ningún permiso (ver hasPermission). */
export const GUEST_USER: CurrentUser = { id: 0, name: "Sin sesión", role: "Consulta" };

/** Usuario que inició sesión con PIN en este dispositivo, o null si no hay nadie. */
export function getSessionUser(): CurrentUser | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = JSON.parse(localStorage.getItem(USER_KEY) || "null");
    if (!saved || typeof saved.id !== "number" || saved.id <= 0 || typeof saved.name !== "string" || !ROLES.includes(saved.role)) return null;
    return { id: saved.id, name: saved.name, role: saved.role };
  } catch { return null; }
}
export function getCurrentUser(): CurrentUser { return getSessionUser() ?? GUEST_USER; }
/** Manda a la pantalla de PIN y regresa a la página actual después de entrar. */
export function redirectToLogin() {
  const next = window.location.pathname + window.location.search;
  window.location.replace(`/login?next=${encodeURIComponent(next)}`);
}
export function setCurrentUser(user: CurrentUser) { localStorage.setItem(USER_KEY, JSON.stringify(user)); window.dispatchEvent(new Event("bpos:user-changed")); }
export function clearCurrentUser(){ localStorage.removeItem(USER_KEY); window.dispatchEvent(new Event("bpos:user-changed")); }
export function canViewCosts(role: UserRole){return role==="Admin";}
export function canManageSettings(role: UserRole){return role==="Admin";}
export function canManageCash(role: UserRole){return role==="Admin"||role==="Gerente";}
export function canManageInventory(role: UserRole){return role==="Admin"||role==="Gerente"||role==="Inventario";}
