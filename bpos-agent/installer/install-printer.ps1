$portName = "BPOS_AGENT_9100"
$printerName = "B-POS Agent"

if (-not (Get-PrinterPort -Name $portName -ErrorAction SilentlyContinue)) {
  Add-PrinterPort -Name $portName -PrinterHostAddress "127.0.0.1" -PortNumber 9100
}

Write-Output "Puerto B-POS Agent creado correctamente."