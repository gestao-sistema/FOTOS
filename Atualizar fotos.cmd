@echo off
title Mural Azime - atualizar fotos
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0atualizar-fotos.ps1"
echo.
echo Pressione uma tecla para fechar.
pause >nul
