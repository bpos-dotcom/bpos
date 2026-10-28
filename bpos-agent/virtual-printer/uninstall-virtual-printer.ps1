# Desinstalador limpio (bloque 13): quita la impresora virtual y su puerto.
$printerName = "B-POS Agent Virtual Printer"
$portName = "9100"

if (Get-Printer -Name $printerName -ErrorAction SilentlyContinue) {
  Remove-Printer -Name $printerName -ErrorAction SilentlyContinue
  Write-Output "Impresora eliminada: $printerName"
}

# El puerto solo se quita si ya ninguna impresora lo usa
$enUso = Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.PortName -eq $portName }
if (-not $enUso -and (Get-PrinterPort -Name $portName -ErrorAction SilentlyContinue)) {
  Remove-PrinterPort -Name $portName -ErrorAction SilentlyContinue
  Write-Output "Puerto eliminado: $portName"
}
