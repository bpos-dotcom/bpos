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

// Envío RAW por la cola de Windows (winspool) desde PowerShell, sin módulos nativos
const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
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
[BposRaw]::Send($env:BPOS_RAW_PRINTER, [IO.File]::ReadAllBytes($env:BPOS_RAW_FILE))
`;
const ENCODED = Buffer.from(PS_SCRIPT, "utf16le").toString("base64");

function sendRaw(printerName, bytes) {
  const file = path.join(os.tmpdir(), `bpos-raw-${crypto.randomBytes(6).toString("hex")}.bin`);
  fs.writeFileSync(file, bytes);
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", ENCODED],
      { windowsHide: true, timeout: 60000, env: { ...process.env, BPOS_RAW_PRINTER: printerName, BPOS_RAW_FILE: file } },
      (error, stdout, stderr) => {
        fs.rm(file, { force: true }, () => {});
        if (error) reject(new Error(`La impresora no aceptó el ticket: ${String(stderr || error.message).split("\n")[0].trim()}`));
        else resolve();
      }
    );
  });
}

/** Imprime una imagen de ticket en una térmica ESC/POS. */
async function printImageEscPos(image, printerName, widthMm) {
  await sendRaw(printerName, await imageToEscPos(image.dataUrl, widthMm));
}

module.exports = { printImageEscPos, imageToEscPos, sendRaw };
