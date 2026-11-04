"use client";
/**
 * Lo que se hace en este navegador justo después de crear un negocio nuevo
 * (registro o "Da de alta tu negocio"):
 *   - se borra cualquier dato de otro negocio abierto antes aquí,
 *   - el dueño queda como primer administrador con su nombre y su PIN
 *     (no uno de fábrica), ya con sesión en la caja,
 *   - nombre, dirección, correo y teléfono quedan en la configuración.
 * Catálogo, insumos y recetas empiezan vacíos (lib/admin.ts).
 */
import { setCurrentUser } from "@/lib/auth";
import { saveBusinessSettings, type BusinessSettings } from "@/lib/business-settings";
import { clearLocalBusinessData, resetDeviceSync } from "@/lib/cloud/sync";
import { saveUsers, withPin } from "@/lib/users";

export const PIN_RE = /^[0-9]{4,8}$/;

export async function startNewBusinessHere(input: { ownerName: string; pin: string; settings: Partial<BusinessSettings> }) {
  clearLocalBusinessData();
  resetDeviceSync();
  const owner = await withPin({ id: 1, name: input.ownerName.trim(), role: "Admin" as const, active: true, createdAt: new Date().toISOString() }, input.pin);
  saveUsers([owner]);
  setCurrentUser({ id: owner.id, name: owner.name, role: owner.role });
  saveBusinessSettings(input.settings);
}
