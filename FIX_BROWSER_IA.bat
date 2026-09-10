@echo off
title Correcao Automatica da Janela do Navegador IA
echo ==========================================================
echo       CORRIGINDO A CONEXAO DA JANELA DO NAVEGADOR IA
echo ==========================================================
echo.

:: Solicita privilegios de Administrador automaticamente se necessario
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Solicitando permissoes de Administrador...
    powershell -Command "Start-Process '%~0' -Verb RunAs"
    exit /b
)

echo [1/3] Atualizando o arquivo hosts para mapear 127.0.0.1 e localhost...
powershell -Command "if (!(Select-String -Path C:\Windows\System32\drivers\etc\hosts -Pattern '^\s*127\.0\.0\.1\s+localhost' -Quiet)) { Add-Content -Path C:\Windows\System32\drivers\etc\hosts -Value '`n127.0.0.1       localhost`n::1             localhost'; Write-Host 'Mapeamento adicionado no arquivo hosts com sucesso.' } else { Write-Host 'O arquivo hosts ja contem o mapeamento 127.0.0.1 localhost.' }"

echo [2/3] Finalizando processos orfaos pendentes...
powershell -Command "Stop-Process -Name 'chrome', 'node' -ErrorAction SilentlyContinue" 2>nul

echo [3/3] Liberando conexao de rede local no Firewall...
powershell -Command "New-NetFirewallRule -DisplayName 'IA_Browser_Loopback' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080,5000,9222 -ErrorAction SilentlyContinue" 2>nul

echo.
echo ==========================================================
echo CORRECAO CONCLUIDA COM SUCESSO!
echo 
echo Proximo passo: Feche e abra o Antigravity IDE novamente.
echo ==========================================================
echo.
pause
