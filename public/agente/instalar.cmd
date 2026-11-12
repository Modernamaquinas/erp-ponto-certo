@echo off
rem Instala o agente de impressao do ERP Ponto Certo neste computador (inicia junto com o Windows, sem janela).
rem Uso: instalar.cmd            -> impressora \\127.0.0.1\L42
rem      instalar.cmd \\PC\L42   -> outra impressora compartilhada
setlocal
set "PASTA=%LOCALAPPDATA%\ERP Ponto Certo"
set "IMPRESSORA=%~1"
if "%IMPRESSORA%"=="" set "IMPRESSORA=\\127.0.0.1\L42"
if not exist "%PASTA%" mkdir "%PASTA%"
copy /y "%~dp0agente-impressao.ps1" "%PASTA%\agente-impressao.ps1" >nul
> "%PASTA%\iniciar-agente.vbs" echo CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%PASTA%\agente-impressao.ps1"" -Impressora ""%IMPRESSORA%""", 0, False
copy /y "%PASTA%\iniciar-agente.vbs" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ERP Ponto Certo - impressao.vbs" >nul
wscript "%PASTA%\iniciar-agente.vbs"
rem Pre-configura as impressoras da loja: Elgin L42 Pro Full (etiquetas, compartilhada como L42),
rem Epson TM-T20II (cupom, impressora padrao), HP Laser 107w (DANFE A4) e o atalho do caixa com impressao direta.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0configurar-impressoras.ps1" -Pasta "%PASTA%"
echo.
echo Agente de impressao instalado (impressora %IMPRESSORA%).
echo Ele inicia sozinho com o Windows. Teste: abra http://127.0.0.1:7172/status no navegador.
pause
