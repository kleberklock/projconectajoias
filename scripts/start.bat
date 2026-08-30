@echo off
title Conecta Joias - Inicializador
echo ==========================================================
echo           INICIANDO CONECTA JOIAS (LOCAL)
echo ==========================================================
echo.

:: Define o diretorio raiz do projeto a partir da pasta scripts
pushd "%~dp0.."
set "ROOT_DIR=%CD%"
popd

echo [1/3] Iniciando o servidor Backend (Node.js) na porta 5000...
start "Conecta Joias Backend" /D "%ROOT_DIR%\server" cmd /k "npm run dev"

echo [2/3] Iniciando o servidor Frontend (http-server) na porta 8080...
start "Conecta Joias Frontend" /D "%ROOT_DIR%\frontend" cmd /k "npx --yes http-server -p 8080 -c-1"

echo [3/3] Aguardando inicializacao e abrindo o sistema no navegador...
ping 127.0.0.1 -n 4 >nul
start http://localhost:8080/

echo.
echo ==========================================================
echo Sistema pronto!
echo IMPORTANTE: Nao feche as janelas pretas (cmd) abertas.
echo Elas representam o backend e o frontend rodando.
echo ==========================================================
echo.
pause
