@echo off
title Mural Azime
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar-mural.ps1"
echo.
echo Pressione uma tecla para fechar.
pause >nul
