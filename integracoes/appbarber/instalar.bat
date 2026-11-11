@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Gestao Barber IA - AppBarber
where node >nul 2>nul || (echo O Node.js nao esta instalado. Instale em https://nodejs.org e rode de novo. & pause & exit /b)
node sincronizar.mjs --configurar || (pause & exit /b)
echo ==== TESTE: buscando os numeros na AppBarber (nada e enviado) ====
node sincronizar.mjs --teste --diagnostico
if errorlevel 1 (echo. & echo Deu erro no teste. Tire um print desta tela e mande para o suporte. & pause & exit /b)
echo.
set /p OK=Os numeros estao certos? Digite S e Enter para ligar a sincronizacao automatica: 
if /i not "%OK%"=="S" (echo Nada foi ligado. Quando quiser, rode o instalar.bat de novo. & pause & exit /b)
node sincronizar.mjs
echo.
echo A sincronizacao roda a cada 10 minutos, so no horario de funcionamento.
echo Cada sincronizacao = 1 chamada na AppBarber. 10 horas por dia = 60 chamadas por dia (cerca de R$ 36 por mes).
set ABRE=09:00
set FECHA=19:00
set /p ABRE=Horario de ABERTURA (ex.: 09:00) [Enter = 09:00]: 
set /p FECHA=Horario de FECHAMENTO (ex.: 19:00) [Enter = 19:00]: 
schtasks /Create /F /TN "Gestao Barber IA - AppBarber" /SC MINUTE /MO 10 /ST %ABRE% /ET %FECHA% /TR "\"%~dp0sincronizar.bat\"" >nul
if errorlevel 1 (echo Nao consegui agendar. Confira os horarios no formato 09:00 e rode o instalar.bat de novo. & pause & exit /b)
echo.
echo PRONTO! A sincronizacao vai rodar sozinha a cada 10 minutos, das %ABRE% as %FECHA%.
echo Deixe este computador ligado e conectado na internet da barbearia.
pause
