export type BposNotificationKind =
  | "delivery-equivalences"
  | "inventory-warning"
  | "critical-error";

export type BposNotificationDefinition = {
  kind: BposNotificationKind;
  label: string;
  color: string;
  soundSrc: string;
  repeat: boolean;
  repeatEveryMs?: number;
  volume: number;
};

export const BPOS_NOTIFICATIONS: Record<
  BposNotificationKind,
  BposNotificationDefinition
> = {
  "delivery-equivalences": {
    kind: "delivery-equivalences",
    label: "Equivalencias pendientes",
    color: "#22C55E",
    soundSrc: "/sounds/BPOS_Official_Delivery_Equivalences.wav",
    repeat: true,
    repeatEveryMs: 2000,
    volume: 1,
  },
  "inventory-warning": {
    kind: "inventory-warning",
    label: "Inventario bajo",
    color: "#FACC15",
    soundSrc: "/sounds/BPOS_Official_Inventory_Warning.wav",
    repeat: false,
    volume: 1,
  },
  "critical-error": {
    kind: "critical-error",
    label: "Error crítico",
    color: "#EF4444",
    soundSrc: "/sounds/BPOS_Official_Critical_Error.wav",
    repeat: false,
    volume: 1,
  },
};
