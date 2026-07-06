!macro customInstall
    ExecWait 'powershell.exe -ExecutionPolicy Bypass -File "$INSTDIR\resources\app\installer\install-printer.ps1"'
    ExecWait 'powershell.exe -ExecutionPolicy Bypass -File "$INSTDIR\resources\app\virtual-printer\install-virtual-printer.ps1"'
!macroend