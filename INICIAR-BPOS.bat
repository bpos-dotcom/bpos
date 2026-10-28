@echo off
title B-POS - Burger Planet OS
cd /d "%~dp0"
echo.
echo  ===== B-POS =====
echo.
if not exist "node_modules\.bpos-instalado-v13" (
  echo  Actualizando B-POS. Puede tardar de 1 a 10 minutos.
  echo  Vas a ver muchas lineas pasando: es normal, NO cierres la ventana.
  echo.
  if exist ".next" rmdir /s /q ".next"
  call npm install --no-audit --no-fund --loglevel=http
  if errorlevel 1 (
    echo.
    echo  ERROR al instalar. Toma una captura de esta ventana y mandasela a Claude.
    pause
    exit /b 1
  )
  echo listo> "node_modules\.bpos-instalado-v13"
  echo.
  echo  Actualizacion terminada.
)
echo  Arrancando B-POS... en unos segundos se abre el navegador.
echo  NO CIERRES ESTA VENTANA mientras uses B-POS.
echo.
start "" cmd /c "timeout /t 15 /nobreak & start http://localhost:3000"
call npm run dev
echo.
echo  B-POS se detuvo.
pause
