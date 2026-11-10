/**
 * Conecta Joias - Módulo de Tutorial Interativo (Onboarding Tour)
 * Arquitetura Vanilla JS com Design de Alto Padrão (Dark Mode & Gold Glow)
 */

(function() {
  // Passos alinhados estritamente com as abas e componentes reais do SuperAdmin
  const tourSteps = [
    {
      elementSelector: '#btn-tab-dashboard',
      title: '💎 Painel Geral',
      description: 'Bem-vinda ao seu centro de controle! Aqui você acompanha o faturamento consolidado da sua marca, métricas de vendas, alertas de estoque crítico e o desempenho das suas peças em tempo real.'
    },
    {
      elementSelector: '#btn-tab-meu-negocio',
      title: '📊 Meu Negócio & DRE',
      description: 'Monitore o Demonstrativo de Resultados do Exercício (DRE), lucros líquidos, custos de mercadorias e a saúde financeira completa da sua empresa com filtros por período.'
    },
    {
      elementSelector: '#btn-tab-estoque',
      title: '📦 Estoque & Precificação',
      description: 'Cadastre suas semijoias, aplique custos brutos, banhos de ouro/prata e defina automaticamente o markup de venda de cada peça com precificação precisa e controle de defeitos.'
    },
    {
      elementSelector: '#btn-tab-historico-movimentacoes',
      title: '🔄 Movimentações de Estoque',
      description: 'Rastreie todo o fluxo do seu inventário: entradas de fornecedores, saídas em maletas consignadas, retornos de acertos e baixas de avarias com histórico auditável.'
    },
    {
      elementSelector: '#btn-tab-revendedoras',
      title: '👥 Gestão de Revendedoras',
      description: 'Gerencie sua força de vendas externa. Crie maletas de consignação, defina regras de comissão progressiva ou meta única e faça acertos rápidos de forma transparente.'
    },
    {
      elementSelector: '#btn-tab-clientes',
      title: '📇 Carteira de Clientes',
      description: 'Cadastro completo de clientes finais com controle de datas de aniversário, canais de contato e histórico individual de compras.'
    },
    {
      elementSelector: '#btn-tab-vendas-geral',
      title: '🧾 Histórico de Vendas',
      description: 'Consulte todas as vendas realizadas pelas revendedoras ou pelo balcão administrativo, com detalhamento de formas de pagamento (Pix, Dinheiro, Cartão ou Link).'
    },
    {
      elementSelector: '#btn-tab-notas-fiscais',
      title: '📄 Emissão de Notas Fiscais',
      description: 'Gere notas fiscais eletrônicas de joias com agilidade para acompanhar maletas ou documentar vendas com conformidade fiscal.'
    },
    {
      elementSelector: '#btn-tab-planilhas',
      title: '📊 Planilhas & Importação Excel',
      description: 'Importe lotes inteiros de semijoias via planilha CSV/Excel ou exporte relatórios consolidados do seu negócio em segundos.'
    },
    {
      elementSelector: '#btn-tab-meu-plano-saas',
      title: '👑 Meu Plano & Assinatura',
      description: 'Gerencie o plano ativo da sua marca (Básico, Bronze, Gold ou Platinum), visualize suas cotas de produtos e faça upgrades sob demanda.'
    },
    {
      elementSelector: '#btn-tab-configuracoes',
      title: '⚙️ Identidade Visual da Marca',
      description: 'Personalize o sistema no formato White-Label: envie a logotipo da sua loja, selecione suas cores exclusivas e configure o WhatsApp comercial da sua empresa.'
    }
  ];

  let currentStepIdx = 0;
  let backdropEl = null;
  let popoverEl = null;
  let clickBlockerEl = null;
  let scrollListenerAttached = false;

  // Injeção de Estilos CSS do Tour
  const styleEl = document.createElement('style');
  styleEl.id = 'estilos-onboarding-tour-premium';
  styleEl.innerHTML = `
    .tour-backdrop {
      position: absolute;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      background: transparent;
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.78);
      z-index: 999990;
      border-radius: 10px;
      pointer-events: auto;
      border: 2px solid var(--gold-primary, #d4af37);
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.78), 0 0 25px rgba(212, 175, 55, 0.6);
      transition: all 0.35s cubic-bezier(0.25, 1, 0.5, 1);
      cursor: pointer;
    }

    .tour-click-blocker {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 999985;
      background: transparent;
    }

    .tour-popover {
      position: absolute;
      z-index: 999999;
      background: linear-gradient(165deg, #1c1c1c 0%, #101010 100%);
      border: 1px solid rgba(212, 175, 55, 0.45);
      border-radius: 16px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.9), 0 0 30px rgba(212, 175, 55, 0.15);
      padding: 1.4rem 1.6rem;
      width: 380px;
      max-width: 90vw;
      color: #fff;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      opacity: 0;
      transform: translateY(10px) scale(0.97);
      transition: opacity 0.3s ease, transform 0.3s ease;
      pointer-events: auto;
    }

    .tour-popover.active {
      opacity: 1;
      transform: translateY(0) scale(1);
    }

    .tour-popover-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.8rem;
      padding-bottom: 0.6rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .tour-popover-header h3 {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--gold-primary, #d4af37);
      margin: 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .tour-skip-link {
      background: transparent;
      border: none;
      color: var(--text-muted, #888);
      cursor: pointer;
      font-size: 0.78rem;
      padding: 4px 8px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: color 0.2s;
    }

    .tour-skip-link:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.08);
    }

    .tour-popover p {
      font-size: 0.86rem;
      line-height: 1.55;
      color: var(--text-secondary, #cccccc);
      margin: 0 0 1.2rem 0;
    }

    .tour-popover-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .tour-progress {
      font-size: 0.75rem;
      color: var(--gold-light, #f3e5ab);
      font-weight: 700;
      letter-spacing: 0.5px;
      background: rgba(212, 175, 55, 0.1);
      padding: 3px 8px;
      border-radius: 12px;
      border: 1px solid rgba(212, 175, 55, 0.2);
    }

    .tour-buttons {
      display: flex;
      gap: 0.5rem;
    }

    .tour-btn {
      padding: 0.48rem 0.95rem;
      border-radius: 8px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.2s ease;
    }

    .tour-btn-outline {
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #ddd;
    }

    .tour-btn-outline:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
    }

    .tour-btn-outline:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    .tour-btn-gold {
      background: var(--gold-gradient, linear-gradient(135deg, #d4af37 0%, #aa7c11 100%));
      border: none;
      color: #000;
      font-weight: 700;
      box-shadow: 0 2px 10px rgba(212, 175, 55, 0.35);
    }

    .tour-btn-gold:hover {
      box-shadow: 0 4px 16px rgba(212, 175, 55, 0.55);
      transform: translateY(-1px);
    }

    @media (max-width: 768px) {
      .tour-popover {
        position: fixed !important;
        bottom: 1.5rem !important;
        left: 50% !important;
        top: auto !important;
        transform: translateX(-50%) scale(0.96) !important;
        width: calc(100% - 2rem) !important;
        max-width: 360px !important;
      }
      .tour-popover.active {
        transform: translateX(-50%) scale(1) !important;
      }
    }
  `;
  document.head.appendChild(styleEl);

  function createTourElements() {
    if (document.querySelector('.tour-backdrop')) return;

    clickBlockerEl = document.createElement('div');
    clickBlockerEl.className = 'tour-click-blocker';
    clickBlockerEl.title = 'Clique para fechar o tutorial';
    clickBlockerEl.addEventListener('click', endTour);
    document.body.appendChild(clickBlockerEl);

    backdropEl = document.createElement('div');
    backdropEl.className = 'tour-backdrop';
    backdropEl.title = 'Elemento em destaque';
    backdropEl.addEventListener('click', endTour);
    document.body.appendChild(backdropEl);

    popoverEl = document.createElement('div');
    popoverEl.className = 'tour-popover';
    popoverEl.innerHTML = `
      <div class="tour-popover-header">
        <h3 id="tour-title">Título</h3>
        <button class="tour-skip-link" id="tour-btn-skip"><i class="fa-solid fa-xmark"></i> Fechar</button>
      </div>
      <p id="tour-desc">Descrição explicativa...</p>
      <div class="tour-popover-footer">
        <span class="tour-progress" id="tour-progress-lbl">1 de ${tourSteps.length}</span>
        <div class="tour-buttons">
          <button class="tour-btn tour-btn-outline" id="tour-btn-prev"><i class="fa-solid fa-chevron-left"></i> Anterior</button>
          <button class="tour-btn tour-btn-gold" id="tour-btn-next">Próximo <i class="fa-solid fa-chevron-right"></i></button>
        </div>
      </div>
    `;
    document.body.appendChild(popoverEl);

    document.getElementById('tour-btn-skip').addEventListener('click', endTour);
    document.getElementById('tour-btn-prev').addEventListener('click', prevStep);
    document.getElementById('tour-btn-next').addEventListener('click', nextStep);
  }

  function nextStep() {
    if (currentStepIdx < tourSteps.length - 1) {
      currentStepIdx++;
      renderStep(currentStepIdx);
    } else {
      endTour();
    }
  }

  function prevStep() {
    if (currentStepIdx > 0) {
      currentStepIdx--;
      renderStep(currentStepIdx);
    }
  }

  function updatePosition() {
    if (!backdropEl || !popoverEl || currentStepIdx < 0 || currentStepIdx >= tourSteps.length) return;
    const step = tourSteps[currentStepIdx];
    if (!step) return;
    const element = document.querySelector(step.elementSelector);
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    // Posicionar spotlight
    backdropEl.style.left = `${rect.left + scrollX - 6}px`;
    backdropEl.style.top = `${rect.top + scrollY - 4}px`;
    backdropEl.style.width = `${rect.width + 12}px`;
    backdropEl.style.height = `${rect.height + 8}px`;

    // Posicionar popover
    if (window.innerWidth > 768) {
      popoverEl.style.left = `${rect.right + 20 + scrollX}px`;
      const popoverHeight = popoverEl.offsetHeight || 220;
      let topPos = rect.top + scrollY + (rect.height / 2) - (popoverHeight / 2);
      popoverEl.style.top = `${Math.max(15, topPos)}px`;
    }
  }

  function attachScrollListeners() {
    if (scrollListenerAttached) return;
    window.addEventListener('scroll', updatePosition, { passive: true });
    window.addEventListener('resize', updatePosition, { passive: true });
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.addEventListener('scroll', updatePosition, { passive: true });
    scrollListenerAttached = true;
  }

  function detachScrollListeners() {
    window.removeEventListener('scroll', updatePosition);
    window.removeEventListener('resize', updatePosition);
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.removeEventListener('scroll', updatePosition);
    scrollListenerAttached = false;
  }

  function endTour() {
    localStorage.setItem('conectajoias_tutorial_completo', 'true');
    sessionStorage.removeItem('conectajoias_iniciar_tour_imediato');
    detachScrollListeners();

    if (popoverEl) popoverEl.classList.remove('active');
    document.querySelectorAll('.tour-backdrop, .tour-popover, .tour-click-blocker').forEach(el => el.remove());

    backdropEl = null;
    popoverEl = null;
    clickBlockerEl = null;
  }
  window.endTour = endTour;

  function renderStep(idx) {
    createTourElements();
    attachScrollListeners();

    const step = tourSteps[idx];
    const element = document.querySelector(step.elementSelector);

    if (!element) {
      console.warn(`Elemento do tour não encontrado no DOM: ${step.elementSelector}. Avançando para o próximo.`);
      if (idx < tourSteps.length - 1) {
        currentStepIdx = idx + 1;
        renderStep(currentStepIdx);
      } else {
        endTour();
      }
      return;
    }

    try {
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    } catch (e) {
      element.scrollIntoView(true);
    }

    setTimeout(() => {
      if (!backdropEl || !popoverEl) return;

      updatePosition();

      const titleEl = document.getElementById('tour-title');
      const descEl = document.getElementById('tour-desc');
      const progressEl = document.getElementById('tour-progress-lbl');

      if (titleEl) titleEl.innerHTML = step.title;
      if (descEl) descEl.innerText = step.description;
      if (progressEl) progressEl.innerText = `${idx + 1} de ${tourSteps.length}`;

      const btnPrev = document.getElementById('tour-btn-prev');
      const btnNext = document.getElementById('tour-btn-next');

      if (btnPrev) btnPrev.disabled = idx === 0;
      if (btnNext) {
        if (idx === tourSteps.length - 1) {
          btnNext.innerHTML = 'Concluir <i class="fa-solid fa-check"></i>';
        } else {
          btnNext.innerHTML = 'Próximo <i class="fa-solid fa-chevron-right"></i>';
        }
      }

      popoverEl.classList.add('active');
    }, 280);
  }

  // Inicializar o Onboarding Tour
  window.initOnboardingTour = function(force = false) {
    currentStepIdx = 0;
    renderStep(0);
  };
  window.iniciarTutorialInterativo = window.initOnboardingTour;

  // Lógica de Gatilho / Acionamento
  function verificarGatilhoTour() {
    const usuarioJson = localStorage.getItem("conectajoias_usuario");
    if (!usuarioJson) return;

    try {
      const usuario = JSON.parse(usuarioJson);
      const roleUpper = (usuario.role || "").toUpperCase();
      // O tour administrativo é destinado a gestoras (Manager ou SuperAdmin da loja)
      if (roleUpper !== "MANAGER" && roleUpper !== "SUPERADMIN") {
        return;
      }
    } catch(e) {
      return;
    }

    // 1. Prioridade Máxima: Acionamento Imediato pós-criação da conta
    const tourImediato = sessionStorage.getItem("conectajoias_iniciar_tour_imediato") === "true";
    
    // 2. Primeiro Login do Usuário / Loja
    const jaConcluiu = localStorage.getItem("conectajoias_tutorial_completo");

    if (tourImediato || !jaConcluiu) {
      console.log("✨ [Onboarding Tour] Acionando tutorial interativo da plataforma Conecta Joias...");
      setTimeout(() => {
        window.initOnboardingTour(true);
      }, 900);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(verificarGatilhoTour, 600);
    });
  } else {
    setTimeout(verificarGatilhoTour, 600);
  }

})();
