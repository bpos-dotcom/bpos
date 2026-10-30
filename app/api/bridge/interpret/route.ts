import { NextRequest, NextResponse } from "next/server";
import { bridgeAuth } from "@/lib/bridge/api-guard";
import {
  BridgeAlias,
  CatalogIngredient,
  CatalogProduct,
  interpretOrder,
} from "@/lib/bridge/interpret-order";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type InterpretRequestBody = {
  platform?: string;
  rawText?: string;
  aliases?: BridgeAlias[];
  products?: CatalogProduct[];
  ingredients?: CatalogIngredient[];
};

export async function POST(request: NextRequest) {
  const auth = await bridgeAuth(request);
  if ("denied" in auth) return auth.denied;

  try {
    const body = (await request.json()) as InterpretRequestBody;

    const result = interpretOrder({
      platform: body.platform,
      rawText: body.rawText,
      aliases: Array.isArray(body.aliases) ? body.aliases : [],
      products: Array.isArray(body.products) ? body.products : [],
      ingredients: Array.isArray(body.ingredients) ? body.ingredients : [],
    });

    return NextResponse.json({
      success: true,
      interpretation: result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo interpretar el pedido.",
      },
      { status: 500 }
    );
  }
}
