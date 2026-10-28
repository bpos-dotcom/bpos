; Instalador de B-POS (bloque 13). electron-builder agrega esto al NSIS.
; Se instala para toda la computadora (pide permiso de administrador una
; vez), porque la impresora virtual y el firewall lo necesitan.

!macro customInstall
  ; Impresora virtual por donde llegan los tickets de Rappi/Uber/DiDi
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\virtual-printer\install-virtual-printer.ps1"'
  ; Que los celulares y tablets de la red puedan abrir B-POS (puerto 3000)
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="B-POS"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="B-POS" dir=in action=allow protocol=TCP localport=3000 profile=private,domain'
!macroend

!macro customUnInstall
  ; Al actualizar no se quita nada: solo en una desinstalación de verdad
  ${ifNot} ${isUpdated}
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\virtual-printer\uninstall-virtual-printer.ps1"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="B-POS"'
    ; Inicio automático con Windows
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.burgerplanet.bposagent"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "B-POS"
    MessageBox MB_YESNO|MB_ICONQUESTION /SD IDNO "¿Borrar también los registros y archivos locales de B-POS en esta computadora?$\r$\n$\r$\nTus ventas, productos e inventario están en la nube y no se borran." IDNO bpos_keep_data
      ; Instalación para toda la PC: $APPDATA apuntaría a ProgramData; los datos son del usuario
      SetShellVarContext current
      RMDir /r "$APPDATA\B-POS"
      RMDir /r "$PROFILE\.bpos"
      SetShellVarContext all
    bpos_keep_data:
  ${endIf}
!macroend
