$printerName = "B-POS Agent Virtual Printer"
$portName = "9100"
$hostAddress = "127.0.0.1"
$portNumber = 9100
$driverName = "Generic / Text Only"

Write-Output "Instalando B-POS Agent Virtual Printer..."

if (-not (Get-PrinterPort -Name $portName -ErrorAction SilentlyContinue)) {
  Add-PrinterPort -Name $portName -PrinterHostAddress $hostAddress -PortNumber $portNumber
Write-Output ("Puerto creado: {0} -> {1}:{2}" -f $portName, $hostAddress, $portNumber)
} else {
  Write-Output "Puerto ya existe: $portName"
}

$driver = Get-PrinterDriver -Name $driverName -ErrorAction SilentlyContinue

if (-not $driver) {
  Write-Output "No se encontro el driver '$driverName'. Intentando agregarlo..."
  Add-PrinterDriver -Name $driverName -ErrorAction SilentlyContinue
}

$driver = Get-PrinterDriver -Name $driverName -ErrorAction SilentlyContinue

if (-not $driver) {
  Write-Output "ERROR: No se pudo instalar el driver '$driverName'."
  Write-Output "Instalacion de impresora virtual incompleta."
  exit 1
}

$existingPrinter = Get-Printer -Name $printerName -ErrorAction SilentlyContinue

if (-not $existingPrinter) {
  Add-Printer -Name $printerName -DriverName $driverName -PortName $portName
  Write-Output "Impresora creada: $printerName"
} else {
  Write-Output "Impresora ya existe: $printerName"

  if ($existingPrinter.PortName -ne $portName) {
    Set-Printer -Name $printerName -PortName $portName
    Write-Output "Puerto actualizado a: $portName"
  }
}

Write-Output "B-POS Agent Virtual Printer instalado correctamente."