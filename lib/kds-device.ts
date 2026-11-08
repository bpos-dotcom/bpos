"use client";
/**
 * Tablets de cocina (bpos.com.mx/kds/<liga>): como los celulares de meseros
 * (lib/waiter.ts), se vinculan una vez con el código de Configuración →
 * Tablets de cocina y quedan como cuenta de dispositivo del negocio. Después
 * cada quien entra con su nombre y PIN (permiso "Ver Cocina KDS").
 */
import { hasPermission } from "@/lib/permissions";
import { getUsers, type SystemUser } from "@/lib/users";

const KDS_DEVICE_KEY = "bpos_kds_device";

export type KdsDevice = { deviceId: string; branchId: string; name: string; slug: string; linkedAt: string };

export function readKdsDevice(): KdsDevice | null {
  try {
    const raw = localStorage.getItem(KDS_DEVICE_KEY);
    const d = raw ? (JSON.parse(raw) as KdsDevice) : null;
    return d && typeof d.deviceId === "string" ? d : null;
  } catch {
    return null;
  }
}

export function saveKdsDevice(device: KdsDevice | null) {
  if (device) localStorage.setItem(KDS_DEVICE_KEY, JSON.stringify(device));
  else localStorage.removeItem(KDS_DEVICE_KEY);
}

/** Quién puede entrar a la cocina: usuarios activos con el permiso "Ver Cocina KDS" */
export function kitchenUsers(): SystemUser[] {
  return getUsers().filter((u) => u.active && hasPermission({ id: u.id, role: u.role }, "kds.view"));
}
