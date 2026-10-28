import { NextRequest, NextResponse } from "next/server";
import type { OrderInterpretation } from "@/lib/bridge/interpret-order";
import type { FinalOrderValidation } from "@/lib/bridge/validate-order";
import type { SaleReadyPayload } from "@/lib/bridge/prepare-sale";

export const dynamic = "force-dynamic";

type BridgeStatus =
  | "Recibido"
  | "Interpretado"
  | "Procesando IA"
  | "Venta creada"
  | "Inventario actualizado"
  | "KDS enviado"
  | "Impreso"
  | "Finalizado"
  | "Error";

type BridgeOrder = {
  id?: number | string;
  orderId?: string | null;
  platform?: string;
  customer?: {
    name?: string | null;
    phone?: string | null;
  };
  delivery?: {
    address?: string | null;
    type?: string | null;
  };
  items?: unknown[];
  rawText?: string;
  total?: number;
  status?: BridgeStatus | string;
  receivedAt?: string;
  bridgeReceivedAt?: string;
  bridgeUpdatedAt?: string;
  createdOrderId?: number;
  interpretation?: OrderInterpretation;
  interpretationUpdatedAt?: string;
  bridgeInterpretedAt?: string;
  interpretationState?: "pending" | "resolved" | "error";
  validation?: FinalOrderValidation;
  validationUpdatedAt?: string;
  readyForSale?: boolean;
  saleReadyPayload?: SaleReadyPayload | null;
  salePreparedAt?: string;
  [key: string]: unknown;
};

declare global {
  // eslint-disable-next-line no-var
  var bposBridgeOrders: BridgeOrder[] | undefined;
}

const orders = globalThis.bposBridgeOrders ?? [];

if (!globalThis.bposBridgeOrders) {
  globalThis.bposBridgeOrders = orders;
}

function normalizePlatform(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeOrderId(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export async function GET() {
  return NextResponse.json(
    {
      success: true,
      count: orders.length,
      orders,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    const order = (await request.json()) as BridgeOrder;

    if (!order || typeof order !== "object") {
      return NextResponse.json(
        { success: false, error: "Pedido inválido." },
        { status: 400 }
      );
    }

    const platform = normalizePlatform(order.platform);
    const orderId = normalizeOrderId(order.orderId);

    if (!platform || !orderId) {
      return NextResponse.json(
        { success: false, error: "Faltan platform u orderId." },
        { status: 400 }
      );
    }

    const duplicate = orders.some(
      (existingOrder) =>
        normalizePlatform(existingOrder.platform) === platform &&
        normalizeOrderId(existingOrder.orderId) === orderId
    );

    if (duplicate) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        message: "El pedido ya había sido recibido.",
      });
    }

    const savedOrder: BridgeOrder = {
      ...order,
      id: order.id ?? Date.now(),
      platform,
      orderId,
      bridgeReceivedAt: new Date().toISOString(),
      status: "Recibido",
    };

    orders.unshift(savedOrder);

    console.log("Pedido recibido desde B-POS Agent:", {
      platform: savedOrder.platform,
      orderId: savedOrder.orderId,
    });

    return NextResponse.json(
      {
        success: true,
        duplicate: false,
        order: savedOrder,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error recibiendo pedido del Agent:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo recibir el pedido.",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      platform?: string;
      orderId?: string;
      status?: BridgeStatus;
      createdOrderId?: number;
      interpretation?: OrderInterpretation;
      validation?: FinalOrderValidation;
      saleReadyPayload?: SaleReadyPayload | null;
    };

    const platform = normalizePlatform(body.platform);
    const orderId = normalizeOrderId(body.orderId);

    const index = orders.findIndex(
      (order) =>
        normalizePlatform(order.platform) === platform &&
        normalizeOrderId(order.orderId) === orderId
    );

    if (index === -1) {
      return NextResponse.json(
        { success: false, error: "Pedido no encontrado." },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();
    const currentOrder = orders[index];
    const interpretation = body.interpretation;

    // Bloque 2.3: el resultado validado del motor es la única fuente
    // que puede mover automáticamente Recibido <-> Interpretado.
    let automaticStatus: BridgeStatus | string | undefined;
    let interpretationState: "pending" | "resolved" | "error" | undefined;
    let bridgeInterpretedAt = currentOrder.bridgeInterpretedAt;

    if (interpretation) {
      if (interpretation.resolved) {
        interpretationState = "resolved";
        bridgeInterpretedAt = currentOrder.bridgeInterpretedAt || now;

        if (!currentOrder.status || currentOrder.status === "Recibido") {
          automaticStatus = "Interpretado";
        }
      } else {
        interpretationState =
          interpretation.errorCount > 0 ? "error" : "pending";

        if (currentOrder.status === "Interpretado") {
          automaticStatus = "Recibido";
          bridgeInterpretedAt = undefined;
        }
      }
    }

    orders[index] = {
      ...currentOrder,
      ...(body.status ? { status: body.status } : {}),
      ...(!body.status && automaticStatus ? { status: automaticStatus } : {}),
      ...(typeof body.createdOrderId === "number"
        ? { createdOrderId: body.createdOrderId }
        : {}),
      ...(interpretation
        ? {
            interpretation,
            interpretationUpdatedAt: now,
            interpretationState,
            ...(bridgeInterpretedAt
              ? { bridgeInterpretedAt }
              : { bridgeInterpretedAt: undefined }),
          }
        : {}),
      ...(body.validation
        ? {
            validation: body.validation,
            validationUpdatedAt: now,
            readyForSale: body.validation.readyForSale,
          }
        : {}),
      ...(body.saleReadyPayload !== undefined
        ? {
            saleReadyPayload: body.saleReadyPayload,
            salePreparedAt: body.saleReadyPayload ? now : undefined,
          }
        : {}),
      bridgeUpdatedAt: now,
    };

    return NextResponse.json({ success: true, order: orders[index] });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo actualizar el pedido.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  orders.splice(0, orders.length);
  return NextResponse.json({ success: true, count: 0, orders: [] });
}
