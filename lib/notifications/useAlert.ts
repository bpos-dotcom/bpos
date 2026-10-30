"use client";
/**
 * Hace sonar un aviso según Configuración → Notificaciones: al aparecer (o al
 * cambiar `key`, por ejemplo llega otro pedido) suena las veces configuradas
 * y, si así está, vuelve a sonar cada tantos segundos mientras siga sin
 * atenderse. Regresa la configuración del aviso (color, parpadeo).
 */
import { useEffect, useState } from "react";
import { DEFAULT_ALERTS, NOTIFICATION_SETTINGS_EVENT, getNotificationSettings, playAlert, type AlertKind, type AlertPref } from "./settings";

export function useAlertSettings() {
  const [settings, setSettings] = useState<Record<AlertKind, AlertPref>>(DEFAULT_ALERTS);
  useEffect(() => {
    const sync = () => setSettings(getNotificationSettings());
    sync();
    window.addEventListener(NOTIFICATION_SETTINGS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(NOTIFICATION_SETTINGS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return settings;
}

export function useAlertSound(kind: AlertKind, pref: AlertPref, active: boolean, key: string) {
  // Suena al aparecer o cuando cambia (otro pedido, otro error); una sola vez
  // por aviso aunque se cambie de pantalla
  useEffect(() => {
    if (!active || !key) return;
    const seen = `bpos_alert:${kind}:${key}`;
    try {
      if (sessionStorage.getItem(seen)) return;
      sessionStorage.setItem(seen, "1");
    } catch {}
    playAlert(pref);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando aparece o cambia el aviso
  }, [active, key]);

  // Recordatorio mientras no se atienda
  useEffect(() => {
    if (!active || !pref.repeat) return;
    const timer = window.setInterval(() => playAlert(pref), pref.every * 1000);
    return () => window.clearInterval(timer);
  }, [active, pref]);
}
