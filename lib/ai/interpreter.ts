import { AIParsedTicket } from "@/lib/ai/schemas";
import { fallbackParseTicket } from "@/lib/ai/fallback";
import { validateAIParsedTicket } from "@/lib/ai/validator";

export async function interpretTicketWithAI(
  ticketText: string
): Promise<AIParsedTicket> {
  try {
    // Próximamente aquí conectaremos OpenAI / GPT vision.
    const parsed = fallbackParseTicket(ticketText);

    return validateAIParsedTicket(parsed);
  } catch (error) {
    console.error("Error interpretando ticket:", error);
    return fallbackParseTicket(ticketText);
  }
}