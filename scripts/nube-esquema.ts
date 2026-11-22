/**
 * Escribe nube/schema.sql (las tablas de D1) a partir de nube/tables.ts.
 *   npx tsx scripts/nube-esquema.ts
 */
import { writeFileSync } from "node:fs";
import { schemaSql } from "../nube/tables";

writeFileSync("nube/schema.sql", `-- Generado por scripts/nube-esquema.ts a partir de nube/tables.ts. No editar a mano.\n\n${schemaSql()}`);
console.log("nube/schema.sql listo");
