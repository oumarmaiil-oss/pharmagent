@echo off
title Installation de PharmAgent
echo.
echo   PharmAgent - installation de l'agent local
echo   Ne fermez pas cette fenetre (1 a 3 minutes).
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { Invoke-RestMethod '__SERVER_URL__/install/windows.ps1' | Invoke-Expression } catch { Write-Host ''; Write-Host ('  ERREUR : ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"
if errorlevel 1 (
  echo.
  echo   L'installation a echoue. Prenez une photo de cet ecran et envoyez-la au support.
) else (
  echo.
  echo   Termine. Vous pouvez fermer cette fenetre.
)
echo.
pause
