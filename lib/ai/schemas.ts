// lib/ai/schemas.ts

export type AIParsedItem = {
  /** Nombre EXACTAMENTE como aparece en el ticket */
  originalName: string;

  /** Cantidad detectada */
  quantity: number;

  /** Nombre normalizado sugerido por la IA */
  normalizedName: string;

  /** Observaciones del producto */
  notes?: string;
};

export type AIParsedTicket = {
  platform: "Didi Food" | "Uber Eats" | "Rappi" | "Otro";

  orderNumber: string;

  customer?: string;

  items: AIParsedItem[];

  generalNotes?: string;

  confidence: number;
};

export const AI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    platform: {
      type: "string",
    },
    orderNumber: {
      type: "string",
    },
    customer: {
      type: "string",
    },
    confidence: {
      type: "number",
    },
    generalNotes: {
      type: "string",
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          originalName: {
            type: "string",
          },
          normalizedName: {
            type: "string",
          },
          quantity: {
            type: "number",
          },
          notes: {
            type: "string",
          },
        },
        required: [
          "originalName",
          "normalizedName",
          "quantity",
        ],
      },
    },
  },
  required: [
    "platform",
    "orderNumber",
    "items",
    "confidence",
  ],
};