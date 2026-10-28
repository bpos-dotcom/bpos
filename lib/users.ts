"use client";
import type { UserRole } from "@/lib/auth";

export type SystemUser = {
  id: number;
  name: string;
  pin: string;
  role: UserRole;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
};

export const USERS_KEY = "bpos_users";
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

export function findActiveAdminByPin(pin: string) {
  return getUsers().find((u) => u.active && u.role === "Admin" && u.pin === pin) || null;
}
