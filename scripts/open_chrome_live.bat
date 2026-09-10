@echo off
title Teste do Conecta Joias no Chrome
echo ==========================================================
echo   ABRINDO A JANELA DO CHROME NA SUA TELA (SESSÃO ATIVA)
echo ==========================================================
echo.
cd /d "%~dp0.."
start "Conecta Joias Chrome Test" cmd /c "node scripts/test_live_demo.js & pause"
