; Instalador de B-POS Agent (B-POS 2.0). electron-builder agrega esto al NSIS.
; Se instala para toda la computadora (pide permiso de administrador una
; vez), porque la impresora virtual lo necesita.
;
; Al actualizar desde B-POS 1.x (o desde cualquier versión) el instalador
; primero quita la versión anterior y luego instala esta: no hace falta
; desinstalar nada a mano y los datos de la PC se conservan.

!macro customInstall
  ; Impresora virtual por donde llegan los tickets de Rappi/Uber/DiDi
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\virtual-printer\install-virtual-printer.ps1"'
  ; B-POS 1.x abría el puerto 3000 para los celulares de la red: ya no se usa
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="B-POS"'
  ; Restos del sistema local de B-POS 1.x
  RMDir /r "$INSTDIR\resources\web"
!macroend

!macro customUnInstall
  ; Al actualizar no se quita nada: solo en una desinstalación de verdad
  ${ifNot} ${isUpdated}
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\virtual-printer\uninstall-virtual-printer.ps1"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="B-POS"'
    ; Inicio automático con Windows
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.burgerplanet.bposagent"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "B-POS"
    MessageBox MB_YESNO|MB_ICONQUESTION "¿Borrar también los registros y archivos locales de B-POS Agent en esta computadora?$\r$\n$\r$\nTus ventas, productos e inventario están en la nube y no se borran." /SD IDNO IDNO bpos_keep_data
      ; Instalación para toda la PC: $APPDATA apuntaría a ProgramData; los datos son del usuario
      SetShellVarContext current
      RMDir /r "$APPDATA\B-POS"
      RMDir /r "$PROFILE\.bpos"
      SetShellVarContext all
    bpos_keep_data:
  ${endIf}
!macroend
