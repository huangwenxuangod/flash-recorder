!ifdef NSIS_HOOK_PREINSTALL
!undef NSIS_HOOK_PREINSTALL
!endif
!macro NSIS_HOOK_PREINSTALL
  
!macroend

!ifdef NSIS_HOOK_POSTINSTALL
!undef NSIS_HOOK_POSTINSTALL
!endif
!macro NSIS_HOOK_POSTINSTALL
!macroend

!ifdef NSIS_HOOK_PREUNINSTALL
!undef NSIS_HOOK_PREUNINSTALL
!endif
!macro NSIS_HOOK_PREUNINSTALL
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

Function un.StrReplace
  Exch $R2
  Exch
  Exch $R1
  Exch
  Exch $R0
  StrCpy $R3 ""
  StrLen $R4 $R0
  StrLen $R5 $R1
  StrCpy $R6 0
  loop_un:
    StrCpy $R7 $R0 $R5 $R6
    StrCmp $R7 $R1 0 next_un
    StrCpy $R3 "$R3$R2"
    IntOp $R6 $R6 + $R5
    Goto loopend_un
    next_un:
      StrCpy $R7 $R0 1 $R6
      StrCpy $R3 "$R3$R7"
      IntOp $R6 $R6 + 1
    loopend_un:
    StrCmp $R6 $R4 0 loop_un
  StrCpy $R8 $R3
  Pop $R9
  Exch $R8
FunctionEnd
