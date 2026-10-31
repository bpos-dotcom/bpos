import { NextRequest, NextResponse } from "next/server";
import { bridgeAuth } from "@/lib/bridge/api-guard";
import { bridgeStore } from "@/lib/bridge/store";

export const dynamic = "force-dynamic";

type AliasActionType =
  | "product"
  | "ingredient"
  | "bundle"
  | "ignore";

type AliasTarget = {
  id: string;
  name: string;
  quantity?: number;
  unit?: string;
};

type BridgeAlias = {
  id: string;
  normalizedExternalName: string;
  externalName: string;
  platform?: string | null;
  actionType: AliasActionType;
  targets: AliasTarget[];
  /** Combo: leer las sub-líneas del ticket como opciones (solo "product") */
  compound?: boolean;
  createdAt: string;
  updatedAt: string;
};

function normalizeExternalName(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(request: NextRequest) {
  const auth = await bridgeAuth(request);
  if ("denied" in auth) return auth.denied;

  const aliases = await bridgeStore(auth.ctx).aliases();

  return NextResponse.json({
    success: true,
    count: aliases.length,
    aliases,
  });
}

export async function POST(request: NextRequest) {
  const auth = await bridgeAuth(request);
  if ("denied" in auth) return auth.denied;
  const store = bridgeStore(auth.ctx);

  try {
    const body = await request.json();

    const externalName = String(
      body.externalName || ""
    ).trim();

    const platform = body.platform
      ? String(body.platform).trim().toLowerCase()
      : null;

    const actionType = String(
      body.actionType || ""
    ) as AliasActionType;

    const validActionTypes: AliasActionType[] = [
      "product",
      "ingredient",
      "bundle",
      "ignore",
    ];

    if (!externalName) {
      return NextResponse.json(
        {
          success: false,
          error: "Falta externalName.",
        },
        { status: 400 }
      );
    }

    if (!validActionTypes.includes(actionType)) {
      return NextResponse.json(
        {
          success: false,
          error: "Tipo de equivalencia inválido.",
        },
        { status: 400 }
      );
    }

    const targets: AliasTarget[] = Array.isArray(
      body.targets
    )
      ? body.targets
          .map((target: Partial<AliasTarget>) => ({
            id: String(target.id || "").trim(),
            name: String(target.name || "").trim(),
            quantity:
              target.quantity === undefined
                ? undefined
                : Number(target.quantity),
            unit: target.unit
              ? String(target.unit).trim()
              : undefined,
          }))
          .filter(
            (target: AliasTarget) =>
              target.id && target.name
          )
      : [];

    if (
      actionType !== "ignore" &&
      targets.length === 0
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "La equivalencia necesita al menos un destino.",
        },
        { status: 400 }
      );
    }

    const normalizedExternalName =
      normalizeExternalName(externalName);
    const compound = actionType === "product" && body.compound === true;

    const aliases = (await store.aliases()) as BridgeAlias[];
    const now = new Date().toISOString();

    const existingIndex = aliases.findIndex(
      (alias) =>
        alias.normalizedExternalName ===
          normalizedExternalName &&
        (alias.platform || null) === platform
    );

    let savedAlias: BridgeAlias;

    if (existingIndex >= 0) {
      const existing = aliases[existingIndex];

      savedAlias = {
        ...existing,
        externalName,
        normalizedExternalName,
        platform,
        actionType,
        targets,
        compound,
        updatedAt: now,
      };
    } else {
      savedAlias = {
        id: `alias-${Date.now()}`,
        externalName,
        normalizedExternalName,
        platform,
        actionType,
        targets,
        compound,
        createdAt: now,
        updatedAt: now,
      };
    }

    await store.saveAlias(savedAlias);

    return NextResponse.json({
      success: true,
      alias: savedAlias,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo guardar la equivalencia.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await bridgeAuth(request);
  if ("denied" in auth) return auth.denied;

  try {
    const body = await request.json();
    const id = String(body.id || "").trim();

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: "Falta el ID de la equivalencia.",
        },
        { status: 400 }
      );
    }

    const deleted = await bridgeStore(auth.ctx).deleteAlias(id);

    return NextResponse.json({
      success: true,
      deleted,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo eliminar la equivalencia.",
      },
      { status: 500 }
    );
  }
}