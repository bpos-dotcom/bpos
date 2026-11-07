/**
 * Generador mínimo de archivos Excel (.xlsx) sin librerías externas.
 * Un .xlsx es un ZIP con archivos XML; aquí se arma sin compresión.
 */

export type Cell = string | number | null | undefined;
export type Sheet = { name: string; rows: Cell[][] };

// ------------------------------------------------------------ ZIP (sin compresión)

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; content: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nombres UTF-8
    local.setUint16(8, 0, true); // sin compresión
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let pos = 0;
  all.forEach((c) => {
    out.set(c, pos);
    pos += c.length;
  });
  return out;
}

// ------------------------------------------------------------ XLSX

const esc = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // caracteres de control no válidos en XML
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

function colName(index: number) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(rows: Cell[][]) {
  const widths = new Map<number, number>();
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          if (value === null || value === undefined || value === "") return "";
          const ref = `${colName(c)}${r + 1}`;
          const len = String(value).length;
          widths.set(c, Math.min(Math.max(widths.get(c) ?? 8, len + 2), 60));
          const style = r === 0 ? ' s="1"' : "";
          if (typeof value === "number" && Number.isFinite(value)) {
            return `<c r="${ref}"${style}><v>${Math.round(value * 10000) / 10000}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const cols = widths.size
    ? `<cols>${[...widths.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([c, w]) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}

function safeSheetName(name: string, used: Set<string>) {
  let base = name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Hoja";
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base.slice(0, 28)} ${i}`;
    i += 1;
  }
  used.add(candidate.toLowerCase());
  base = candidate;
  return base;
}

export function buildXlsx(sheets: Sheet[]): Uint8Array {
  const used = new Set<string>();
  const named = sheets.map((s) => ({ ...s, name: safeSheetName(s.name, used) }));

  const files = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${named
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join("")}</Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${named
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: "xl/styles.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    },
    ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml(s.rows) })),
  ];

  return zip(files);
}

/** Descarga el Excel en el navegador */
export function downloadXlsx(fileName: string, sheets: Sheet[]) {
  const bytes = buildXlsx(sheets);
  const blob = new Blob([bytes.buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ------------------------------------------------------------ leer (importar)

/** Archivos de un ZIP (Excel guarda comprimido: se descomprime con el navegador, sin librerías) */
async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Fin del directorio central: firma 0x06054b50, buscándola desde el final
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("El archivo no es un Excel válido (.xlsx).");
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const out = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) {
      const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      out.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
    }
  }
  return out;
}

/** "B12" → columna 1 (empieza en 0) */
function columnIndex(ref: string) {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() || "A";
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

/** Primera hoja de un .xlsx como renglones de texto */
async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const files = await unzip(bytes);
  const decoder = new TextDecoder();
  const xml = (name: string) => {
    const f = files.get(name);
    return f ? new DOMParser().parseFromString(decoder.decode(f), "application/xml") : null;
  };
  const shared = [...(xml("xl/sharedStrings.xml")?.getElementsByTagName("si") || [])].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent || "").join(""));
  const sheetName = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]))[0];
  const sheet = sheetName ? xml(sheetName) : null;
  if (!sheet) throw new Error("El Excel no tiene hojas.");
  return [...sheet.getElementsByTagName("row")].map((row) => {
    const cells: string[] = [];
    for (const c of [...row.getElementsByTagName("c")]) {
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      const value = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? [...c.getElementsByTagName("t")].map((t) => t.textContent || "").join("") : v;
      cells[columnIndex(c.getAttribute("r") || "A")] = value;
    }
    return Array.from(cells, (x) => (x ?? "").trim());
  });
}

/** CSV (coma o punto y coma, con comillas) como renglones de texto */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] || "";
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some(Boolean));
}

/** Todas las hojas de un .xlsx con su nombre (las de reportes de DiDi o Uber traen varias) */
async function readXlsxSheets(bytes: Uint8Array): Promise<{ name: string; rows: string[][] }[]> {
  const files = await unzip(bytes);
  const decoder = new TextDecoder();
  const xml = (name: string) => {
    const f = files.get(name);
    return f ? new DOMParser().parseFromString(decoder.decode(f), "application/xml") : null;
  };
  const shared = [...(xml("xl/sharedStrings.xml")?.getElementsByTagName("si") || [])].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent || "").join(""));
  // Nombre de cada hoja: workbook.xml (sheet r:id) → rels (Target)
  const rels = new Map([...(xml("xl/_rels/workbook.xml.rels")?.getElementsByTagName("Relationship") || [])].map((r) => [r.getAttribute("Id") || "", (r.getAttribute("Target") || "").replace(/^\/?xl\//, "")]));
  const sheets = [...(xml("xl/workbook.xml")?.getElementsByTagName("sheet") || [])].map((s, i) => {
    const rid = s.getAttribute("r:id") || [...s.attributes].find((a) => a.name.endsWith(":id"))?.value || "";
    return { name: s.getAttribute("name") || `Hoja ${i + 1}`, path: `xl/${rels.get(rid) || `worksheets/sheet${i + 1}.xml`}` };
  });
  return sheets
    .map(({ name, path }) => {
      const sheet = xml(path);
      if (!sheet) return { name, rows: [] };
      const rows = [...sheet.getElementsByTagName("row")].map((row) => {
        const cells: string[] = [];
        for (const c of [...row.getElementsByTagName("c")]) {
          const type = c.getAttribute("t");
          const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
          cells[columnIndex(c.getAttribute("r") || "A")] = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? [...c.getElementsByTagName("t")].map((t) => t.textContent || "").join("") : v;
        }
        return Array.from(cells, (x) => (x ?? "").trim());
      });
      return { name, rows: rows.filter((r) => r.some(Boolean)) };
    })
    .filter((s) => s.rows.length);
}

/** Lee todas las hojas de un Excel (.xlsx) o el CSV como una sola hoja */
export async function readSpreadsheetSheets(file: File): Promise<{ name: string; rows: string[][] }[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsxSheets(bytes);
  if (/\.xls$/i.test(file.name)) throw new Error("Ese es un Excel viejo (.xls). Guárdalo como .xlsx o .csv y vuelve a intentar.");
  return [{ name: file.name.replace(/\.[^.]+$/, ""), rows: parseCsv(new TextDecoder().decode(bytes)) }];
}

/** Lee un Excel (.xlsx) o CSV: renglones de texto, sin los vacíos */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) return (await readXlsx(bytes)).filter((r) => r.some(Boolean));
  if (/\.xls$/i.test(file.name)) throw new Error("Ese es un Excel viejo (.xls). Guárdalo como .xlsx o .csv y vuelve a intentar.");
  return parseCsv(new TextDecoder().decode(bytes));
}
