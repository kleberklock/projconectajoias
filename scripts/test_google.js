/**
 * Script de Teste Automatizado no Google com Puppeteer
 * 
 * Funcionalidades:
 * 1. Seletores resilientes atualizados para o layout atual do Google (textarea[name="q"], input[name="q"], etc.)
 * 2. Tempo de espera explícito (Explicit Waits) e suporte a cookies consent se visível.
 * 3. Encerramento seguro (Teardown) em bloco try/catch/finally para evitar processos órfãos.
 */

const puppeteer = require('puppeteer');

(async () => {
    console.log('==========================================================');
    console.log('   INICIANDO TESTE AUTOMATIZADO DE NAVEGAÇÃO NO GOOGLE    ');
    console.log('==========================================================\n');

    let browser = null;

    try {
        console.log('[1/5] Inicializando o navegador Chrome...');
        browser = await puppeteer.launch({
            headless: false, // Visualização da execução no navegador
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
        
        // Define timeout de navegação seguro (30s)
        page.setDefaultNavigationTimeout(30000);
        page.setDefaultTimeout(15000);

        console.log('[2/5] Navegando para https://www.google.com...');
        await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
        console.log('      Página carregada com sucesso.');

        // Tratar caixa de consentimento de cookies se aparecer
        try {
            const consentSelector = 'button:has-text("Aceitar tudo"), button:has-text("I agree"), #L2AGLb';
            const consentBtn = await page.$(consentSelector);
            if (consentBtn) {
                console.log('      Banner de consentimento detectado. Clicando em aceitar...');
                await consentBtn.click();
                await page.waitForTimeout?.(1000);
            }
        } catch (consentErr) {
            // Ignora se não houver banner de consentimento
        }

        console.log('[3/5] Localizando a caixa de pesquisa do Google (Seletores Atualizados)...');
        
        // Seletores resilientes para a caixa de busca do Google (suporta textarea e input)
        const searchSelectors = [
            'textarea[name="q"]',
            'input[name="q"]',
            'textarea[title="Pesquisar"]',
            'input[title="Pesquisar"]',
            '[aria-label="Pesquisar"]',
            '[aria-label="Search"]'
        ];

        let activeSelector = null;
        for (const selector of searchSelectors) {
            try {
                await page.waitForSelector(selector, { visible: true, timeout: 3000 });
                activeSelector = selector;
                console.log(`      Seletor localizado com sucesso: "${selector}"`);
                break;
            } catch (e) {
                // Tenta o próximo seletor
            }
        }

        if (!activeSelector) {
            throw new Error('Nenhum seletor válido foi encontrado para o campo de pesquisa do Google.');
        }

        console.log('[4/5] Interagindo com o elemento de busca (Explicit Wait + Digitação)...');
        // Garante que o elemento receba foco e clique explícito
        await page.focus(activeSelector);
        await page.click(activeSelector);
        
        // Digita com delay simulando interação humana
        const searchQuery = 'Conecta Joias Gestão de Revendedoras';
        console.log(`      Digitando a busca: "${searchQuery}"`);
        await page.type(activeSelector, searchQuery, { delay: 80 });

        // Aguarda estabilização antes de pressionar Enter
        await new Promise(res => setTimeout(res, 500));

        console.log('      Submetendo a pesquisa...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
            page.keyboard.press('Enter')
        ]);

        console.log('[5/5] Verificando os resultados de busca...');
        // Aguarda os resultados da pesquisa serem renderizados no DOM
        const resultsContainer = '#search, #rso, div.g';
        await page.waitForSelector(resultsContainer, { visible: true, timeout: 10000 });

        const title = await page.title();
        console.log(`      Título da página de resultados: "${title}"`);
        
        console.log('\n==========================================================');
        console.log('   TESTE CONCLUÍDO COM SUCESSO! A INTERAÇÃO FOI OK.      ');
        console.log('==========================================================\n');

    } catch (error) {
        console.error('\n❌ ERRO DURANTE A EXECUÇÃO DO TESTE:', error.message);
        console.error(error.stack);
    } finally {
        console.log('[TEARDOWN] Encerrando o processo do navegador...');
        if (browser) {
            try {
                await browser.close();
                console.log('[TEARDOWN] Navegador fechado de forma limpa e segura.');
            } catch (closeError) {
                console.error('[TEARDOWN ERRO] Falha ao fechar o navegador:', closeError.message);
            }
        }
    }
})();
