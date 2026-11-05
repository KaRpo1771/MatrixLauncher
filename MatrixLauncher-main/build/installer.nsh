; Оформление установщика MatrixL (подключается через nsis.include в package.json)
!macro customHeader
  BrandingText "MatrixL"
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Добро пожаловать в MatrixL"
  !define MUI_WELCOMEPAGE_TEXT "Лаунчер Minecraft с каталогом модов, плагинов и сборок.$\r$\n$\r$\nУстановка займёт меньше минуты. Нажмите «Далее», чтобы продолжить."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstall
  DetailPrint "Готово: MatrixL установлен"
!macroend
