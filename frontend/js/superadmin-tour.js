/**
 * Conecta Joias - Sistema Premium de Onboarding Tour (Tutorial Interativo)
 * Desenvolvido em JS Vanilla autossuficiente de nível Sênior.
 */

(function() {
  // Configuração dos passos do tour
  const tourSteps = [
    {
      elementSelector: '#btn-tab-dashboard',
      title: '💎 Painel Geral',
      description: 'Este é o seu centro de controle de luxo. Aqui você visualiza o resumo de faturamento da sua marca, gráficos analíticos de vendas, alertas de estoque crítico e visão geral.'
    },
    {
      elementSelector: '#btn-tab-meu-negocio',
      title: '📊 Meu Negócio',
      description: 'Monitore o Demonstrativo de Resultados do Exercício (DRE), margens de lucro, faturamento bruto/líquido e a saúde financeira completa da sua empresa em tempo real.'
    },
    {
      elementSelector: '#btn-tab-estoque',
      title: '📦 Estoque & Custos',
      description: 'Gerencie suas semijoias brutas. Cadastre peças, configure markups de banho, custos operacionais e defina automaticamente a margem de faturamento ideal de cada joia.'
    },
    {
      elementSelector: '#btn-tab-revendedoras',
      title: '👥 Rede de Revendedoras',
      description: 'Controle toda a sua rede de vendedoras externas. Distribua maletas consignadas, gere termos de responsabilidade digital e faça conferências e acertos em menos de 5 minutos.'
    },
    {
      elementSelector: '#btn-tab-clientes',
      title: '👥 Meus Clientes',
      description: 'Cadastro centralizado de clientes finais e histórico de compras. Monitore as preferências de consumo para campanhas direcionadas de marketing.'
    },
    {
      elementSelector: '#btn-tab-vendas-geral',
      title: '🧾 Histórico de Vendas',
      description: 'Visualize todas as vendas realizadas. Registre vendas administrativas diretas e consulte a forma de pagamento de cada transação.'
    },
    {
      elementSelector: '#btn-tab-notas-fiscais',
      title: '📄 Notas Fiscais',
      description: 'Geração ágil de notas fiscais eletrônicas de joias para vendedoras ou clientes finais, mantendo a conformidade fiscal do seu negócio sem burocracia.'
    },
    {
      elementSelector: '#btn-tab-central-whatsapp',
      title: '💬 Fila do WhatsApp',
      description: 'Comunique-se de forma profissional. Envie cobranças de parcelas, avisos de acerto pendente e termos de maleta diretamente no WhatsApp com um clique.'
    },
    {
      elementSelector: '#btn-tab-admin-treinamentos',
      title: '🎓 Treinamentos',
      description: 'Vídeos tutoriais rápidos e caprichados para capacitar você e sua equipe administrativa a usarem 100% do potencial da plataforma.'
    },
    {
      elementSelector: '#btn-tab-meu-plano-saas',
      title: '👑 Meu Plano & Assinaturas',
      description: 'Gerencie sua assinatura (Básico, Bronze, Gold ou Platinum), acompanhe seu consumo de cotas de produtos e revendedoras ou faça upgrade/downgrade a qualquer momento.'
    },
    {
      elementSelector: '#btn-tab-planilhas',
      title: '📊 Planilhas Excel',
      description: 'Importe seu estoque existente em segundos ou exporte relatórios consolidados em planilhas Excel de forma prática e segura.'
    }
  ];

  let currentStepIdx = 0;
  let backdropEl = null;
  let popoverEl = null;
  let clickBlockerEl = null;

  // Injetar estilos de luxo dinamicamente
  const styleEl = document.createElement('style');
  styleEl.innerHTML = `
    .tour-backdrop {
      position: absolute;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      background: transparent;
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.7);
      z-index: 999999;
      border-radius: 8px;
      pointer-events: auto;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    
    .tour-click-blocker {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 999998;
      background: transparent;
      pointer-events: auto;
      cursor: pointer;
    }
    
    .tour-popover {
      position: absolute;
      z-index: 1000000;
      background: rgba(18, 18, 18, 0.95);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--gold-primary);
      border-radius: 14px;
      padding: 1.25rem;
      width: 310px;
      box-shadow: 0 15px 40px rgba(0,0,0,0.8), 0 0 0 1px rgba(212,175,55,0.15);
      color: #fff;
      font-family: 'Montserrat', sans-serif;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      opacity: 0;
      transform: scale(0.95);
    }
    
    .tour-popover.active {
      opacity: 1;
      transform: scale(1);
    }
    
    .tour-popover-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.6rem;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      padding-bottom: 0.5rem;
    }
    
    .tour-popover h3 {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.3rem;
      color: var(--gold-primary);
      margin: 0;
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    
    .tour-skip-link {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 0.72rem;
      cursor: pointer;
      font-family: 'Montserrat', sans-serif;
      transition: var(--transition-fast);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 500;
    }
    
    .tour-skip-link:hover {
      color: #ef5350;
    }
    
    .tour-popover p {
      font-size: 0.82rem;
      color: #dfdfdf;
      line-height: 1.5;
      margin: 0 0 1rem;
      font-weight: 300;
    }
    
    .tour-popover-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 1rem;
      border-top: 1px solid rgba(255,255,255,0.05);
      padding-top: 0.8rem;
    }
    
    .tour-progress {
      font-size: 0.72rem;
      color: var(--text-muted);
      font-weight: 500;
    }
    
    .tour-buttons {
      display: flex;
      gap: 0.4rem;
    }
    
    .tour-btn {
      padding: 0.4rem 0.8rem;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 600;
      cursor: pointer;
      font-family: 'Montserrat', sans-serif;
      transition: all 0.2s ease;
    }
    
    .tour-btn-outline {
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #fff;
    }
    
    .tour-btn-outline:hover:not(:disabled) {
      border-color: var(--gold-primary);
      color: var(--gold-primary);
      background: rgba(212,175,55,0.05);
    }
    
    .tour-btn-outline:disabled {
      opacity: 0.25;
      cursor: not-allowed;
    }
    
    .tour-btn-gold {
      background: var(--gold-gradient);
      border: none;
      color: #050505;
      box-shadow: 0 4px 15px rgba(212, 175, 55, 0.15);
    }
    
    .tour-btn-gold:hover {
      box-shadow: 0 4px 15px rgba(212, 175, 55, 0.3);
      filter: brightness(1.1);
    }
    
    /* Setas direcionadoras do Popover */
    .tour-popover::before {
      content: '';
      position: absolute;
      border-width: 8px;
      border-style: solid;
      display: block;
      width: 0;
      height: 0;
      border-color: transparent rgba(18, 18, 18, 0.95) transparent transparent;
    }
    
    /* Posição Padrão (Direita) */
    .tour-popover::before {
      top: 50%;
      right: 100%;
      transform: translateY(-50%);
    }
    
    /* Ajustes responsivos mobile */
    @media (max-width: 768px) {
      .tour-popover {
        position: fixed !important;
        bottom: 1.5rem !important;
        left: 50% !important;
        top: auto !important;
        transform: translateX(-50%) scale(0.95) !important;
        width: calc(100% - 2rem) !important;
        max-width: 350px !important;
      }
      .tour-popover.active {
        transform: translateX(-50%) scale(1) !important;
      }
      .tour-popover::before {
        display: none !important;
      }
      .tour-backdrop {
        border-radius: 6px !important;
        box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.8) !important;
      }
    }
  `;
  document.head.appendChild(styleEl);

  // Inicializar elementos do Tour no DOM
  function createTourElements() {
    if (document.querySelector('.tour-backdrop')) return;

    // Blocker de cliques que encerra o tour ao clicar fora
    clickBlockerEl = document.createElement('div');
    clickBlockerEl.className = 'tour-click-blocker';
    clickBlockerEl.title = 'Clique para fechar o tutorial';
    clickBlockerEl.addEventListener('click', endTour);
    document.body.appendChild(clickBlockerEl);

    // Holofote spotlight que encerra o tour ao ser clicado
    backdropEl = document.createElement('div');
    backdropEl.className = 'tour-backdrop';
    backdropEl.addEventListener('click', endTour);
    document.body.appendChild(backdropEl);

    // Popover informativo
    popoverEl = document.createElement('div');
    popoverEl.className = 'tour-popover';
    popoverEl.innerHTML = `
      <div class="tour-popover-header">
        <h3 id="tour-title">Título</h3>
        <button class="tour-skip-link" id="tour-btn-skip"><i class="fa-solid fa-xmark"></i> Fechar</button>
      </div>
      <p id="tour-desc">Descrição explicativa...</p>
      <div class="tour-popover-footer">
        <span class="tour-progress" id="tour-progress-lbl">1 de 11</span>
        <div class="tour-buttons">
          <button class="tour-btn tour-btn-outline" id="tour-btn-prev"><i class="fa-solid fa-chevron-left"></i> Voltar</button>
          <button class="tour-btn tour-btn-gold" id="tour-btn-next">Próximo <i class="fa-solid fa-chevron-right"></i></button>
        </div>
      </div>
    `;
    document.body.appendChild(popoverEl);

    // Adicionar eventos aos botões do popover
    document.getElementById('tour-btn-skip').addEventListener('click', endTour);
    document.getElementById('tour-btn-prev').addEventListener('click', prevStep);
    document.getElementById('tour-btn-next').addEventListener('click', nextStep);
  }

  // Avançar passo
  function nextStep() {
    if (currentStepIdx < tourSteps.length - 1) {
      currentStepIdx++;
      renderStep(currentStepIdx);
    } else {
      endTour();
    }
  }

  // Voltar passo
  function prevStep() {
    if (currentStepIdx > 0) {
      currentStepIdx--;
      renderStep(currentStepIdx);
    }
  }

  let scrollListenerAttached = false;

  function updatePosition() {
    if (!backdropEl || !popoverEl || currentStepIdx < 0 || currentStepIdx >= tourSteps.length) return;
    const step = tourSteps[currentStepIdx];
    if (!step) return;
    const element = document.querySelector(step.elementSelector);
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    // 1. Posicionar o holofote
    backdropEl.style.left = `${rect.left + scrollX - 5}px`;
    backdropEl.style.top = `${rect.top + scrollY - 4}px`;
    backdropEl.style.width = `${rect.width + 10}px`;
    backdropEl.style.height = `${rect.height + 8}px`;

    // 2. Posicionar o popover (apenas em telas maiores que mobile)
    if (window.innerWidth > 768) {
      popoverEl.style.left = `${rect.right + 20 + scrollX}px`;
      const popoverHeight = popoverEl.offsetHeight || 220;
      let topPos = rect.top + scrollY + (rect.height / 2) - (popoverHeight / 2);
      popoverEl.style.top = `${Math.max(10, topPos)}px`;
    }
  }

  function attachScrollListeners() {
    if (scrollListenerAttached) return;
    window.addEventListener('scroll', updatePosition, { passive: true });
    window.addEventListener('resize', updatePosition, { passive: true });

    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.addEventListener('scroll', updatePosition, { passive: true });
    }
    scrollListenerAttached = true;
  }

  function detachScrollListeners() {
    window.removeEventListener('scroll', updatePosition);
    window.removeEventListener('resize', updatePosition);
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.removeEventListener('scroll', updatePosition);
    }
    scrollListenerAttached = false;
  }

  // Encerrar tour
  function endTour() {
    localStorage.setItem('conectajoias_tutorial_completo', 'true');
    detachScrollListeners();

    if (popoverEl) popoverEl.classList.remove('active');

    document.querySelectorAll('.tour-backdrop, .tour-popover, .tour-click-blocker').forEach(el => el.remove());

    backdropEl = null;
    popoverEl = null;
    clickBlockerEl = null;
  }
  window.endTour = endTour;

  // Renderizar o passo ativo
  function renderStep(idx) {
    createTourElements();
    attachScrollListeners();

    const step = tourSteps[idx];
    const element = document.querySelector(step.elementSelector);

    if (!element) {
      console.warn(`Elemento do tour não encontrado: ${step.elementSelector}. Avançando.`);
      nextStep();
      return;
    }

    // Scroll automático inteligente para colocar o elemento centralizado em tela (funciona na sidebar e na janela)
    try {
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    } catch (e) {
      element.scrollIntoView(true);
    }

    // Timeout para permitir que a animação de scroll termine antes de calcular as coordenadas finais
    setTimeout(() => {
      if (!backdropEl || !popoverEl) return;

      updatePosition();

      // Atualizar textos do popover
      const titleEl = document.getElementById('tour-title');
      const descEl = document.getElementById('tour-desc');
      const progressEl = document.getElementById('tour-progress-lbl');
      if (titleEl) titleEl.innerText = step.title;
      if (descEl) descEl.innerText = step.description;
      if (progressEl) progressEl.innerText = `${idx + 1} de ${tourSteps.length}`;

      // Habilitar/Desabilitar botões
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

      // Ativar animação de surgimento
      popoverEl.classList.add('active');

    }, 250);
  }

  // Inicializar o Onboarding Tour (Apenas quando disparado manualmente pelo usuário)
  window.initOnboardingTour = function(force = false) {
    // Se não for disparado manualmente pelo botão de tutorial, não exibe
    if (!force) return;

    currentStepIdx = 0;
    renderStep(0);
  };

  // Garante a remoção de qualquer elemento residual de tour ao carregar a página
  window.addEventListener('load', () => {
    localStorage.setItem('conectajoias_tutorial_completo', 'true');
    document.querySelectorAll('.tour-backdrop, .tour-popover, .tour-click-blocker').forEach(el => el.remove());
  });

})();
