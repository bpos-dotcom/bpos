!macro customInstall
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -File "$INSTDIR\resources\virtual-printer\install-virtual-printer.ps1"'
!macroend