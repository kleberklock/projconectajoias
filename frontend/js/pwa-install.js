/**
 * ── PWA INSTALL & TUTORIAL MODAL (CONECTA JOIAS) ──
 * Script modular para gerenciamento do botão de instalação PWA
 * e modal tutorial para iOS / Android / Desktop.
 */

(function () {
  'use strict';

  // Registrar Service Worker se suportado
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      // Ajusta o caminho do SW dependendo de se estamos em pages/ ou na raiz
      const swPath = window.location.pathname.includes('/pages/') ? '../js/sw.js' : 'js/sw.js';
      navigator.serviceWorker.register(swPath).catch(err => {
        console.warn('Erro ao registrar ServiceWorker:', err);
      });
    });
  }

  let deferredPrompt = null;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  // Se já estiver rodando instalado como App PWA, não exibe o botão
  if (isStandalone) {
    return;
  }

  // Capturar evento de instalação nativa do Android/Desktop
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallPill();
  });

  // Aguarda DOM carregar para injetar elementos
  document.addEventListener('DOMContentLoaded', () => {
    // Se o pill já tiver sido fechado nesta sessão, podemos ocultar ou mostrar após timeout
    const isDismissed = sessionStorage.getItem('pwa-pill-dismissed');
    if (!isDismissed) {
      setTimeout(() => {
        showInstallPill();
      }, 1500);
    }
  });

  function showInstallPill() {
    if (document.getElementById('pwa-install-pill')) return;

    // Criar elemento da Pílula Flutuante
    const pill = document.createElement('div');
    pill.id = 'pwa-install-pill';
    pill.className = 'pwa-install-pill';
    pill.innerHTML = `
      <div class="pwa-pill-icon"><i class="fa-solid fa-mobile-screen-button"></i></div>
      <div class="pwa-pill-text">
        <span class="pwa-pill-title">Instalar Aplicativo</span>
        <span class="pwa-pill-sub">Usar na Tela Inicial</span>
      </div>
      <button class="pwa-pill-close" id="pwa-close-btn" aria-label="Fechar">&times;</button>
    `;

    document.body.appendChild(pill);
    injectTutorialModal();

    // Event Listeners
    pill.addEventListener('click', (e) => {
      if (e.target.id === 'pwa-close-btn' || e.target.parentElement.id === 'pwa-close-btn') {
        e.stopPropagation();
        dismissPill();
        return;
      }
      handleInstallClick();
    });
  }

  function dismissPill() {
    const pill = document.getElementById('pwa-install-pill');
    if (pill) {
      pill.style.opacity = '0';
      pill.style.transform = 'translateY(20px)';
      setTimeout(() => pill.remove(), 300);
    }
    sessionStorage.setItem('pwa-pill-dismissed', 'true');
  }

  function handleInstallClick() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          dismissPill();
        }
        deferredPrompt = null;
      });
    } else {
      // Dispositivo iOS ou navegadores sem prompt direto
      openTutorialModal();
    }
  }

  function injectTutorialModal() {
    if (document.getElementById('pwa-tutorial-modal')) return;

    const backdrop = document.createElement('div');
    backdrop.id = 'pwa-tutorial-modal';
    backdrop.className = 'pwa-tutorial-backdrop';
    backdrop.innerHTML = `
      <div class="pwa-tutorial-modal">
        <button class="pwa-modal-close" onclick="window.closePwaTutorial()">&times;</button>
        <div class="pwa-modal-header">
          <h3><i class="fa-solid fa-gem" style="color:var(--pwa-gold)"></i> Adicionar Conecta Joias</h3>
          <p>Instale o aplicativo na sua tela inicial para acesso rápido e direto</p>
        </div>

        <div class="pwa-device-tabs">
          <button class="pwa-device-tab ${isIOS ? 'active' : ''}" onclick="window.switchPwaTab('ios')">
            <i class="fa-brands fa-apple"></i> iPhone / iPad
          </button>
          <button class="pwa-device-tab ${!isIOS ? 'active' : ''}" onclick="window.switchPwaTab('android')">
            <i class="fa-brands fa-android"></i> Android
          </button>
          <button class="pwa-device-tab" onclick="window.switchPwaTab('desktop')">
            <i class="fa-solid fa-desktop"></i> PC / Mac
          </button>
        </div>

        <!-- Conteúdo Passo a Passo iOS -->
        <div class="pwa-steps-list" id="pwa-steps-ios" style="display: ${isIOS ? 'flex' : 'none'};">
          <div class="pwa-step-item">
            <div class="pwa-step-num">1</div>
            <div class="pwa-step-content">
              <h4>Toque em Compartilhar</h4>
              <p>No navegador Safari do seu iPhone, toque no ícone de <strong>Compartilhar <i class="fa-solid fa-arrow-up-from-bracket" style="color:var(--pwa-gold)"></i></strong> na barra inferior.</p>
            </div>
          </div>
          <div class="pwa-step-item">
            <div class="pwa-step-num">2</div>
            <div class="pwa-step-content">
              <h4>Selecione "Adicionar à Tela de Início"</h4>
              <p>Role o menu para baixo e toque em <strong>"Adicionar à Tela de Início <i class="fa-regular fa-square-plus" style="color:var(--pwa-gold)"></i>"</strong>.</p>
            </div>
          </div>
          <div class="pwa-step-item">
            <div class="pwa-step-num">3</div>
            <div class="pwa-step-content">
              <h4>Confirme a Instalação</h4>
              <p>Toque em <strong>"Adicionar"</strong> no canto superior direito. Pronto! O ícone estará na tela inicial.</p>
            </div>
          </div>
        </div>

        <!-- Conteúdo Passo a Passo Android -->
        <div class="pwa-steps-list" id="pwa-steps-android" style="display: ${!isIOS ? 'flex' : 'none'};">
          <div class="pwa-step-item">
            <div class="pwa-step-num">1</div>
            <div class="pwa-step-content">
              <h4>Abra o Menu do Chrome</h4>
              <p>No canto superior direito do seu navegador Android, toque nos <strong>3 pontinhos <i class="fa-solid fa-ellipsis-vertical" style="color:var(--pwa-gold)"></i></strong>.</p>
            </div>
          </div>
          <div class="pwa-step-item">
            <div class="pwa-step-num">2</div>
            <div class="pwa-step-content">
              <h4>Instalar Aplicativo</h4>
              <p>Selecione a opção <strong>"Instalar aplicativo"</strong> ou <strong>"Adicionar à tela inicial"</strong>.</p>
            </div>
          </div>
          <div class="pwa-step-item">
            <div class="pwa-step-num">3</div>
            <div class="pwa-step-content">
              <h4>Concluir</h4>
              <p>Confirme a mensagem do sistema. O aplicativo será adicionado ao seu celular automaticamente!</p>
            </div>
          </div>
        </div>

        <!-- Conteúdo Passo a Passo Desktop -->
        <div class="pwa-steps-list" id="pwa-steps-desktop" style="display: none;">
          <div class="pwa-step-item">
            <div class="pwa-step-num">1</div>
            <div class="pwa-step-content">
              <h4>Ícone na Barra de Endereço</h4>
              <p>No Chrome ou Edge do seu computador, procure pelo ícone de <strong>Computador com Seta <i class="fa-solid fa-download" style="color:var(--pwa-gold)"></i></strong> na barra de endereço.</p>
            </div>
          </div>
          <div class="pwa-step-item">
            <div class="pwa-step-num">2</div>
            <div class="pwa-step-content">
              <h4>Clique em Instalar</h4>
              <p>Clique no ícone e confirme a instalação do <strong>Conecta Joias</strong> no seu computador.</p>
            </div>
          </div>
        </div>

        <button class="pwa-modal-btn" onclick="window.closePwaTutorial()">Entendi!</button>
      </div>
    `;

    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', (e) => {
      if (e.target.id === 'pwa-tutorial-modal') {
        window.closePwaTutorial();
      }
    });
  }

  // Funções Globais expostas no window para os botões do modal
  window.openPwaTutorial = function () {
    const modal = document.getElementById('pwa-tutorial-modal');
    if (modal) modal.classList.add('active');
  };

  window.closePwaTutorial = function () {
    const modal = document.getElementById('pwa-tutorial-modal');
    if (modal) modal.classList.remove('active');
  };

  window.switchPwaTab = function (device) {
    document.querySelectorAll('.pwa-device-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('pwa-steps-ios').style.display = 'none';
    document.getElementById('pwa-steps-android').style.display = 'none';
    document.getElementById('pwa-steps-desktop').style.display = 'none';

    if (device === 'ios') {
      document.getElementById('pwa-steps-ios').style.display = 'flex';
      event.currentTarget.classList.add('active');
    } else if (device === 'android') {
      document.getElementById('pwa-steps-android').style.display = 'flex';
      event.currentTarget.classList.add('active');
    } else if (device === 'desktop') {
      document.getElementById('pwa-steps-desktop').style.display = 'flex';
      event.currentTarget.classList.add('active');
    }
  };

  function openTutorialModal() {
    window.openPwaTutorial();
  }
})();
