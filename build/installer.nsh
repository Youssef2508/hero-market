; HeroMarket installer additions (electron-builder NSIS include), 1.4.0.
;
; 1. The bundled PostgreSQL programs need the Microsoft Visual C++ runtime (x64). A clean Windows
;    does not have it (initdb then exits with 0xC0000135). The official, Microsoft-signed
;    redistributable is shipped inside the installer and run silently only when it is missing.
; 2. The store's database runs as a Windows service with its own account, set up by the program
;    itself (HeroMarket-POS.exe --setup-service, src/main/serviceSetup.js): Windows users cannot
;    open the database files or the superuser password (security review, option C).
; The installer is per-machine (already elevated), so no extra prompt appears.

!if "${PRODUCT_NAME}" == "HeroMarket POS QA"
  !define HM_SERVICE "HeroMarketDB-QA"
!else
  !define HM_SERVICE "HeroMarketDB"
!endif

; Before files are replaced: the service runs postgres.exe from the program folder.
!macro customInit
  nsExec::Exec 'net stop "${HM_SERVICE}"'
  Pop $0
!macroend

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

  ; The store's database service: created, or converted and updated (a verified copy of an existing
  ; database is taken first). Nothing is deleted.
  DetailPrint "Setting up the store database service..."
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --setup-service' $3
  ${If} $3 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "تعذر تجهيز قاعدة بيانات المتجر (رمز $3). لم يتم حذف أي بيانات. التفاصيل في الملف:$\r$\n%ProgramData%\HeroMarket\logs\setup.log" /SD IDOK
  ${EndIf}
!macroend

!macro customUnInstall
  ${If} ${isUpdated}
    ; An update: stop the service so the program files can be replaced; the new setup re-registers it.
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --stop-service' $0
  ${Else}
    ; Uninstall: remove the service. The store's data stays in %ProgramData%.
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --remove-service' $0
  ${EndIf}
!macroend
