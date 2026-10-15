; HeroMarket installer additions (electron-builder NSIS include), 1.4.0.
;
; The bundled PostgreSQL programs need the Microsoft Visual C++ runtime (x64). A clean Windows does
; not have it, and the store's database could then not be created (initdb exits with 0xC0000135).
; The official, Microsoft-signed redistributable is shipped inside the installer and run silently
; only when the runtime is missing or older than the one shipped. The installer is per-machine
; (already elevated), so no extra prompt appears.

!macro customInstall
  ; Installed runtime version (0 when absent): HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64
  SetRegView 64
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ReadRegDWORD $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Major"
  SetRegView lastused
  ${If} $0 == 1
  ${AndIf} $1 >= 14
    DetailPrint "Microsoft Visual C++ runtime already installed."
  ${Else}
    DetailPrint "Installing the Microsoft Visual C++ runtime needed by the database..."
    File /oname=$PLUGINSDIR\vc_redist.x64.exe "${BUILD_RESOURCES_DIR}\vcredist\vc_redist.x64.exe"
    ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart' $2
    ; 0 = installed, 3010 = installed (restart later), 1638 = a newer version is already present.
    ${If} $2 != 0
    ${AndIf} $2 != 3010
    ${AndIf} $2 != 1638
      MessageBox MB_ICONEXCLAMATION|MB_OK "تعذر تثبيت مكونات Microsoft Visual C++ اللازمة لقاعدة البيانات (رمز $2). أعد تشغيل الجهاز ثم شغّل برنامج التثبيت مرة أخرى." /SD IDOK
    ${EndIf}
  ${EndIf}
!macroend
