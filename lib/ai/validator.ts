// lib/ai/validator.ts

import { AIParsedTicket } from "@/lib/ai/schemas";

export function validateAIParsedTicket(data: unknown): AIParsedTicket {
  if (!data || typeof data !== "object") {
    throw new Error("La respuesta de IA no es un objeto válido.");
  }

  const ticket = data as AIParsedTicket;

  if (!ticket.platform) {
    throw new Error("La IA no devolvió plataforma.");
  }

  if (!ticket.orderNumber) {
    throw new Error("La IA no devolvió número de pedido.");
  }

  if (!Array.isArray(ticket.items)) {
    throw new Error("La IA no devolvió productos.");
  }

  if (ticket.items.length === 0) {
    throw new Error("La IA no detectó productos.");
  }

  ticket.items.forEach((item, index) => {
    if (!item.originalName) {
      throw new Error(`Producto ${index + 1} sin nombre original.`);
    }

    if (!item.normalizedName) {
      throw new Error(`Producto ${index + 1} sin nombre normalizado.`);
    }

    if (typeof item.quantity !== "number" || item.quantity <= 0) {
      throw new Error(`Producto ${index + 1} tiene cantidad inválida.`);
    }
  });

  return ticket;
}