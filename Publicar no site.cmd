@echo off
title Mural Azime - publicar no site
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publicar.ps1"
echo.
echo Pressione uma tecla para fechar.
pause >nul
