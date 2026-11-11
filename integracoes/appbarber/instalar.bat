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
node sincronizar.mjs --agora
schtasks /Create /F /TN "Gestao Barber IA - AppBarber" /SC MINUTE /MO 10 /TR "\"%~dp0sincronizar.bat\"" >nul
if errorlevel 1 (echo Nao consegui agendar. Rode o instalar.bat clicando com o botao direito e "Executar como administrador". & pause & exit /b)
echo.
echo PRONTO! A sincronizacao roda a cada 10 minutos, SO no horario de funcionamento
echo definido no app: Configuracoes - Indicadores e metas - Regra da taxa de ocupacao (abertura e fechamento).
echo Fora desse horario ela nao chama a AppBarber e nao gasta creditos.
echo Deixe este computador ligado e conectado na internet da barbearia.
echo.
echo ==== CARGA INICIAL DAS COMANDAS ====
echo Le de uma vez as comandas deste mes (do dia 1 ate hoje), no ritmo maximo
echo permitido pela AppBarber (1.000 por hora). Os numeros vao sendo atualizados no app durante a carga.
set CG=S
set /p CG=Fazer a carga inicial agora? [Enter = S]: 
if /i "%CG%"=="S" node sincronizar.mjs --carga
pause
