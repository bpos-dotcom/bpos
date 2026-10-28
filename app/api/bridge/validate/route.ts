import { NextRequest, NextResponse } from "next/server";
import { guardBridgeRequest } from "@/lib/bridge/api-guard";
import type {
  CatalogIngredient,
  CatalogProduct,
  OrderInterpretation,
} from "@/lib/bridge/interpret-order";
import { prepareSalePayload } from "@/lib/bridge/prepare-sale";
import { validateInterpretedOrder } from "@/lib/bridge/validate-order";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ValidateRequestBody = {
  platform?: string;
  orderId?: string | null;
  customer?: { name?: string | null; phone?: string | null };
  delivery?: { address?: string | null; type?: string | null };
  total?: number;
  rawText?: string;
  interpretation?: OrderInterpretation;
  products?: CatalogProduct[];
  ingredients?: CatalogIngredient[];
};

export async function POST(request: NextRequest) {
  const denied = await guardBridgeRequest(request);
  if (denied) return denied;

  try {
    const body = (await request.json()) as ValidateRequestBody;

    const validation = validateInterpretedOrder({
      interpretation: body.interpretation,
      products: Array.isArray(body.products) ? body.products : [],
      ingredients: Array.isArray(body.ingredients) ? body.ingredients : [],
    });

    const saleReadyPayload = prepareSalePayload({
      platform: body.platform,
      orderId: body.orderId,
      customer: body.customer,
      delivery: body.delivery,
      total: body.total,
      rawText: body.rawText,
      interpretation: body.interpretation,
      validation,
    });

    return NextResponse.json({
      success: true,
      validation,
      saleReadyPayload,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo validar el pedido.",
      },
      { status: 500 }
    );
  }
}
