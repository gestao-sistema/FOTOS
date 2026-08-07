@echo off
title Mural Azime - painel
cd /d "%~dp0"

if not exist "node_modules\express" (
  echo Primeira vez: instalando o servidor, aguarde...
  call npm install express@4 multer@1 --no-audit --no-fund --loglevel=error
)

start "" http://localhost:5500/painel
node servidor.js

echo.
echo O servidor foi encerrado. Pressione uma tecla para fechar.
pause >nul
