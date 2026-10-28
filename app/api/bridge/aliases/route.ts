import { NextRequest, NextResponse } from "next/server";
import { guardBridgeRequest } from "@/lib/bridge/api-guard";
import { BRIDGE_DATA_DIR } from "@/lib/bridge/data-dir";
import fs from "fs";
import path from "path";

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
  createdAt: string;
  updatedAt: string;
};

type AliasFile = {
  aliases: BridgeAlias[];
};

const DATA_DIR = BRIDGE_DATA_DIR;
const DATA_FILE = path.join(DATA_DIR, "bridge-aliases.json");

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    const initialData: AliasFile = {
      aliases: [],
    };

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(initialData, null, 2),
      "utf8"
    );
  }
}

function normalizeExternalName(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function readAliases(): AliasFile {
  ensureStorage();

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as AliasFile;

    return {
      aliases: Array.isArray(parsed.aliases)
        ? parsed.aliases
        : [],
    };
  } catch {
    return {
      aliases: [],
    };
  }
}

function writeAliases(data: AliasFile) {
  ensureStorage();

  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

export async function GET(request: NextRequest) {
  const denied = await guardBridgeRequest(request);
  if (denied) return denied;

  const data = readAliases();

  return NextResponse.json({
    success: true,
    count: data.aliases.length,
    aliases: data.aliases,
  });
}

export async function POST(request: NextRequest) {
  const denied = await guardBridgeRequest(request);
  if (denied) return denied;

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

    const data = readAliases();
    const now = new Date().toISOString();

    const existingIndex = data.aliases.findIndex(
      (alias) =>
        alias.normalizedExternalName ===
          normalizedExternalName &&
        (alias.platform || null) === platform
    );

    let savedAlias: BridgeAlias;

    if (existingIndex >= 0) {
      const existing = data.aliases[existingIndex];

      savedAlias = {
        ...existing,
        externalName,
        normalizedExternalName,
        platform,
        actionType,
        targets,
        updatedAt: now,
      };

      data.aliases[existingIndex] = savedAlias;
    } else {
      savedAlias = {
        id: `alias-${Date.now()}`,
        externalName,
        normalizedExternalName,
        platform,
        actionType,
        targets,
        createdAt: now,
        updatedAt: now,
      };

      data.aliases.push(savedAlias);
    }

    writeAliases(data);

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
  const denied = await guardBridgeRequest(request);
  if (denied) return denied;

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

    const data = readAliases();
    const originalCount = data.aliases.length;

    data.aliases = data.aliases.filter(
      (alias) => alias.id !== id
    );

    writeAliases(data);

    return NextResponse.json({
      success: true,
      deleted: data.aliases.length < originalCount,
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