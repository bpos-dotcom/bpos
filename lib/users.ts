"use client";
import type { UserRole } from "@/lib/auth";
import { hashPin, verifyPin } from "@/lib/pin-hash";

export type SystemUser = {
  id: number;
  name: string;
  /** Solo en datos viejos: se convierte a pinHash y se borra (ver migrateUserPins) */
  pin?: string;
  pinHash?: string;
  role: UserRole;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
};

export const USERS_KEY = "bpos_users";
// El PIN de fábrica (1234) se cifra en cuanto B-POS abre por primera vez
export const DEFAULT_USERS: SystemUser[] = [
  { id: 1, name: "Gerardo", pin: "1234", role: "Admin", active: true, createdAt: new Date(0).toISOString() },
];

export function getUsers(): SystemUser[] {
  if (typeof window === "undefined") return DEFAULT_USERS;
  try {
    const raw = localStorage.getItem(USERS_KEY);
    const users = raw ? JSON.parse(raw) : DEFAULT_USERS;
    if (!raw) localStorage.setItem(USERS_KEY, JSON.stringify(DEFAULT_USERS));
    return Array.isArray(users) ? users : DEFAULT_USERS;
  } catch { return DEFAULT_USERS; }
}

export function saveUsers(users: SystemUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  window.dispatchEvent(new Event("bpos:users-updated"));
}

/** Usuario con el PIN indicado ya convertido a hash (sin el PIN en texto). */
export async function withPin<T extends SystemUser>(user: T, pin: string): Promise<T> {
  const next = { ...user, pinHash: await hashPin(pin) };
  delete next.pin;
  return next;
}

let migrating: Promise<void> | null = null;

/** Convierte los PIN guardados en texto a hash (una vez; se sincroniza ya cifrado). */
export function migrateUserPins() {
  if (typeof window === "undefined") return Promise.resolve();
  if (!migrating) {
    migrating = (async () => {
      const before = localStorage.getItem(USERS_KEY);
      const users = getUsers();
      if (!users.some((u) => typeof u.pin === "string" && u.pin)) return;
      const next = await Promise.all(users.map((u) => (u.pin ? withPin(u, u.pin) : Promise.resolve(u))));
      // Si mientras se cifraba alguien cambió los usuarios, se deja para la siguiente vez
      if (localStorage.getItem(USERS_KEY) === before) saveUsers(next);
    })().finally(() => {
      migrating = null;
    });
  }
  return migrating;
}

export async function findActiveAdminByPin(pin: string) {
  for (const u of getUsers()) {
    if (u.active && u.role === "Admin" && (await verifyPin(pin, u))) return u;
  }
  return null;
}
