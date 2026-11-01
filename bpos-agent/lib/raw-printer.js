// Impresión directa a térmicas (ESC/POS) sin pasar por el controlador.
//
// Las térmicas de 58/80 mm (XP-58, EPSON TM, etc.) con su controlador de
// Windows imprimían los tickets EN BLANCO cuando se mandaban como página
// (Chromium → GDI). Aquí la imagen del ticket se convierte a puntos blanco/
// negro y se manda en el idioma de la impresora (ESC/POS, "GS v 0"), como
// datos RAW por la cola de impresión de Windows.
const { execFile } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

/** Puntos por renglón: 58 mm → 384, 80 mm → 576 (cabezal de 203 dpi). */
function dotsForWidth(widthMm) {
  return widthMm === 58 ? 384 : 576;
}

/** Imagen (data URL) → comandos ESC/POS: inicializar, imagen por bandas, avanzar y cortar. */
async function imageToEscPos(dataUrl, widthMm) {
  const dots = dotsForWidth(widthMm);
  const img = await loadImage(Buffer.from(dataUrl.split(",")[1], "base64"));
  const height = Math.max(1, Math.round(img.height * (dots / img.width)));
  const canvas = createCanvas(dots, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, dots, height);
  ctx.drawImage(img, 0, 0, dots, height);
  const pixels = ctx.getImageData(0, 0, dots, height).data;

  const bytesPerRow = dots / 8;
  const parts = [Buffer.from([0x1b, 0x40])]; // ESC @: reiniciar
  const BAND = 128; // renglones por comando (algunas térmicas no aceptan bloques grandes)
  for (let top = 0; top < height; top += BAND) {
    const rows = Math.min(BAND, height - top);
    const band = Buffer.alloc(bytesPerRow * rows);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < dots; x += 1) {
        const i = ((top + y) * dots + x) * 4;
        const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        // 170: los bordes suavizados de las letras cuentan como negro (letra más gruesa y oscura)
        if (lum < 170) band[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    // GS v 0 m xL xH yL yH datos
    parts.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8]), band);
  }
  parts.push(Buffer.from([0x1b, 0x64, 0x04])); // ESC d 4: avanzar 4 renglones para poder cortar
  parts.push(Buffer.from([0x1d, 0x56, 0x42, 0x00])); // GS V B 0: corte parcial (si la impresora tiene cortador)
  return Buffer.concat(parts);
}

// Envío RAW por la cola de Windows (winspool) desde PowerShell, sin módulos nativos.
// El código C# se compila UNA vez (Add-Type tarda 2-4 s) y queda guardado como
// DLL en %APPDATA%\B-POS\cache; los demás tickets solo lo cargan.
const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$src = @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public class BposRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "B-POS ticket"; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        StartPagePrinter(h);
        int written;
        if (!WritePrinter(h, data, data.Length, out written) || written != data.Length) throw new Win32Exception(Marshal.GetLastWin32Error());
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
$dll = Join-Path $env:BPOS_RAW_CACHE 'BposRaw-v1.dll'
if (-not (Test-Path $dll)) {
  New-Item -ItemType Directory -Force -Path $env:BPOS_RAW_CACHE | Out-Null
  $tmp = "$dll.$PID.tmp"
  Add-Type -TypeDefinition $src -OutputAssembly $tmp
  try { Move-Item -Path $tmp -Destination $dll -Force -ErrorAction Stop } catch { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}
try { Add-Type -Path $dll } catch { Add-Type -TypeDefinition $src }
[BposRaw]::Send($env:BPOS_RAW_PRINTER, [IO.File]::ReadAllBytes($env:BPOS_RAW_FILE))
`;
const ENCODED = Buffer.from(PS_SCRIPT, "utf16le").toString("base64");

const CACHE_DIR = path.join(process.env.APPDATA || os.tmpdir(), "B-POS", "bpos-raw");

/**
 * PowerShell sin consola escribe sus errores serializados ("#< CLIXML ...
 * <S S="Error">texto</S>"); aquí se saca el texto legible.
 */
function decodePowerShellError(stderr, fallback) {
  const raw = String(stderr || "");
  const unescape = (v) =>
    v
      .replace(/_x000D_/g, "")
      .replace(/_x000A_/g, "\n")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  const parts = [...raw.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) => unescape(m[1]));
  const text = (parts.length ? parts.join("") : raw.replace(/^#< CLIXML\s*/i, ""))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(En l[ií]nea|At line|\+ |\+ CategoryInfo|\+ FullyQualifiedErrorId|\s*~+)/.test(l));
  return (text[0] || fallback || "error desconocido").slice(0, 300);
}

/**
 * Texto de la consola de Windows: la salida de PowerShell va en la página de
 * códigos OEM (850 en español), que Node no trae; aquí van sus letras con acento.
 */
const CP850 = { 0x80: "Ç", 0x81: "ü", 0x82: "é", 0x83: "â", 0x84: "ä", 0x85: "à", 0x86: "å", 0x87: "ç", 0x88: "ê", 0x89: "ë", 0x8a: "è", 0x8b: "ï", 0x8c: "î", 0x8d: "ì", 0x8e: "Ä", 0x8f: "Å", 0x90: "É", 0x91: "æ", 0x92: "Æ", 0x93: "ô", 0x94: "ö", 0x95: "ò", 0x96: "û", 0x97: "ù", 0x98: "ÿ", 0x99: "Ö", 0x9a: "Ü", 0x9b: "ø", 0x9c: "£", 0x9d: "Ø", 0x9e: "×", 0x9f: "ƒ", 0xa0: "á", 0xa1: "í", 0xa2: "ó", 0xa3: "ú", 0xa4: "ñ", 0xa5: "Ñ", 0xa6: "ª", 0xa7: "º", 0xa8: "¿", 0xad: "¡", 0xb5: "Á", 0xb6: "Â", 0xb7: "À", 0xc6: "ã", 0xc7: "Ã", 0xd0: "ð", 0xd1: "Ð", 0xd2: "Ê", 0xd3: "Ë", 0xd4: "È", 0xd6: "Í", 0xd7: "Î", 0xd8: "Ï", 0xe0: "Ó", 0xe1: "ß", 0xe2: "Ô", 0xe3: "Ò", 0xe4: "õ", 0xe5: "Õ", 0xe9: "Ú", 0xea: "Û", 0xeb: "Ù", 0xec: "ý", 0xed: "Ý", 0xf8: "°" };
function decodeConsole(buffer) {
  if (!buffer || !buffer.length) return "";
  let out = "";
  for (const byte of buffer) out += byte < 0x80 ? String.fromCharCode(byte) : CP850[byte] || "?";
  return out;
}

function runPowerShell(printerName, file) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", ENCODED],
      {
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "buffer", // PowerShell escribe en la página de códigos de Windows, no en UTF-8
        env: { ...process.env, BPOS_RAW_PRINTER: printerName, BPOS_RAW_FILE: file, BPOS_RAW_CACHE: CACHE_DIR },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve();
        const message = decodePowerShellError(decodeConsole(stderr), error.killed ? "PowerShell tardó más de 60 s" : error.message);
        console.error(`[raw-printer] "${printerName}": ${message}`);
        reject(new Error(message));
      }
    );
  });
}

async function sendRaw(printerName, bytes) {
  const file = path.join(os.tmpdir(), `bpos-raw-${crypto.randomBytes(6).toString("hex")}.bin`);
  fs.writeFileSync(file, bytes);
  try {
    try {
      await runPowerShell(printerName, file);
    } catch (first) {
      // Un fallo pasajero (cola ocupada, antivirus revisando el DLL recién creado): un reintento
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await runPowerShell(printerName, file);
      } catch {
        throw new Error(`La impresora "${printerName}" no aceptó el ticket: ${first.message}`);
      }
    }
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}

/** Imprime una imagen de ticket en una térmica ESC/POS. */
async function printImageEscPos(image, printerName, widthMm) {
  await sendRaw(printerName, await imageToEscPos(image.dataUrl, widthMm));
}

module.exports = { printImageEscPos, imageToEscPos, sendRaw, decodePowerShellError };
