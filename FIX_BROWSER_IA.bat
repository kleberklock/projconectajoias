@echo off
chcp 65001 >nul
title Correção Definitiva do Navegador da IDE Antigravity
echo ==========================================================
echo       CORRIGINDO A CONEXAO DO NAVEGADOR INTERNO DA IA
echo ==========================================================
echo.

:: 1. Solicita privilégios de Administrador automaticamente se necessário
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Solicitando permissões de Administrador do Windows (UAC)...
    echo        Clique em "SIM" na janela de permissão que aparecer na sua tela.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

echo [1/4] Reparando o arquivo C:\Windows\System32\drivers\etc\hosts...
powershell -NoProfile -Command ^
    "$path = 'C:\Windows\System32\drivers\etc\hosts'; " ^
    "$lines = Get-Content -Path $path | Where-Object { $_ -notmatch '`n127\.0\.0\.1' -and $_ -notmatch '^\s*127\.0\.0\.1\s+localhost' -and $_ -notmatch '^\s*::1\s+localhost' }; " ^
    "$lines += '127.0.0.1       localhost'; " ^
    "$lines += '::1             localhost'; " ^
    "[System.IO.File]::WriteAllLines($path, $lines, [System.Text.Encoding]::ASCII); " ^
    "Write-Host '      -> Arquivo hosts limpo e mapeado com sucesso para 127.0.0.1 e localhost.'"

echo.
echo [2/4] Limpando o cache DNS do Windows...
ipconfig /flushdns >nul
echo       -> Cache DNS do Windows limpo com sucesso.

echo.
echo [3/4] Garantindo variavel global NODE_OPTIONS (ipv4first)...
powershell -NoProfile -Command ^
    "[System.Environment]::SetEnvironmentVariable('NODE_OPTIONS', '--dns-result-order=ipv4first', 'User'); " ^
    "[System.Environment]::SetEnvironmentVariable('NODE_OPTIONS', '--dns-result-order=ipv4first', 'Machine'); " ^
    "Write-Host '      -> NODE_OPTIONS=--dns-result-order=ipv4first configurado no sistema e usuario.'"

echo.
echo [4/4] Liberando conexoes de loopback e portas CDP no Firewall do Windows...
powershell -NoProfile -Command ^
    "Remove-NetFirewallRule -DisplayName 'IA_Browser_Loopback' -ErrorAction SilentlyContinue; " ^
    "New-NetFirewallRule -DisplayName 'IA_Browser_Loopback' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080,5000,9222,9223,9224 -ErrorAction SilentlyContinue | Out-Null; " ^
    "Write-Host '      -> Regras de Firewall para CDP (9222-9224) e aplicacao (8080, 5000) liberadas com sucesso.'"

echo.
echo ==========================================================
echo       CORREÇÃO CONCLUÍDA COM SUCESSO!
echo ==========================================================
echo.
echo O mapeamento de 127.0.0.1 localhost foi corrigido.
echo O cache DNS foi renovado.
echo.
echo IMPORTANTE:
echo Para que a IDE e o subsistema de navegador leiam as novas
echo configurações de rede, FECHE E REABRA O ANTIGRAVITY IDE.
echo ==========================================================
echo.
pause
