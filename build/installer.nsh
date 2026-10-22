; ============================================================================
; installer.nsh — the two things NSIS cannot work out on its own.
; ----------------------------------------------------------------------------
; Pulled in through `nsis.include` in electron-builder.yml.
;
; 1. EVERY flavour installs into the SAME directory. electron-builder derives it
;    from package.json `name` (appInfo.sanitizedName) for a per-user one-click
;    installer, and all eight share one package. So a clone app and this one end
;    up side by side in $LOCALAPPDATA\Programs\mockstream-desktop with separate
;    .exe files but one shared `resources\app.asar` — whoever installs last wins
;    and the other app launches the wrong code. Worse, either uninstaller then
;    removes the whole directory, taking the other app with it (measured
;    2026-10-22).
;
;    One build now serves every centre, so a student on a clone app should MOVE
;    rather than end up with both. This installer therefore uninstalls a clone
;    it finds before putting its own files down.
;
; 2. The app writes its own per-centre shortcuts at runtime (see
;    main/centreIdentity.ts) — NSIS never created them, so it does not know to
;    remove them. The app leaves their paths in a file for the uninstaller.
; ============================================================================

!include "TextFunc.nsh"

; The shared installation directory, spelled out rather than taken from $INSTDIR
; because customInit runs before $INSTDIR is settled.
!define MS_SHARED_DIR "$LOCALAPPDATA\Programs\${APP_FILENAME}"

; Uninstall one clone app, if it is there. Silent and per-user, the same
; switches its own shortcut uses.
;
; Two NSIS details worth keeping: the command is double-quoted with $\" around
; the path, because one centre is called "Muzaffar's English" and an apostrophe
; ends a '...' string mid-command; and the skip is a relative jump (+3 = past
; the two instructions below) rather than a label, because a label inside a
; macro inserted seven times would be defined seven times.
!macro msRemoveClone NAME
  IfFileExists "${MS_SHARED_DIR}\Uninstall ${NAME}.exe" 0 +3
  DetailPrint "Removing ${NAME} — one app now serves every centre..."
  ; --updated tells that uninstaller to leave user data alone. Every flavour
  ; shares one user-data folder (one package name), so without it a clone that
  ; deletes app data on uninstall would sign the student out of the very app
  ; they are moving to.
  ExecWait "$\"${MS_SHARED_DIR}\Uninstall ${NAME}.exe$\" /currentuser /S --updated"
!macroend

!macro customInit
  ; This runs on EVERY install of this app, update included, and that is on
  ; purpose — measured 2026-10-22, not assumed:
  ;
  ;   • A clone beside us does not survive either way. Before laying down its
  ;     files, the installer runs OUR OWN previous uninstaller, and that
  ;     uninstaller deletes the whole shared directory — the clone's exe and
  ;     its uninstaller with it.
  ;   • Without this macro that leaves corpses: the clone's Add/Remove-Programs
  ;     entry and its desktop and Start-menu shortcuts stay behind, pointing at
  ;     an executable that is gone.
  ;
  ; So the choice is not "remove the clone or leave it alone" — it is "remove it
  ; cleanly or leave wreckage". Hence no attempt to skip this on an update: two
  ; ways of detecting one were tried (electron-builder's ${isUpdated} and
  ; parsing --updated with ${GetOptions}) and neither held, and chasing a third
  ; would only have protected an install that dies regardless.
  !insertmacro msRemoveClone "Bekzods Multilevel"
  !insertmacro msRemoveClone "Cambridge Innovation School"
  !insertmacro msRemoveClone "Niners Academy"
  !insertmacro msRemoveClone "Global Education LC"
  !insertmacro msRemoveClone "Achievers Academy"
  !insertmacro msRemoveClone "Muzaffar's English"
  !insertmacro msRemoveClone "Multilevel Max"
!macroend

!macro customUnInstall
  ; Take back the shortcuts the app wrote for the picked centre. The file holds
  ; one full path per line and is written beside the app's own data, so it
  ; survives until here.
  StrCpy $0 "$APPDATA\${APP_FILENAME}\centre-shortcuts.txt"
  IfFileExists "$0" 0 msNoShortcutList
  ClearErrors
  FileOpen $1 "$0" r
  IfErrors msNoShortcutList
  msShortcutLoop:
    FileRead $1 $2
    IfErrors msShortcutsDone
    ${TrimNewLines} $2 $2
    StrCmp $2 "" msShortcutLoop
    Delete "$2"
    Goto msShortcutLoop
  msShortcutsDone:
    FileClose $1
    Delete "$0"
  msNoShortcutList:
!macroend
