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

; Before anything changes. Full paths: a tool found first on PATH must never run with the
; installer's administrator rights.
!macro customInit
  ; HeroMarket open on ANY Windows account (switch user included): stop here, nothing changed. An
  ; update while someone sells would cut their database connection mid-sale.
  nsExec::ExecToStack '"$SYSDIR\cmd.exe" /c ""$SYSDIR\tasklist.exe" /NH /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" | "$SYSDIR\findstr.exe" /I /C:"${APP_EXECUTABLE_FILENAME}""'
  Pop $0
  Pop $1
  ${If} $0 == 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "برنامج HeroMarket مفتوح الآن على هذا الجهاز (ربما على حساب Windows آخر).$\r$\nأغلقه على كل الحسابات، ثم شغّل برنامج التثبيت مرة أخرى. لم يتم تغيير أي شيء." /SD IDOK
    SetErrorLevel 4
    Quit
  ${EndIf}
  ; The service runs postgres.exe from the program folder: stop it before files are replaced.
  nsExec::Exec '"$SYSDIR\net.exe" stop "${HM_SERVICE}"'
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
    ; Setup failed: say so, end the installer with an error and do NOT start the program (it would
    ; only show that the store is not prepared). Running the installer again repairs it.
    MessageBox MB_ICONSTOP|MB_OK "لم يكتمل تثبيت HeroMarket: تعذر تجهيز قاعدة بيانات المتجر (رمز $3).$\r$\nلم يتم حذف أو تغيير أي بيانات.$\r$\nشغّل برنامج التثبيت مرة أخرى، وإذا تكرر الخطأ أرسل للدعم الفني الملف:$\r$\n%ProgramData%\HeroMarket\logs\setup.log" /SD IDOK
    SetErrorLevel 3
    Quit
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
