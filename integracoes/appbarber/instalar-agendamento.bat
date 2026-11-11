@echo off
rem Agenda a sincronizacao a cada 1 hora, das 8h as 22h, todos os dias.
cd /d "%~dp0"
schtasks /Create /F /TN "Gestao Barber IA - AppBarber" /SC HOURLY /MO 1 /ST 08:00 /ET 22:00 /TR "\"%~dp0sincronizar.bat\""
echo.
echo Pronto! A sincronizacao vai rodar sozinha a cada 1 hora.
pause
