/**
 * Conecta Joias - Early Synchronous Auth & Plan Guard
 * Executado síncronamente no <head> antes de renderizar qualquer elemento do body.
 * Garante verificação instantânea de autenticação, rota de perfil e travas de plano (cadeados).
 */
(function() {
  try {
    var path = window.location.pathname.toLowerCase();

    // Páginas públicas que não exigem login prévio
    var isPublicPage = path.includes("login.html") || 
                       path.includes("apresentacao.html") || 
                       path.includes("onboarding.html") || 
                       path.includes("termos_uso.html") || 
                       path.includes("politica_privacidade.html") || 
                       path.includes("termo_assinatura.html") || 
                       path.includes("pagamento.html") || 
                       path.includes("sucesso.html") || 
                       path.includes("falha.html");

    var token = localStorage.getItem("conectajoias_token");
    var userJson = localStorage.getItem("conectajoias_usuario");

    // 1. Se não houver sessão ativa em página protegida, redireciona para login IMEDIATAMENTE antes de desenhar o DOM
    if ((!token || !userJson) && !isPublicPage) {
      var targetLogin = path.includes("/pages/") ? "login.html" : "pages/login.html";
      window.location.replace(targetLogin);
      return;
    }

    if (token && userJson) {
      var usuario = JSON.parse(userJson);
      var role = (usuario.role || "").toUpperCase();
      var plano = (usuario.planoLoja || "BASICO").toUpperCase();

      // 2. Anexa plano e papel no <html> síncronamente para o CSS aplicar travas (cadeados) no primeiro Paint (Zero Latência)
      document.documentElement.setAttribute("data-plano", plano);
      document.documentElement.setAttribute("data-role", role);

      // 3. Validação prévia de rota por perfil antes de renderizar o site
      if ((path.includes("superadmin.html") || path.includes("saasadmin.html")) && role === "CONSULTANT") {
        window.location.replace(path.includes("/pages/") ? "manager.html" : "pages/manager.html");
      } else if (path.includes("manager.html") && (role === "MANAGER" || role === "ADMIN_LOJA")) {
        window.location.replace(path.includes("/pages/") ? "superadmin.html" : "pages/superadmin.html");
      }
    }
  } catch (e) {
    console.error("Erro na verificação prévia do AuthGuard:", e);
  }
})();
