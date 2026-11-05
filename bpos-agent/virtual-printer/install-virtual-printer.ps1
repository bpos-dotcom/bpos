# Instala la impresora virtual "B-POS Agent Virtual Printer" (puerto 127.0.0.1:9100).
# Necesita permisos de administrador. Deja lo que pasó en
# %ProgramData%\B-POS\virtual-printer.log para que "Reparar instalación" diga
# el motivo exacto si algo falla.
param(
  [string]$LogPath = (Join-Path $env:ProgramData "B-POS\virtual-printer.log"),
  # Solo para pruebas: otro nombre para no tocar la impresora que ya funciona
  [string]$PrinterName = "B-POS Agent Virtual Printer",
  # Solo para pruebas: controladores a intentar, en orden
  [string[]]$TestDrivers = @()
)

$printerName = $PrinterName
$portName = "9100"
$hostAddress = "127.0.0.1"
$portNumber = 9100

try { New-Item -ItemType Directory -Force -Path (Split-Path $LogPath) | Out-Null } catch {}
try { Set-Content -Path $LogPath -Value "" -Encoding UTF8 } catch {}

# Write-Host y no Write-Output: dentro de una función, Write-Output se vuelve
# parte de lo que regresa y un "no" con mensajes se leía como "sí"
function Log([string]$message) {
  Write-Host $message
  try { Add-Content -Path $LogPath -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message) -Encoding UTF8 } catch {}
}

function Fail([string]$message) {
  Log "ERROR: $message"
  exit 1
}

Log "Instalando $printerName..."

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

# Datos de Windows para el registro (ayudan a entender un error)
try {
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
  Log ("Windows: {0} (version {1})" -f $os.Caption, $os.BuildNumber)
} catch {}
$wpp = Get-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Printers\WPP" -ErrorAction SilentlyContinue
if ($wpp) { Log ("Modo de impresion protegida de Windows: {0}" -f ($wpp | Out-String).Trim()) }

# Orden de prueba. El controlador de la impresora "Microsoft Print to PDF" de
# Windows 11 completo puede ser "Microsoft Virtual Print Class Driver", que no
# acepta un puerto de red: va al final.
$pdfDrivers = @("Microsoft Print To PDF")
# Sin PDF: PWG Raster (viene en Windows 10 y 11) manda el ticket ya dibujado
# como imagen y el Agent lo lee con OCR. XPS queda de último recurso: trae las
# letras como dibujos vectoriales y el OCR las lee mal.
$pwgDrivers = @("Microsoft PWG Raster Class Driver")
$xpsDrivers = @("Microsoft XPS Document Writer v4", "Microsoft XPS Document Writer")
$classDrivers = @("Microsoft Virtual Print Class Driver")
$pdfPrinter = Get-Printer -Name "Microsoft Print to PDF" -ErrorAction SilentlyContinue
if ($pdfPrinter -and $pdfPrinter.DriverName -notin ($pdfDrivers + $pwgDrivers + $xpsDrivers + $classDrivers)) { $classDrivers += $pdfPrinter.DriverName }

function Ensure-Driver([string]$name, [string]$feature) {
  if (Get-PrinterDriver -Name $name -ErrorAction SilentlyContinue) { return $true }
  $null = Add-PrinterDriver -Name $name -ErrorAction SilentlyContinue
  if (Get-PrinterDriver -Name $name -ErrorAction SilentlyContinue) { return $true }
  # Windows 11 nuevo trae el controlador PDF guardado (prnms009.inf) pero sin instalar
  if ($name -eq "Microsoft Print To PDF") {
    $infs = @(Get-ChildItem -Path "$env:windir\System32\DriverStore\FileRepository\prnms009.inf_*\prnms009.inf" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
    if (Test-Path "$env:windir\INF\prnms009.inf") { $infs += "$env:windir\INF\prnms009.inf" }
    foreach ($inf in $infs) {
      try {
        $null = Add-PrinterDriver -Name $name -InfPath $inf -ErrorAction Stop
        Log "Controlador PDF instalado desde $inf"
        return [bool](Get-PrinterDriver -Name $name -ErrorAction SilentlyContinue)
      } catch { Log ("No se pudo instalar el controlador PDF desde {0}: {1}" -f $inf, (Error-Text $_)) }
    }
    if (-not $infs.Count) { Log "Windows no trae el archivo del controlador PDF (prnms009.inf)." }
  }
  if ($feature) {
    $null = Enable-Feature $feature
    $null = Add-PrinterDriver -Name $name -ErrorAction SilentlyContinue
  }
  return [bool](Get-PrinterDriver -Name $name -ErrorAction SilentlyContinue)
}

function Error-Text($err) {
  $e = $err.Exception
  $code = if ($e.HResult) { " (0x{0:X8})" -f $e.HResult } else { "" }
  $native = if ($e.PSObject.Properties["ErrorData"] -and $e.ErrorData) { " " + ($e.ErrorData.CimInstanceProperties | Where-Object { $_.Name -in @("error_Code", "Message") } | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join " " } else { "" }
  return "$($e.Message.Trim())$code$native"
}

# Crea la impresora con un controlador: primero con Add-Printer y, si Windows
# lo rechaza, con WMI (otra vía del mismo servicio de impresión)
function Try-Printer([string]$driver) {
  $null = Get-Printer -Name $printerName -ErrorAction SilentlyContinue | Remove-Printer -ErrorAction SilentlyContinue
  try {
    $null = Add-Printer -Name $printerName -DriverName $driver -PortName $portName -ErrorAction Stop
    if (Get-Printer -Name $printerName -ErrorAction SilentlyContinue) { return $true }
    Log ("Add-Printer con '{0}' no marco error pero la impresora no aparece." -f $driver)
  } catch {
    Log ("Add-Printer con '{0}' fallo: {1}" -f $driver, (Error-Text $_))
  }
  try {
    Set-WmiInstance -Class Win32_Printer -Arguments @{ DeviceID = $printerName; Name = $printerName; DriverName = $driver; PortName = $portName; Network = $false; Shared = $false } -ErrorAction Stop | Out-Null
    if (Get-Printer -Name $printerName -ErrorAction SilentlyContinue) { return $true }
  } catch {
    Log ("WMI con '{0}' fallo: {1}" -f $driver, (Error-Text $_))
  }
  return $false
}

# 4) Impresora. Si ya existe con PDF o PWG, solo se corrige el puerto (con XPS se vuelve a crear)
$usable = $pdfDrivers + $pwgDrivers
$existing = Get-Printer -Name $printerName -ErrorAction SilentlyContinue
if ($existing -and $existing.DriverName -in $usable) {
  if ($existing.PortName -ne $portName) {
    try { Set-Printer -Name $printerName -PortName $portName -ErrorAction Stop; Log "Puerto actualizado a: $portName" }
    catch { Log ("No se pudo cambiar el puerto: {0}" -f (Error-Text $_)) }
  }
  $final = Get-Printer -Name $printerName -ErrorAction SilentlyContinue
  if ($final.PortName -eq $portName) {
    Log ("OK: {0} ya estaba instalada (controlador {1}, puerto {2})." -f $printerName, $final.DriverName, $final.PortName)
    exit 0
  }
}

$tried = @()
$attempts = @()
$attempts += $pdfDrivers | ForEach-Object { @{ Name = $_; Feature = "Printing-PrintToPDFServices-Features" } }
$attempts += $pwgDrivers | ForEach-Object { @{ Name = $_; Feature = $null } }
$attempts += $xpsDrivers | ForEach-Object { @{ Name = $_; Feature = "Printing-XPSServices-Features" } }
$attempts += $classDrivers | ForEach-Object { @{ Name = $_; Feature = $null } }
if ($TestDrivers.Count) { $attempts = @($TestDrivers | ForEach-Object { @{ Name = $_; Feature = $null } }) }
foreach ($a in $attempts) {
  if ((Ensure-Driver $a.Name $a.Feature) -ne $true) { Log ("Windows no tiene el controlador '{0}'." -f $a.Name); continue }
  $tried += $a.Name
  Log ("Creando la impresora con el controlador '{0}'..." -f $a.Name)
  $created = Try-Printer $a.Name
  $final = Get-Printer -Name $printerName -ErrorAction SilentlyContinue
  if ($created -eq $true -and $final) {
    Log ("OK: {0} instalada (controlador {1}, puerto {2})." -f $printerName, $final.DriverName, $final.PortName)
    exit 0
  }
}

if ($tried.Count -eq 0) {
  Fail "Windows no tiene el controlador 'Microsoft Print To PDF' ni XPS. Enciende 'Microsoft Print to PDF' en Caracteristicas de Windows (Windows + R, escribe optionalfeatures) y reinicia la computadora."
}
Fail ("Windows no dejo crear la impresora con ningun controlador ({0}). Reinicia la computadora y vuelve a usar Reparar instalacion; si sigue, manda a soporte C:\ProgramData\B-POS\virtual-printer.log." -f ($tried -join ", "))
