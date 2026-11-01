import { NextRequest, NextResponse } from "next/server";
import { bridgeAuth } from "@/lib/bridge/api-guard";
import { bridgeStore } from "@/lib/bridge/store";
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

function normalizePlatform(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeOrderId(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export async function GET(request: NextRequest) {
  const auth = await bridgeAuth(request);
  if ("denied" in auth) return auth.denied;
  const orders = (await bridgeStore(auth.ctx).orders()) as BridgeOrder[];

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

// Pedido capturado a mano desde una pantalla (el Agent sube los suyos directo a la nube)
export async function POST(request: NextRequest) {
  const auth = await bridgeAuth(request);
  if ("denied" in auth) return auth.denied;
  const store = bridgeStore(auth.ctx);

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

    const savedOrder: BridgeOrder = {
      ...order,
      id: order.id ?? Date.now(),
      platform,
      orderId,
      bridgeReceivedAt: new Date().toISOString(),
      status: "Recibido",
    };

    if (!(await store.addOrder(savedOrder))) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        message: "El pedido ya había sido recibido.",
      });
    }

    console.log("Pedido recibido en el Bridge:", {
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
    console.error("Error recibiendo pedido:", error);

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
  const auth = await bridgeAuth(request);
  if ("denied" in auth) return auth.denied;
  const store = bridgeStore(auth.ctx);

  try {
    const orders = (await store.orders()) as BridgeOrder[];
    const body = (await request.json()) as {
      platform?: string;
      orderId?: string;
      status?: BridgeStatus;
      createdOrderId?: number;
      interpretation?: OrderInterpretation;
      validation?: FinalOrderValidation;
      saleReadyPayload?: SaleReadyPayload | null;
      stationPrint?: { at: string; stations: string[]; printers: string[] };
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
      // Ticket original ya mandado a las impresoras de estación (no se repite)
      ...(body.stationPrint ? { stationPrint: body.stationPrint } : {}),
      bridgeUpdatedAt: now,
    };
    await store.saveOrder(orders[index]);

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

export async function DELETE(request: NextRequest) {
  const auth = await bridgeAuth(request);
  if ("denied" in auth) return auth.denied;

  // ?finished=1: solo el historial (finalizados y con venta creada); los pendientes se quedan
  if (request.nextUrl.searchParams.get("finished") === "1") {
    const removed = await bridgeStore(auth.ctx).clearFinishedOrders();
    return NextResponse.json({ success: true, removed });
  }
  await bridgeStore(auth.ctx).clearOrders();
  return NextResponse.json({ success: true, count: 0, orders: [] });
}
