@echo off
title Mural Azime - preparar fotos
cd /d "%~dp0"

if not exist "node_modules\sharp" (
  echo Primeira vez: instalando, aguarde...
  call npm install --no-audit --no-fund --loglevel=error
)

node preparar.js

echo.
echo Pressione uma tecla para fechar.
pause >nul
