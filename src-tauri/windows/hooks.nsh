!ifdef NSIS_HOOK_PREINSTALL
!undef NSIS_HOOK_PREINSTALL
!endif
!macro NSIS_HOOK_PREINSTALL
  
!macroend

!ifdef NSIS_HOOK_POSTINSTALL
!undef NSIS_HOOK_POSTINSTALL
!endif
!macro NSIS_HOOK_POSTINSTALL
  StrCpy $0 "$INSTDIR"
  StrCpy $1 "$PROGRAMFILES"
  StrCpy $2 "$PROGRAMFILES64"
  StrCpy $4 "HKCU"
  StrLen $7 $1
  StrLen $8 $2
  StrCpy $9 $0 $7
  StrCmp $9 $1 0 +3
    StrCpy $4 "HKLM"
    Goto +3
  StrCpy $9 $0 $8
  StrCmp $9 $2 0 +2
    StrCpy $4 "HKLM"

  StrCpy $5 ""
  StrCpy $6 ""
  ${If} "$4" == "HKLM"
    ReadRegStr $5 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  ${Else}
    ReadRegStr $5 HKCU "Environment" "Path"
  ${EndIf}

  StrCmp $5 "" 0 +2
    StrCpy $5 "$INSTDIR"
    Goto +2
  StrCpy $6 "$5;$INSTDIR"
  ${If} "$4" == "HKLM"
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$6"
  ${Else}
    WriteRegExpandStr HKCU "Environment" "Path" "$6"
  ${EndIf}
  System::Call 'USER32::SendMessageTimeoutW(i 0xffff, i 0x1a, i 0, w "Environment", i 0x0002, i 5000, *i .r0)'
!macroend

!ifdef NSIS_HOOK_PREUNINSTALL
!undef NSIS_HOOK_PREUNINSTALL
!endif
!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $0 "$INSTDIR"
  StrCpy $1 "$PROGRAMFILES"
  StrCpy $2 "$PROGRAMFILES64"
  StrCpy $4 "HKCU"
  StrLen $7 $1
  StrLen $8 $2
  StrCpy $9 $0 $7
  StrCmp $9 $1 0 +3
    StrCpy $4 "HKLM"
    Goto +3
  StrCpy $9 $0 $8
  StrCmp $9 $2 0 +2
    StrCpy $4 "HKLM"
  ${If} "$4" == "HKLM"
    ReadRegStr $5 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  ${Else}
    ReadRegStr $5 HKCU "Environment" "Path"
  ${EndIf}
  StrCpy $6 "$5"
  Push "$6"
  Push ";$INSTDIR"
  Push ";"
  Call StrReplace
  Pop $6
  Push "$6"
  Push "$INSTDIR;"
  Push ";"
  Call StrReplace
  Pop $6
  Push "$6"
  Push "$INSTDIR"
  Push ""
  Call StrReplace
  Pop $6
  ${If} "$4" == "HKLM"
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$6"
  ${Else}
    WriteRegExpandStr HKCU "Environment" "Path" "$6"
  ${EndIf}
  System::Call 'USER32::SendMessageTimeoutW(i 0xffff, i 0x1a, i 0, w "Environment", i 0x0002, i 5000, *i .r0)'
!macroend

!ifdef NSIS_HOOK_POSTUNINSTALL
!undef NSIS_HOOK_POSTUNINSTALL
!endif
!macro NSIS_HOOK_POSTUNINSTALL
  
!macroend

Function StrReplace
  Exch $R2
  Exch
  Exch $R1
  Exch
  Exch $R0
  StrCpy $R3 ""
  StrLen $R4 $R0
  StrLen $R5 $R1
  StrCpy $R6 0
  loop:
    StrCpy $R7 $R0 $R5 $R6
    StrCmp $R7 $R1 0 next
    StrCpy $R3 "$R3$R2"
    IntOp $R6 $R6 + $R5
    Goto loopend
    next:
      StrCpy $R7 $R0 1 $R6
      StrCpy $R3 "$R3$R7"
      IntOp $R6 $R6 + 1
    loopend:
    StrCmp $R6 $R4 0 loop
  StrCpy $R8 $R3
  Pop $R9
  Exch $R8
FunctionEnd
