/**
 * Teste Automatizado Completo do Sistema Conecta Joias via Puppeteer no Chrome
 * 
 * Etapas do Teste:
 * 1. Inicialização do navegador Chrome em modo visual.
 * 2. Validação da Landing Page principal (http://localhost:8080/).
 * 3. Validação da Página de Apresentação (http://localhost:8080/pages/apresentacao.html).
 * 4. Interação com a Tela de Login (http://localhost:8080/pages/login.html), preenchimento de campos e submissão.
 * 5. Validação do Painel da Gestora / Manager (http://localhost:8080/pages/manager.html).
 * 6. Encerramento seguro (Teardown em bloco try/finally).
 */

const puppeteer = require('puppeteer');

(async () => {
    console.log('==========================================================');
    console.log('   INICIANDO TESTE AUTOMATIZADO DO CONECTA JOIAS (CHROME) ');
    console.log('==========================================================\n');

    let browser = null;

    try {
        console.log('[1/6] Inicializando o navegador Chrome...');
        browser = await puppeteer.launch({
            headless: false, // Abre a janela do navegador no ambiente do usuário
            defaultViewport: null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--start-maximized',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(30000);
        page.setDefaultTimeout(15000);

        // --- ETAPA 1: Página Inicial (Landing Page) ---
        console.log('\n[2/6] Testando a Página Inicial (http://localhost:8080/)...');
        await page.goto('http://localhost:8080/', { waitUntil: 'domcontentloaded' });
        const homeTitle = await page.title();
        console.log(`      ✓ Página Inicial carregada. Título: "${homeTitle}"`);
        await new Promise(r => setTimeout(r, 1000));

        // --- ETAPA 2: Página de Apresentação ---
        console.log('\n[3/6] Testando a Página de Apresentação (http://localhost:8080/pages/apresentacao.html)...');
        await page.goto('http://localhost:8080/pages/apresentacao.html', { waitUntil: 'domcontentloaded' });
        const aprTitle = await page.title();
        console.log(`      ✓ Página de Apresentação carregada. Título: "${aprTitle}"`);
        await new Promise(r => setTimeout(r, 1000));

        // --- ETAPA 3: Tela de Login Premium ---
        console.log('\n[4/6] Testando a Tela de Login (http://localhost:8080/pages/login.html)...');
        await page.goto('http://localhost:8080/pages/login.html', { waitUntil: 'domcontentloaded' });
        
        console.log('      Aguardando seletores do formulário de login...');
        await page.waitForSelector('#login-email', { visible: true });
        await page.waitForSelector('#login-senha', { visible: true });
        await page.waitForSelector('#btn-executar-login', { visible: true });

        console.log('      Preenchendo e-mail de teste...');
        await page.focus('#login-email');
        await page.type('#login-email', 'admin@conectajoias.com', { delay: 60 });

        console.log('      Preenchendo senha de teste...');
        await page.focus('#login-senha');
        await page.type('#login-senha', '123456', { delay: 60 });

        console.log('      Clicando no botão "Entrar na Plataforma"...');
        await page.click('#btn-executar-login');
        await new Promise(r => setTimeout(r, 1500));
        console.log('      ✓ Interação no formulário de login executada com sucesso.');

        // --- ETAPA 4: Painel da Gestora (Manager) ---
        console.log('\n[5/6] Testando o Painel da Gestora (http://localhost:8080/pages/manager.html)...');
        await page.goto('http://localhost:8080/pages/manager.html', { waitUntil: 'domcontentloaded' });
        const managerTitle = await page.title();
        console.log(`      ✓ Painel da Gestora carregado. Título: "${managerTitle}"`);

        // Testar navegação interna do Painel da Gestora se houver abas
        try {
            const estoqueBtn = await page.$('.nav-item[data-tab="estoque"], a[href="#estoque"]');
            if (estoqueBtn) {
                console.log('      Clicando na aba de Estoque do Painel...');
                await estoqueBtn.click();
                await new Promise(r => setTimeout(r, 800));
            }
        } catch (e) {
            // Ignora se navegação de abas for via script interno
        }

        console.log('\n==========================================================');
        console.log('   TESTE DO SISTEMA CONECTA JOIAS CONCLUÍDO COM SUCESSO!  ');
        console.log('==========================================================\n');

    } catch (error) {
        console.error('\n❌ ERRO DURANTE O TESTE DO SISTEMA:', error.message);
        console.error(error.stack);
    } finally {
        console.log('[TEARDOWN] Encerrando o navegador de testes...');
        if (browser) {
            try {
                await browser.close();
                console.log('[TEARDOWN] Navegador encerrado com segurança.');
            } catch (closeErr) {
                console.error('[TEARDOWN ERRO] Falha ao fechar o navegador:', closeErr.message);
            }
        }
    }
})();
