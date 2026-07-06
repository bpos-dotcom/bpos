$printerName = "B-POS Agent"
$portName = "BPOS_AGENT_9100"
$hostAddress = "127.0.0.1"
$portNumber = 9100

Write-Output "Instalando impresora virtual B-POS Agent..."

if (-not (Get-PrinterPort -Name $portName -ErrorAction SilentlyContinue)) {
  Add-PrinterPort -Name $portName -PrinterHostAddress $hostAddress -PortNumber $portNumber
  Write-Output "Puerto creado: $portName"
} else {
  Write-Output "Puerto ya existe: $portName"
}

$genericDriver = Get-PrinterDriver | Where-Object {
  $_.Name -like "*Generic*" -or
  $_.Name -like "*Genérico*" -or
  $_.Name -like "*Text*" -or
  $_.Name -like "*Texto*"
} | Select-Object -First 1

if (-not $genericDriver) {
  Write-Output "No se encontró driver genérico instalado."
  Write-Output "La impresora virtual no se creó todavía."
  exit 1
}

if (-not (Get-Printer -Name $printerName -ErrorAction SilentlyContinue)) {
  Add-Printer -Name $printerName -DriverName $genericDriver.Name -PortName $portName
  Write-Output "Impresora creada: $printerName"
} else {
  Write-Output "Impresora ya existe: $printerName"
}

Write-Output "Proceso finalizado."