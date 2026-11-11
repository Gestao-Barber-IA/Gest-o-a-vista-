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
schtasks /Create /F /TN "Gestao Barber IA - AppBarber" /SC HOURLY /MO 1 /ST 08:00 /ET 22:00 /TR "\"%~dp0sincronizar.bat\"" >nul
echo.
echo PRONTO! A sincronizacao vai rodar sozinha a cada 1 hora, das 8h as 22h.
echo Deixe este computador ligado e conectado na internet da barbearia.
pause
