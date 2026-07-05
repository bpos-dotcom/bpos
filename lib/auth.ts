export type UserRole = "Cajero" | "Gerente" | "Admin";

export type CurrentUser = {
  id: number;
  name: string;
  role: UserRole;
};

const USER_KEY = "bpos_current_user";

const defaultUser: CurrentUser = {
  id: 1,
  name: "Gerardo",
  role: "Admin",
};

export function getCurrentUser(): CurrentUser {
  if (typeof window === "undefined") return defaultUser;

  const savedUser = localStorage.getItem(USER_KEY);

  if (!savedUser) {
    localStorage.setItem(USER_KEY, JSON.stringify(defaultUser));
    return defaultUser;
  }

  return JSON.parse(savedUser);
}

export function setCurrentUser(user: CurrentUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function canViewCosts(role: UserRole) {
  return role === "Admin";
}

export function canManageSettings(role: UserRole) {
  return role === "Admin";
}

export function canManageCash(role: UserRole) {
  return role === "Admin" || role === "Gerente";
}

export function canManageInventory(role: UserRole) {
  return role === "Admin" || role === "Gerente";
}