const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const exportDir = path.join(rootDir, 'gemini_export');

// Se a pasta gemini_export existir, limpa arquivos markdown antigos
if (fs.existsSync(exportDir)) {
  const oldFiles = fs.readdirSync(exportDir);
  for (const f of oldFiles) {
    if (f.endsWith('.md')) {
      fs.unlinkSync(path.join(exportDir, f));
    }
  }
} else {
  fs.mkdirSync(exportDir, { recursive: true });
}

console.log("🚀 GERANDO EXPORTAÇÃO COMPATÍVEL COM GITHUB E GEMINI (UTF-8 / LF)...");

const grupos = [
  {
    nome: '01_BACKEND_servidor.md',
    titulo: 'Backend Server & Configurações',
    arquivos: [
      'server/schema.prisma',
      'server/server.js',
      'server/asaas-service.js',
      'server/services/ComissaoService.js'
    ]
  },
  {
    nome: '02_FRONTEND_login_app.md',
    titulo: 'Frontend Login & App Core',
    arquivos: [
      'frontend/pages/login.html',
      'frontend/js/login.js',
      'frontend/js/app.js'
    ]
  },
  {
    nome: '03_FRONTEND_admin_page.md',
    titulo: 'Frontend Página Administradora (HTML)',
    arquivos: [
      'frontend/pages/superadmin.html'
    ]
  },
  {
    nome: '04_FRONTEND_admin_script.md',
    titulo: 'Frontend Scripts Administradora (JS)',
    arquivos: [
      'frontend/js/superadmin.js',
      'frontend/js/superadmin-vendas.js',
      'frontend/js/superadmin-tour.js'
    ]
  },
  {
    nome: '05_FRONTEND_revendedora_page.md',
    titulo: 'Frontend Página Revendedora (HTML)',
    arquivos: [
      'frontend/pages/manager.html'
    ]
  },
  {
    nome: '06_FRONTEND_revendedora_script.md',
    titulo: 'Frontend Scripts Revendedora (JS)',
    arquivos: [
      'frontend/js/manager.js'
    ]
  },
  {
    nome: '07_FRONTEND_estilos.md',
    titulo: 'Frontend Estilos CSS',
    arquivos: [
      'frontend/css/style.css'
    ]
  },
  {
    nome: '08_SAAS_admin.md',
    titulo: 'Frontend SuperAdmin SaaS',
    arquivos: [
      'frontend/pages/saasadmin.html',
      'frontend/js/saasadmin.js'
    ]
  },
  {
    nome: '09_PAGAMENTO_onboarding.md',
    titulo: 'Frontend Pagamentos, Recibo, Termos e Onboarding',
    arquivos: [
      'frontend/pages/pagamento.html',
      'frontend/js/pagamento.js',
      'frontend/pages/recibo.html',
      'frontend/pages/termo_assinatura.html',
      'frontend/js/termo_assinatura.js',
      'frontend/pages/onboarding.html',
      'frontend/js/onboarding.js'
    ]
  }
];

// Gerar Guia de Leitura no formato UTF-8
const leiaMeContent = `# 📖 LEIA-ME - Como usar estes arquivos no Google Gemini

*Gerado em: ${new Date().toLocaleString('pt-BR')}*

---

## 📌 O que é este projeto?

**Conecta Joias** é uma plataforma SaaS White-Label de gestão de vendas para revendedoras de semijoias.

---

## 📂 Arquivos Modulares Otimizados para GitHub e Gemini

Todos os arquivos abaixo foram formatados estritamente em **UTF-8 com quebra de linha LF**, sem caracteres binários e mantendo tamanhos ideais para leitura direta no GitHub e no Gemini:

1. \`01_BACKEND_servidor.md\` (Schema Prisma, Express Server, Asaas & Serviços de Comissão)
2. \`02_FRONTEND_login_app.md\` (Tela de Login e App Core JS)
3. \`03_FRONTEND_admin_page.md\` (Interface HTML da Administradora)
4. \`04_FRONTEND_admin_script.md\` (Lógica JS da Administradora)
5. \`05_FRONTEND_revendedora_page.md\` (Interface HTML da Revendedora)
6. \`06_FRONTEND_revendedora_script.md\` (Lógica JS da Revendedora)
7. \`07_FRONTEND_estilos.md\` (Estilos globais CSS)
8. \`08_SAAS_admin.md\` (Painel SuperAdmin SaaS)
9. \`09_PAGAMENTO_onboarding.md\` (Checkout, Recibos, Termos e Onboarding)
`;

fs.writeFileSync(path.join(exportDir, '00_LEIA-ME_para_o_Gemini.md'), leiaMeContent.replace(/\r\n/g, '\n'), 'utf8');

let conteudoCompletoGlobal = `# 💎 CONECTA JOIAS - CÓDIGO FONTE COMPLETO DO PROJETO\n\n*Gerado em: ${new Date().toLocaleString('pt-BR')}*\n\n---\n\n`;

for (const g of grupos) {
  let mdContent = `# 📁 ${g.titulo}\n\n*Gerado em: ${new Date().toLocaleString('pt-BR')}*\n\n---\n\n`;

  for (const relPath of g.arquivos) {
    const fullPath = path.join(rootDir, relPath);
    if (fs.existsSync(fullPath)) {
      const extension = path.extname(relPath).replace('.', '');
      let lang = 'javascript';
      if (extension === 'html') lang = 'html';
      if (extension === 'css') lang = 'css';
      if (extension === 'prisma') lang = 'prisma';
      if (extension === 'json') lang = 'json';

      // Lê o conteúdo do arquivo e força codificação UTF-8 limpa e quebra de linha LF
      let fileCode = fs.readFileSync(fullPath, 'utf8');
      fileCode = fileCode.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      const bloco = `## 📄 Arquivo: \`${relPath}\`\n\n\`\`\`${lang}\n${fileCode}\n\`\`\`\n\n---\n\n`;
      mdContent += bloco;
      conteudoCompletoGlobal += bloco;
      console.log(`   + [${relPath}] -> ${g.nome}`);
    } else {
      console.warn(`   ⚠️ Arquivo não encontrado: ${relPath}`);
    }
  }

  // Grava o arquivo com codificação UTF-8 e LF
  const exportFilePath = path.join(exportDir, g.nome);
  fs.writeFileSync(exportFilePath, mdContent.replace(/\r\n/g, '\n'), 'utf8');
}

// Grava o consolidado global também em UTF-8 com LF
const globalExportPath = path.join(rootDir, 'codigo_conecta_joias.md');
fs.writeFileSync(globalExportPath, conteudoCompletoGlobal.replace(/\r\n/g, '\n'), 'utf8');

console.log(`\n✅ Exportação global concluída: codigo_conecta_joias.md (${(fs.statSync(globalExportPath).size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`✅ ${grupos.length + 1} arquivos modulares salvos em gemini_export/ em UTF-8 estrito.`);
