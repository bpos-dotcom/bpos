# Instala la impresora virtual "B-POS Agent Virtual Printer" (puerto 127.0.0.1:9100).
# Necesita permisos de administrador. Deja lo que pasó en
# %ProgramData%\B-POS\virtual-printer.log para que "Reparar instalación" diga
# el motivo exacto si algo falla.
param([string]$LogPath = (Join-Path $env:ProgramData "B-POS\virtual-printer.log"))

$printerName = "B-POS Agent Virtual Printer"
$portName = "9100"
$hostAddress = "127.0.0.1"
$portNumber = 9100

try { New-Item -ItemType Directory -Force -Path (Split-Path $LogPath) | Out-Null } catch {}
try { Set-Content -Path $LogPath -Value "" -Encoding UTF8 } catch {}

function Log([string]$message) {
  Write-Output $message
  try { Add-Content -Path $LogPath -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message) -Encoding UTF8 } catch {}
}

function Fail([string]$message) {
  Log "ERROR: $message"
  exit 1
}

Log "Instalando B-POS Agent Virtual Printer..."

# 1) Servicio de impresión de Windows (sin él no existe ninguna impresora de Windows)
$spooler = Get-Service -Name Spooler -ErrorAction SilentlyContinue
if (-not $spooler) { Fail "Windows no tiene el servicio de impresion (Spooler)." }
if ($spooler.StartType -eq "Disabled") {
  try { Set-Service -Name Spooler -StartupType Automatic -ErrorAction Stop; Log "Servicio de impresion: activado al iniciar." }
  catch { Fail "El servicio de impresion (Spooler) esta deshabilitado y no se pudo activar: $($_.Exception.Message)" }
}
if ((Get-Service -Name Spooler).Status -ne "Running") {
  try { Start-Service -Name Spooler -ErrorAction Stop; Start-Sleep -Seconds 2; Log "Servicio de impresion: iniciado." }
  catch { Fail "No se pudo iniciar el servicio de impresion (Spooler): $($_.Exception.Message)" }
}

# 2) Puerto 127.0.0.1:9100 (ahí escucha el Agent)
$port = Get-PrinterPort -Name $portName -ErrorAction SilentlyContinue
if ($port -and $port.PrinterHostAddress -and ($port.PrinterHostAddress -ne $hostAddress -or $port.PortNumber -ne $portNumber)) {
  $inUse = Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.PortName -eq $portName -and $_.Name -ne $printerName }
  if ($inUse) { Fail ("El puerto '{0}' ya lo usa la impresora '{1}' hacia {2}. Cambia esa impresora a otro puerto." -f $portName, $inUse[0].Name, $port.PrinterHostAddress) }
  Get-Printer -Name $printerName -ErrorAction SilentlyContinue | Remove-Printer -ErrorAction SilentlyContinue
  Remove-PrinterPort -Name $portName -ErrorAction SilentlyContinue
  Log ("Puerto '{0}' apuntaba a {1}: se vuelve a crear." -f $portName, $port.PrinterHostAddress)
  $port = $null
}
if (-not $port) {
  try {
    Add-PrinterPort -Name $portName -PrinterHostAddress $hostAddress -PortNumber $portNumber -ErrorAction Stop
    Log ("Puerto creado: {0} -> {1}:{2}" -f $portName, $hostAddress, $portNumber)
  } catch { Fail "No se pudo crear el puerto ${hostAddress}:${portNumber}: $($_.Exception.Message)" }
} else {
  Log "Puerto ya existe: $portName"
}

# 3) Controlador. PDF primero (el Agent lee el texto del ticket); si Windows no
# lo tiene se enciende "Microsoft Print to PDF"; si no se puede, XPS (el Agent
# lo lee con OCR). "Generic / Text Only" no sirve: entrega los tickets vacíos.
function Get-DriverName([string[]]$names) {
  foreach ($n in $names) { if (Get-PrinterDriver -Name $n -ErrorAction SilentlyContinue) { return $n } }
  return $null
}

function Enable-Feature([string]$feature) {
  try {
    $f = Get-WindowsOptionalFeature -Online -FeatureName $feature -ErrorAction Stop
    if ($f.State -ne "Enabled") {
      Log "Encendiendo la funcion de Windows '$feature'..."
      Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart -ErrorAction Stop | Out-Null
    }
  } catch {
    Log "No se pudo encender '$feature' con PowerShell ($($_.Exception.Message)). Probando con DISM..."
    & dism.exe /online /enable-feature /featurename:$feature /all /norestart /quiet | Out-Null
  }
}

$candidates = @()
# En Windows 11 la impresora "Microsoft Print to PDF" a veces usa otro nombre de controlador
$pdfPrinter = Get-Printer -Name "Microsoft Print to PDF" -ErrorAction SilentlyContinue
if ($pdfPrinter) { $candidates += $pdfPrinter.DriverName }
$candidates += @("Microsoft Print To PDF", "Microsoft Virtual Print Class Driver")

$driverName = Get-DriverName $candidates
if (-not $driverName) {
  Enable-Feature "Printing-PrintToPDFServices-Features"
  Add-PrinterDriver -Name "Microsoft Print To PDF" -ErrorAction SilentlyContinue
  $driverName = Get-DriverName $candidates
}
if (-not $driverName) {
  Log "Windows no tiene el controlador PDF. Probando con XPS..."
  $xps = @("Microsoft XPS Document Writer v4", "Microsoft XPS Document Writer")
  $driverName = Get-DriverName $xps
  if (-not $driverName) {
    Enable-Feature "Printing-XPSServices-Features"
    Add-PrinterDriver -Name "Microsoft XPS Document Writer v4" -ErrorAction SilentlyContinue
    $driverName = Get-DriverName $xps
  }
}
if (-not $driverName) {
  Fail "Windows no tiene el controlador 'Microsoft Print To PDF' ni XPS. Enciende 'Microsoft Print to PDF' en Caracteristicas de Windows (Windows + R, escribe optionalfeatures) y reinicia la computadora."
}
Log "Controlador: $driverName"

# 4) Impresora
$existing = Get-Printer -Name $printerName -ErrorAction SilentlyContinue
try {
  if (-not $existing) {
    Add-Printer -Name $printerName -DriverName $driverName -PortName $portName -ErrorAction Stop
    Log "Impresora creada: $printerName"
  } else {
    if ($existing.DriverName -ne $driverName -and $existing.DriverName -notin $candidates) {
      Set-Printer -Name $printerName -DriverName $driverName -ErrorAction Stop
      Log "Controlador actualizado a: $driverName"
    }
    if ($existing.PortName -ne $portName) {
      Set-Printer -Name $printerName -PortName $portName -ErrorAction Stop
      Log "Puerto actualizado a: $portName"
    }
    Log "Impresora ya existe: $printerName"
  }
} catch {
  Fail "Windows no dejo crear la impresora: $($_.Exception.Message)"
}

$final = Get-Printer -Name $printerName -ErrorAction SilentlyContinue
if (-not $final) { Fail "La impresora no aparece despues de crearla." }
Log ("OK: {0} instalada (controlador {1}, puerto {2})." -f $printerName, $final.DriverName, $final.PortName)
exit 0
