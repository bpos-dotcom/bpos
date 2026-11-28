"use client";
/** Días de ventas / kardex que tiene este equipo, para los letreros de las pantallas */
import { useSyncExternalStore } from "react";
import { KARDEX_LOCAL_DAYS, localKardexCutoff } from "@/lib/kardex-archive";
import { daysCovered } from "@/lib/local-days";
import { ORDERS_LOCAL_DAYS, localOrdersCutoff } from "@/lib/order-archive";

const noSubscribe = () => () => {};

export function useLocalOrdersDays() {
  return useSyncExternalStore(noSubscribe, () => daysCovered(new Date(), localOrdersCutoff()), () => ORDERS_LOCAL_DAYS);
}

export function useLocalKardexDays() {
  return useSyncExternalStore(noSubscribe, () => daysCovered(new Date(), localKardexCutoff()), () => KARDEX_LOCAL_DAYS);
}
