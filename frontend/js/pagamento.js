/**
 * Conecta Joias - Checkout de Pagamento Script (Real Integration with ASAAS)
 */

function getApiBaseUrl() {
  const hostname = window.location.hostname;
  const port = window.location.port;
  const isDevPort = ["5500", "8080", "3000", "5501", "5000"].includes(port);
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || /^192\.168\./.test(hostname) || /^10\./.test(hostname);

  if (isDevPort || isLocalHost) {
    return `${window.location.protocol}//${hostname}:5000/api`;
  }

  if (typeof app !== "undefined" && app.state && app.state.apiUrl) {
    return app.state.apiUrl;
  }
  const savedUrl = localStorage.getItem("conectajoias_api_url");
  if (savedUrl) return savedUrl;

  return `${window.location.origin}/api`;
}

const API_BASE_URL = getApiBaseUrl();

const checkout = {
  linkId: null,
  valor: 0,
  dadosLink: null,

  init: function() {
    this.carregarLinkId();
    this.registrarAcoes();
    
    if (this.linkId) {
      this.carregarDadosLink();
    } else {
      const planosSection = document.getElementById("planos-selection-section");
      const summarySection = document.querySelector(".payment-summary");
      const tabsSection = document.querySelector(".payment-tabs");
      const tabContents = document.querySelectorAll(".tab-content");
      
      if (planosSection) planosSection.style.display = "block";
      if (summarySection) summarySection.style.display = "none";
      if (tabsSection) tabsSection.style.display = "none";
      tabContents.forEach(c => c.style.display = "none");
    }
  },

  carregarLinkId: function() {
    const params = new URLSearchParams(window.location.search);
    this.linkId = params.get("id");
  },

  registrarAcoes: function() {
    // Alternar Abas
    const tabs = document.querySelectorAll(".pay-tab");
    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");

        const targetTab = tab.getAttribute("data-tab");
        document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
        document.getElementById(`tab-content-${targetTab}`).classList.add("active");

        // Se clicar na aba PIX e não estiver gerado ainda, gera automaticamente
        if (targetTab === "pix" && this.dadosLink && !this.dadosLink.asaasPaymentId) {
          this.gerarPixAutomatico();
        }
      });
    });

    // Máscaras de Entrada do Cartão
    const expiry = document.getElementById("card-expiry");
    if (expiry) {
      expiry.addEventListener("input", (e) => {
        let value = e.target.value.replace(/\D/g, "");
        if (value.length > 4) value = value.slice(0, 4);
        if (value.length > 2) {
          e.target.value = `${value.slice(0, 2)}/${value.slice(2)}`;
        } else {
          e.target.value = value;
        }
      });
    }

    const cardNum = document.getElementById("card-number");
    if (cardNum) {
      cardNum.addEventListener("input", (e) => {
        let value = e.target.value.replace(/\D/g, "");
        if (value.length > 16) value = value.slice(0, 16);
        let parts = [];
        for (let i = 0; i < value.length; i += 4) {
          parts.push(value.substring(i, i + 4));
        }
        e.target.value = parts.join(" ");
      });
    }

    // Máscara de CEP
    const cep = document.getElementById("card-cep");
    if (cep) {
      cep.addEventListener("input", (e) => {
        let value = e.target.value.replace(/\D/g, "");
        if (value.length > 8) value = value.slice(0, 8);
        if (value.length > 5) {
          e.target.value = `${value.slice(0, 5)}-${value.slice(5)}`;
        } else {
          e.target.value = value;
        }
      });
    }

    // Máscaras de CPF
    const aplicarMascaraCpf = (inputEl) => {
      if (!inputEl) return;
      inputEl.addEventListener("input", (e) => {
        let value = e.target.value.replace(/\D/g, "");
        if (value.length > 14) value = value.slice(0, 14); // CPF ou CNPJ
        
        if (value.length <= 11) {
          // CPF: 000.000.000-00
          if (value.length > 9) {
            e.target.value = `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6, 9)}-${value.slice(9)}`;
          } else if (value.length > 6) {
            e.target.value = `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6)}`;
          } else if (value.length > 3) {
            e.target.value = `${value.slice(0, 3)}.${value.slice(3)}`;
          } else {
            e.target.value = value;
          }
        } else {
          // CNPJ: 00.000.000/0000-00
          if (value.length > 12) {
            e.target.value = `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`;
          } else if (value.length > 8) {
            e.target.value = `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8)}`;
          } else {
            e.target.value = value;
          }
        }
      });
    };

    aplicarMascaraCpf(document.getElementById("card-cpf"));
    aplicarMascaraCpf(document.getElementById("boleto-cpf"));
  },

  toast: function(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `custom-toast ${type} show`;
    
    let icon = "fa-circle-info";
    if (type === "success") icon = "fa-circle-check";
    if (type === "error") icon = "fa-circle-xmark";
    if (type === "warning") icon = "fa-triangle-exclamation";

    toast.innerHTML = `
      <i class="fa-solid ${icon}"></i>
      <span class="custom-toast-message">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  },

  carregarDadosLink: async function() {
    try {
      const response = await fetch(`${API_BASE_URL}/public/pagamento/${this.linkId}`);
      if (!response.ok) {
        throw new Error("Não foi possível carregar os dados do link.");
      }

      const linkData = await response.json();
      this.dadosLink = linkData;
      this.valor = linkData.valor;

      // Preenche dados do recebedor/cliente na interface
      document.getElementById("pay-valor").innerText = `R$ ${linkData.valor.toFixed(2)}`;
      document.getElementById("pay-vendedora").innerText = linkData.usuario ? linkData.usuario.nome : "Conecta Joias";
      document.getElementById("pay-cliente").innerText = linkData.cliente ? linkData.cliente.nome : "Cliente Consumidor";

      // Se já estiver PAGO, redireciona para a tela de sucesso
      if (linkData.status === "PAGO") {
        this.exibirSucesso(this.linkId);
        return;
      }

      // Preenche os campos do pagador se já estiverem cadastrados no banco local
      if (linkData.cliente) {
        const boletoNome = document.getElementById("boleto-nome");
        if (boletoNome) boletoNome.value = linkData.cliente.nome || "";
        const cardEmail = document.getElementById("card-email");
        if (cardEmail) cardEmail.value = linkData.cliente.email || "";
        const boletoEmail = document.getElementById("boleto-email");
        if (boletoEmail) boletoEmail.value = linkData.cliente.email || "";
      }

      // Se já tiver gerado PIX anteriormente e reabriu a página
      if (linkData.asaasPaymentId && linkData.formaEnvio === "PIX" && linkData.pixQrCode) {
        this.renderizarPix(linkData.pixQrCode, linkData.pixCopiaCola);
      } else {
        // Gera PIX por padrão logo no início se o método padrão for PIX ou se não houver pagamento gerado ainda
        this.gerarPixAutomatico();
      }

      // Se já tiver gerado Boleto anteriormente
      if (linkData.asaasPaymentId && linkData.formaEnvio === "BOLETO" && linkData.boletoLinhaDigitavel) {
        this.renderizarBoleto(linkData.boletoLinhaDigitavel, linkData.asaasInvoiceUrl);
      }

      // Iniciar polling para checar se o pagamento foi confirmado via webhook ou simulação
      if (linkData.status === "PENDENTE") {
        this.iniciarPollingStatus();
      }

    } catch (error) {
      this.toast(error.message, "error");
    }
  },

  pollingTimer: null,

  iniciarPollingStatus: function() {
    if (this.pollingTimer) return;
    this.pollingTimer = setInterval(async () => {
      if (!this.linkId) return;
      try {
        const response = await fetch(`${API_BASE_URL}/public/pagamento/${this.linkId}`);
        if (response.ok) {
          const data = await response.json();
          if (data.status === "PAGO") {
            this.pararPolling();
            this.toast("Pagamento confirmado com sucesso!", "success");
            this.exibirSucesso(this.linkId);
          }
        }
      } catch (err) {
        console.warn("Erro no polling de pagamento:", err.message);
      }
    }, 4000);
  },

  pararPolling: function() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  },

  gerarPixAutomatico: async function() {
    const loadingEl = document.getElementById("pix-loading-section");
    const contentEl = document.getElementById("pix-content-section");
    if (!loadingEl || !contentEl) return;

    // Se já estiver renderizado, não gera de novo
    if (contentEl.style.display === "block") return;

    try {
      loadingEl.style.display = "block";
      contentEl.style.display = "none";

      const res = await fetch(`${API_BASE_URL}/public/pagamento/${this.linkId}/processar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formaEnvio: "PIX",
          clienteNome: this.dadosLink.cliente ? this.dadosLink.cliente.nome : "Cliente Conecta Joias",
          clienteWhatsapp: this.dadosLink.cliente ? this.dadosLink.cliente.whatsapp : ""
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao processar PIX no ASAAS");
      }

      this.renderizarPix(data.pixQrCode, data.pixCopiaCola);
      
      // Atualiza estado local
      this.dadosLink.asaasPaymentId = data.asaasPaymentId;
      this.dadosLink.formaEnvio = "PIX";

    } catch (error) {
      this.toast(error.message, "error");
      loadingEl.innerHTML = `<i class="fa-solid fa-circle-xmark" style="font-size: 2.5rem; color: #ef5350;"></i>
        <p style="margin-top: 1rem; color: #ef5350; font-size: 0.85rem;">Falha ao obter PIX do ASAAS.<br>${error.message}</p>`;
    }
  },

  renderizarPix: function(qrCodeBase64, copiaCola) {
    const loadingEl = document.getElementById("pix-loading-section");
    const contentEl = document.getElementById("pix-content-section");
    const qrImg = document.getElementById("pix-qr-img");
    const codeText = document.getElementById("pix-code-text");

    if (loadingEl) loadingEl.style.display = "none";
    if (contentEl) contentEl.style.display = "block";
    
    if (qrImg) {
      // Se já vier com cabeçalho de data url, usa direto, senão adiciona
      qrImg.src = qrCodeBase64.startsWith("data:") ? qrCodeBase64 : `data:image/png;base64,${qrCodeBase64}`;
    }
    if (codeText) {
      codeText.innerText = copiaCola;
    }
  },

  renderizarBoleto: function(linhaDigitavel, pdfUrl) {
    const inputSec = document.getElementById("boleto-input-section");
    const resultSec = document.getElementById("boleto-result-section");
    const codeText = document.getElementById("boleto-barcode-text");
    const pdfLink = document.getElementById("boleto-pdf-link");

    if (inputSec) inputSec.style.display = "none";
    if (resultSec) resultSec.style.display = "block";

    if (codeText) codeText.innerText = linhaDigitavel;
    if (pdfLink) {
      pdfLink.href = pdfUrl;
      pdfLink.target = "_blank";
    }
  },

  exibirSucesso: function(id) {
    this.pararPolling();
    document.getElementById("checkout-main-content").style.display = "none";
    document.getElementById("success-id").innerText = id.toUpperCase();
    document.getElementById("success-date").innerText = new Date().toLocaleString("pt-BR");
    document.getElementById("payment-success-content").classList.add("active");
  }
};

// Ações Globais chamadas pelo HTML

function copiarPix() {
  const code = document.getElementById("pix-code-text").innerText.trim();
  if (!code || code === "-") return;
  navigator.clipboard.writeText(code).then(() => {
    checkout.toast("Código PIX Copia e Cola copiado!", "success");
  });
}

function copiarBoleto() {
  const code = document.getElementById("boleto-barcode-text").innerText.trim();
  if (!code || code === "-") return;
  navigator.clipboard.writeText(code).then(() => {
    checkout.toast("Código de barras do boleto copiado!", "success");
  });
}

// Emissão de Boleto Real
async function gerarBoletoReal(e) {
  e.preventDefault();
  
  const nome = document.getElementById("boleto-nome").value.trim();
  const cpf = document.getElementById("boleto-cpf").value.trim();
  const email = document.getElementById("boleto-email").value.trim();

  if (!nome || !cpf || !email) {
    checkout.toast("Preencha todos os campos para gerar o boleto.", "warning");
    return;
  }

  const btn = document.getElementById("btn-submit-boleto");
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Emitindo...`;

  try {
    const res = await fetch(`${API_BASE_URL}/public/pagamento/${checkout.linkId}/processar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        formaEnvio: "BOLETO",
        clienteNome: nome,
        clienteCpfCnpj: cpf,
        clienteEmail: email
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Erro ao emitir boleto");
    }

    checkout.toast("Boleto emitido com sucesso!", "success");
    checkout.renderizarBoleto(data.boletoLinhaDigitavel, data.invoiceUrl);

  } catch (error) {
    checkout.toast(error.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// Processamento de Cartão Real
async function confirmarCartaoReal(e) {
  e.preventDefault();

  const holder = document.getElementById("card-holder").value.trim();
  const number = document.getElementById("card-number").value.trim();
  const expiry = document.getElementById("card-expiry").value.trim();
  const cvv = document.getElementById("card-cvv").value.trim();
  const cpf = document.getElementById("card-cpf").value.trim();
  const email = document.getElementById("card-email").value.trim();
  const cep = document.getElementById("card-cep").value.trim();
  const numero = document.getElementById("card-num-end").value.trim();

  if (!holder || !number || !expiry || !cvv || !cpf || !email || !cep || !numero) {
    checkout.toast("Por favor, preencha todos os dados solicitados.", "warning");
    return;
  }

  const partsExpiry = expiry.split("/");
  if (partsExpiry.length !== 2) {
    checkout.toast("Validade do cartão inválida. Use MM/AA.", "warning");
    return;
  }

  const btn = document.getElementById("btn-submit-cartao");
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Processando pagamento...`;

  try {
    const res = await fetch(`${API_BASE_URL}/public/pagamento/${checkout.linkId}/processar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        formaEnvio: "CARTAO",
        clienteNome: holder,
        clienteCpfCnpj: cpf,
        clienteEmail: email,
        cartaoDados: {
          holderName: holder,
          number: number,
          expiryMonth: partsExpiry[0],
          expiryYear: "20" + partsExpiry[1], // MM/AA -> MM/20AA
          cvv: cvv
        },
        enderecoDados: {
          cep: cep,
          numero: numero
        }
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Pagamento recusado pela operadora.");
    }

    if (data.status === "PAGO") {
      checkout.toast("Pagamento aprovado com sucesso!", "success");
      checkout.exibirSucesso(checkout.linkId);
    } else {
      checkout.toast("A transação está pendente de análise no ASAAS.", "info");
    }

  } catch (error) {
    checkout.toast(error.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

/**
 * Inicia o checkout de assinatura via Mercado Pago Checkout Pro
 * @param {string} planoNome - Nome do plano selecionado (ex: "Plano Bronze", "Plano Gold", "Plano Platinum")
 * @param {number|string} preco - Valor mensal do plano
 * @param {Event} [event] - Evento acionado pelo clique no botão
 */
async function assinarPlano(planoNome, preco, event) {
  let btn = null;
  let originalHtml = "";

  if (event) {
    if (event.currentTarget) btn = event.currentTarget;
    else if (event.target) btn = event.target.closest("button") || event.target;
  }

  // 1. Desabilita o botão clicado e altera o texto para "Processando..."
  if (btn) {
    originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Processando...`;
  }

  try {
    // 2. Recupera o ID do usuário logado (armazenado no localStorage após login)
    let usuarioId = null;
    const usuarioRaw = localStorage.getItem("conectajoias_usuario") || localStorage.getItem("usuario");
    
    if (usuarioRaw) {
      try {
        const usuarioObj = JSON.parse(usuarioRaw);
        usuarioId = usuarioObj.id || usuarioObj._id || usuarioObj.usuarioId;
      } catch (e) {
        console.warn("Erro ao converter usuário de localStorage:", e);
      }
    }

    if (!usuarioId) {
      usuarioId = localStorage.getItem("conectajoias_usuario_id") || localStorage.getItem("usuario_id");
    }

    if (!usuarioId) {
      const lojaRaw = localStorage.getItem("conectajoias_loja");
      if (lojaRaw) {
        try {
          const lojaObj = JSON.parse(lojaRaw);
          if (lojaObj.id) usuarioId = lojaObj.id;
        } catch (e) {}
      }
    }

    if (!usuarioId) {
      const token = localStorage.getItem("conectajoias_token");
      if (token && token.includes(".")) {
        try {
          const payloadBase64 = token.split(".")[1];
          const payloadDecoded = JSON.parse(atob(payloadBase64));
          if (payloadDecoded && payloadDecoded.id) {
            usuarioId = payloadDecoded.id;
          }
        } catch (e) {}
      }
    }

    if (!usuarioId) {
      const planoClean = (planoNome || "gold").toLowerCase().includes("bronze") ? "bronze" : ((planoNome || "gold").toLowerCase().includes("platinum") ? "platinum" : "gold");
      localStorage.setItem("plano_selecionado", planoClean);
      const isPagesDir = window.location.pathname.includes("/pages/");
      const loginUrl = (isPagesDir ? "login.html" : "pages/login.html") + "?cadastro=true&plano=" + encodeURIComponent(planoClean);
      window.location.href = loginUrl;
      return;
    }

    // 3. Verifica se pode abrir o modal de Upgrade Pro Rata (estilo PS Plus)
    const planoClean = (planoNome || "gold").toLowerCase().includes("bronze") ? "BRONZE" : ((planoNome || "gold").toLowerCase().includes("platinum") ? "PLATINUM" : "GOLD");
    
    try {
      await exibirModalUpgradeProRata(planoClean, usuarioId);
      return;
    } catch (e) {
      console.warn("Fallback para fluxo normal de pagamento:", e);
    }

    // 4. Faz a requisição POST para a rota /api/criar-pagamento
    const response = await fetch(`${getApiBaseUrl()}/criar-pagamento`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        usuarioId,
        planoNome,
        preco: Number(preco)
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Erro ao gerar assinatura.");
    }

    // 5. Redireciona para o link de checkout
    if (data && data.linkDePagamento) {
      window.location.href = data.linkDePagamento;
    } else {
      throw new Error("Link de pagamento não retornado pela API.");
    }

  } catch (error) {
    console.error("Erro ao iniciar assinatura do plano:", error);
    const mensagemErro = error.message || "Erro ao conectar com a API de pagamentos.";

    if (typeof checkout !== "undefined" && checkout.toast) {
      checkout.toast(mensagemErro, "error");
    } else {
      alert(mensagemErro);
    }

    // 6. Reabilita o botão de compra original em caso de falha
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

/**
 * Exibe o modal de Upgrade Pro Rata (estilo PS Plus)
 */
async function exibirModalUpgradeProRata(novoPlano, usuarioId) {
  try {
    const res = await fetch(`${getApiBaseUrl()}/saas/calcular-upgrade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuarioId, novoPlano })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao calcular upgrade proporcional.");

    // Remove modal anterior se houver
    const oldModal = document.getElementById("modal-upgrade-prorata");
    if (oldModal) oldModal.remove();

    const eUpgrade = (data.planoAtual !== "BASICO" && data.planoAtual !== data.novoPlano && data.diasRestantes > 0 && data.diasRestantes < 30);

    // Cria o Modal Overlay estilizado tipo PS Plus
    const modalDiv = document.createElement("div");
    modalDiv.id = "modal-upgrade-prorata";
    modalDiv.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); z-index: 99999;
      display: flex; align-items: center; justify-content: center; padding: 1rem;
      animation: fadeIn 0.3s ease;
    `;

    if (eUpgrade) {
      const dataRenovacao = data.dataProximaRenovacao || 'fim do ciclo atual';
      modalDiv.innerHTML = `
        <div style="background: #18181b; border: 1px solid var(--gold-primary, #d4af37); border-radius: 12px; max-width: 460px; width: 100%; padding: 1.5rem; color: #fff; font-family: sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,0.5); position: relative;">
          <button onclick="document.getElementById('modal-upgrade-prorata').remove()" style="position: absolute; top: 12px; right: 14px; background: none; border: none; color: #a1a1aa; font-size: 1.2rem; cursor: pointer;">✕</button>
          
          <div style="text-align: center; margin-bottom: 1.2rem;">
            <div style="font-size: 2rem; color: var(--gold-primary, #d4af37); margin-bottom: 0.3rem;"><i class="fa-solid fa-angles-up"></i></div>
            <h3 style="margin: 0; font-size: 1.25rem; color: #fff;">Upgrade para o Plano ${data.novoPlano}</h3>
            <p style="margin: 0.3rem 0 0 0; font-size: 0.85rem; color: #a1a1aa;">Condições da sua transição de assinatura</p>
          </div>

          <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 1rem; margin-bottom: 1.2rem; display: flex; flex-direction: column; gap: 0.8rem; font-size: 0.9rem;">
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.5rem;">
              <span style="color: #a1a1aa;">Diferença cobrada hoje:</span>
              <span style="font-weight: 700; color: #34d399; font-size: 1.05rem;">R$ ${data.valorUpgrade.toFixed(2).replace('.', ',')}</span>
            </div>
            <div style="line-height: 1.5; color: #e4e4e7; font-size: 0.85rem;">
              A partir do dia <strong style="color: var(--gold-primary, #d4af37);">${dataRenovacao}</strong>, a sua assinatura passará a ser no valor recorrente de <strong style="color: #fff;">R$ ${data.precoNovoPlano.toFixed(2).replace('.', ',')}/mês</strong> (em vez de R$ ${data.precoPlanoAtual.toFixed(2).replace('.', ',')}/mês do Plano ${data.planoAtual}).
            </div>
          </div>

          <button onclick="window.location.href='${data.linkDePagamento}'" style="width: 100%; padding: 0.9rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #fff; border: none; font-weight: 700; font-size: 1rem; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
            <i class="fa-solid fa-bolt"></i> Pagar R$ ${data.valorUpgrade.toFixed(2).replace('.', ',')} e Ativar (Cakto Pay)
          </button>
        </div>
      `;
    } else {
      modalDiv.innerHTML = `
        <div style="background: #18181b; border: 1px solid var(--gold-primary, #d4af37); border-radius: 12px; max-width: 460px; width: 100%; padding: 1.5rem; color: #fff; font-family: sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,0.5); position: relative;">
          <button onclick="document.getElementById('modal-upgrade-prorata').remove()" style="position: absolute; top: 12px; right: 14px; background: none; border: none; color: #a1a1aa; font-size: 1.2rem; cursor: pointer;">✕</button>
          
          <div style="text-align: center; margin-bottom: 1.2rem;">
            <div style="font-size: 2rem; color: var(--gold-primary, #d4af37); margin-bottom: 0.3rem;"><i class="fa-solid fa-crown"></i></div>
            <h3 style="margin: 0; font-size: 1.25rem; color: #fff;">Assinatura do Plano ${data.novoPlano}</h3>
            <p style="margin: 0.3rem 0 0 0; font-size: 0.85rem; color: #a1a1aa;">Ativação imediata via Cakto Pay</p>
          </div>

          <div style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 1rem; margin-bottom: 1.2rem; display: flex; flex-direction: column; gap: 0.6rem; font-size: 0.9rem;">
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.4rem;">
              <span style="color: #a1a1aa;">Plano Selecionado:</span>
              <span style="font-weight: 600; color: var(--gold-primary, #d4af37);">Plano ${data.novoPlano}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #a1a1aa;">Período do Ciclo:</span>
              <span style="font-weight: 600; color: #38bdf8;">30 Dias de Acesso</span>
            </div>
          </div>

          <div style="background: linear-gradient(135deg, rgba(212,175,55,0.15) 0%, rgba(0,0,0,0.4) 100%); border: 1px solid var(--gold-primary, #d4af37); border-radius: 8px; padding: 1rem; text-align: center; margin-bottom: 1.2rem;">
            <span style="font-size: 0.8rem; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.5px;">Valor Mensal:</span>
            <div style="font-size: 1.8rem; font-weight: 800; color: var(--gold-primary, #d4af37); margin-top: 0.2rem;">R$ ${data.precoNovoPlano.toFixed(2).replace('.', ',')}/mês</div>
          </div>

          <button onclick="window.location.href='${data.linkDePagamento}'" style="width: 100%; padding: 0.9rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #fff; border: none; font-weight: 700; font-size: 1rem; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
            <i class="fa-solid fa-bolt"></i> Ir para o Checkout da Cakto Pay
          </button>
        </div>
      `;
    }

    document.body.appendChild(modalDiv);
  } catch (err) {
    console.error("Erro ao abrir modal pro-rata:", err);
    throw err;
  }
}

/**
 * Atualiza dinamicamente os cards de planos com o valor exato do Upgrade Pro-Rata antes do clique
 */
async function atualizarBadgesUpgradeProRata() {
  try {
    let usuarioId = null;
    const usuarioRaw = localStorage.getItem("conectajoias_usuario") || localStorage.getItem("usuario");
    if (usuarioRaw) {
      try {
        const u = JSON.parse(usuarioRaw);
        usuarioId = u.id || u._id || u.usuarioId;
      } catch (e) {}
    }
    if (!usuarioId) usuarioId = localStorage.getItem("conectajoias_usuario_id") || localStorage.getItem("usuario_id");
    if (!usuarioId) {
      const token = localStorage.getItem("conectajoias_token");
      if (token && token.includes(".")) {
        try {
          const payloadBase64 = token.split(".")[1];
          const payloadDecoded = JSON.parse(atob(payloadBase64));
          if (payloadDecoded && payloadDecoded.id) usuarioId = payloadDecoded.id;
        } catch (e) {}
      }
    }

    const planos = ["BRONZE", "GOLD", "PLATINUM"];

    for (const p of planos) {
      try {
        const res = await fetch(`${getApiBaseUrl()}/saas/calcular-upgrade`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usuarioId, novoPlano: p })
        });
        if (!res.ok) continue;
        const data = await res.json();

        // Seleciona botões dos planos nas telas
        const btnBronze = document.querySelector("button[onclick*='Bronze']");
        const btnGold = document.querySelector("button[onclick*='Gold']");
        const btnPlatinum = document.querySelector("button[onclick*='Platinum']");

        let targetBtn = null;
        if (p === 'BRONZE') targetBtn = btnBronze;
        if (p === 'GOLD') targetBtn = btnGold;
        if (p === 'PLATINUM') targetBtn = btnPlatinum;

        if (!targetBtn) continue;

        const cardContainer = targetBtn.closest(".dashboard-panel") || targetBtn.closest("div[style*='border']");
        if (!cardContainer) continue;

        // Limpa badge anterior se houver
        const oldBadge = cardContainer.querySelector(".badge-prorata-live");
        if (oldBadge) oldBadge.remove();

        const priceEl = cardContainer.querySelector("div[style*='font-size: 1.8rem']") || cardContainer.querySelector("div[style*='font-size: 1.5rem']");

        if (data.planoAtual === p) {
          // É o plano atual
          const badge = document.createElement("div");
          badge.className = "badge-prorata-live";
          badge.style.cssText = "font-size: 0.78rem; color: #81c784; margin-top: 4px; font-weight: 500; text-align: left;";
          badge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Seu Plano Atual (Ativo)';
          if (priceEl) priceEl.after(badge);
          targetBtn.innerHTML = '<i class="fa-solid fa-check"></i> Plano Atual Ativo';
          targetBtn.style.opacity = '0.7';
        } else if (data.planoAtual !== 'BASICO' && data.diasRestantes > 0 && data.creditoPlanoAtual > 0 && data.valorUpgrade < data.precoNovoPlano) {
          // É um upgrade proporcional - Discreto e limpo abaixo do preço
          const badge = document.createElement("div");
          badge.className = "badge-prorata-live";
          badge.style.cssText = "font-size: 0.78rem; color: #34d399; margin-top: 4px; font-weight: 500; text-align: left;";
          badge.innerHTML = `<i class="fa-solid fa-bolt" style="font-size: 0.7rem; color: #f59e0b;"></i> Upgrade hoje por R$ ${data.valorUpgrade.toFixed(2).replace('.', ',')}`;
          if (priceEl) priceEl.after(badge);
          targetBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> Fazer Upgrade (Cakto Pay)`;
        } else {
          targetBtn.innerHTML = `<i class="fa-solid fa-crown"></i> Assinar Plano ${p.charAt(0) + p.slice(1).toLowerCase()} (Cakto Pay)`;
        }
      } catch (e) {
        console.warn(`Erro ao calcular badge de upgrade para ${p}:`, e);
      }
    }
  } catch (err) {
    console.warn("Erro ao atualizar badges pro-rata:", err);
  }
}

// Exporta globalmente as funções
window.assinarPlano = assinarPlano;
window.exibirModalUpgradeProRata = exibirModalUpgradeProRata;
window.atualizarBadgesUpgradeProRata = atualizarBadgesUpgradeProRata;

// Inicializar na carga da página
document.addEventListener("DOMContentLoaded", () => {
  checkout.init();
  setTimeout(() => {
    atualizarBadgesUpgradeProRata();
  }, 600);
});
