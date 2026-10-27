; ED Exo Compare's portable launcher: electron-builder 26.8.1's templates/nsis/portable.nsi with one
; change (combined plan 1.6a, 2026-10-01; the stock script is unchanged through 26.18.0, checked 2026-10-27). scripts/dist-win.mjs copies it over the template before
; every build, because electron-builder reads the portable script from its own folder and has no
; option for another.
;
; The stock script deletes the unpack folder before it unpacks, and again after the app exits. With
; unpackDirName fixed ("EDExoPortable", so the Windows firewall rule keeps one path), that folder is
; the running copy's: starting the exe a second time, which now brings the running launcher back,
; deleted every file the running app had not locked (its web pages, its data), and the app answered
; 404 until it was restarted. Here, when the app in that folder is running (its exe cannot be opened
; for writing), the launcher just starts it again with the same arguments and leaves the folder alone:
; the running copy's single-instance lock brings its launcher forward and the new copy exits.
;
; Second change (discuss item 16, owner 2026-10-23): every start unpacked ~372 MB into %TEMP%, silently, which
; made the portable exe slow to start. Now a splash shows while it unpacks (portable.splashImage), and the folder is
; kept after the app exits: a start whose build stamp matches the one written in the folder, with its main files
; there, runs it as it is. A new build (another stamp), a folder Windows' clean-up thinned out, or a cut unpack
; (the stamp is written last) unpacks it fresh. The folder stays at ~372 MB in %TEMP%\EDExoPortable.
;
; "Thinned out" is counted (review 2026-10-24): the four main files survive a clean-up that deletes seldom-read ones
; (lazy web chunks, data files, the software-rendering DLL), and the damaged folder was run until the next build. The
; number of files is written beside the stamp after an unpack; a folder holding fewer is unpacked fresh. More is fine:
; the app writes its startup and crash logs there.

!include "common.nsh"
!include "extractAppPackage.nsh"

# https://github.com/electron-userland/electron-builder/issues/3972#issuecomment-505171582
CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}

Var EdexoRunning
Var EdexoFresh
Var EdexoCount

; This build, for the folder's stamp: set when the script is compiled, so every build differs.
!define /date EDEXO_BUILD_STAMP "%Y%m%d-%H%M%S"

Function .onInit
  !ifndef SPLASH_IMAGE
    SetSilent silent
  !endif

  !insertmacro check64BitAndSetRegView
FunctionEnd

Function .onGUIInit
  InitPluginsDir

  !ifdef SPLASH_IMAGE
    File /oname=$PLUGINSDIR\splash.bmp "${SPLASH_IMAGE}"
    BgImage::SetBg $PLUGINSDIR\splash.bmp
    BgImage::Redraw
  !endif
FunctionEnd

; Sets $EdexoRunning to 1 when the app's exe in $INSTDIR is in use (a running exe cannot be opened
; for writing), else 0.
Function EdexoCheckRunning
  StrCpy $EdexoRunning 0
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ClearErrors
    FileOpen $1 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" a
    ${If} ${Errors}
      StrCpy $EdexoRunning 1
    ${Else}
      FileClose $1
    ${EndIf}
  ${EndIf}
FunctionEnd

; Adds the files under the folder on the stack (and its subfolders) to $EdexoCount.
Function EdexoCountFiles
  Exch $R0
  Push $R1
  Push $R2
  ClearErrors
  FindFirst $R1 $R2 "$R0\*.*"
  loop:
    StrCmp $R2 "" done
    StrCmp $R2 "." next
    StrCmp $R2 ".." next
    IfFileExists "$R0\$R2\*.*" 0 isfile
      Push "$R0\$R2"
      Call EdexoCountFiles
      Goto next
    isfile:
      IntOp $EdexoCount $EdexoCount + 1
    next:
    ClearErrors
    FindNext $R1 $R2
    IfErrors done
    Goto loop
  done:
  FindClose $R1
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

; Sets $EdexoFresh to 1 when $INSTDIR already holds this build, whole: the stamp written last after
; an unpack, the files the app cannot start without, and at least as many files as the unpack left.
Function EdexoCheckFresh
  StrCpy $EdexoFresh 0
  ${If} ${FileExists} "$INSTDIR\.edexo-build"
  ${AndIf} ${FileExists} "$INSTDIR\.edexo-files"
  ${AndIf} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${AndIf} ${FileExists} "$INSTDIR\resources\app.asar"
  ${AndIf} ${FileExists} "$INSTDIR\resources\edexo\app.cjs"
    ClearErrors
    FileOpen $1 "$INSTDIR\.edexo-build" r
    ${IfNot} ${Errors}
      FileRead $1 $2
      FileClose $1
      ${If} $2 == "${EDEXO_BUILD_STAMP}"
        ClearErrors
        FileOpen $1 "$INSTDIR\.edexo-files" r
        ${IfNot} ${Errors}
          FileRead $1 $3
          FileClose $1
          IntOp $3 $3 + 0
          StrCpy $EdexoCount 0
          Push $INSTDIR
          Call EdexoCountFiles
          ; The two marker files are not part of the unpack.
          IntOp $EdexoCount $EdexoCount - 2
          ${If} $3 > 0
          ${AndIf} $EdexoCount >= $3
            StrCpy $EdexoFresh 1
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
FunctionEnd

Section
  !ifdef SPLASH_IMAGE
    HideWindow
  !endif

  StrCpy $INSTDIR "$PLUGINSDIR\app"
  !ifdef UNPACK_DIR_NAME
    StrCpy $INSTDIR "$TEMP\${UNPACK_DIR_NAME}"
  !endif

  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  ${StdUtils.GetAllParameters} $R0 0

  Call EdexoCheckRunning
  ${If} $EdexoRunning == 1
    ; Already running from here: hand over, keep its files.
    !ifdef SPLASH_IMAGE
      BgImage::Destroy
    !endif
    Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" $R0'
    SetOutPath $EXEDIR
    Return
  ${EndIf}

  Call EdexoCheckFresh
  ${If} $EdexoFresh == 1
    ; This build is already unpacked here: run it as it is.
    SetOutPath $INSTDIR
    Goto edexo_run
  ${EndIf}

  RMDir /r $INSTDIR
  SetOutPath $INSTDIR

  !ifdef APP_DIR_64
    !ifdef APP_DIR_ARM64
      !ifdef APP_DIR_32
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${elseif} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${else}
          File /r "${APP_DIR_64}\*.*"
        {endIf}
      !endif
    !else
      !ifdef APP_DIR_32
        ${if} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        File /r "${APP_DIR_64}\*.*"
      !endif
    !endif
  !else
    !ifdef APP_DIR_32
      File /r "${APP_DIR_32}\*.*"
    !else
      !insertmacro extractEmbeddedAppPackage
    !endif
  !endif

  ; How many files the unpack left, for the next start's check.
  StrCpy $EdexoCount 0
  Push $INSTDIR
  Call EdexoCountFiles
  FileOpen $1 "$INSTDIR\.edexo-files" w
  FileWrite $1 "$EdexoCount"
  FileClose $1

  ; Unpacked whole: the stamp goes last, so a cut unpack is never taken for a whole one.
  FileOpen $1 "$INSTDIR\.edexo-build" w
  FileWrite $1 "${EDEXO_BUILD_STAMP}"
  FileClose $1

  edexo_run:
  !ifdef SPLASH_IMAGE
    BgImage::Destroy
  !endif

	ExecWait "$INSTDIR\${APP_EXECUTABLE_FILENAME} $R0" $0
  SetErrorLevel $0

  ; The folder is kept for the next start (see the top).
  SetOutPath $EXEDIR
SectionEnd
