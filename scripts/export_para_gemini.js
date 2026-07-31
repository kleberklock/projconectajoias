const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const exportDir = path.join(rootDir, 'gemini_export');

if (!fs.existsSync(exportDir)) {
  fs.mkdirSync(exportDir, { recursive: true });
}

console.log("🚀 GERANDO EXPORTAÇÃO DO CÓDIGO-FONTE PARA GEMINI / GITHUB...");

// Definição dos grupos de arquivos para exportação modular
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
    nome: '02_FRONTEND_login.md',
    titulo: 'Frontend Login & App Core',
    arquivos: [
      'frontend/pages/login.html',
      'frontend/js/login.js',
      'frontend/js/app.js'
    ]
  },
  {
    nome: '03_FRONTEND_admin.md',
    titulo: 'Frontend Painel Administradora / Gestora',
    arquivos: [
      'frontend/pages/superadmin.html',
      'frontend/js/superadmin.js',
      'frontend/js/superadmin-vendas.js',
      'frontend/js/superadmin-tour.js'
    ]
  },
  {
    nome: '04_FRONTEND_revendedora.md',
    titulo: 'Frontend Painel da Revendedora',
    arquivos: [
      'frontend/pages/manager.html',
      'frontend/js/manager.js'
    ]
  },
  {
    nome: '05_FRONTEND_estilos.md',
    titulo: 'Frontend Estilos CSS',
    arquivos: [
      'frontend/css/style.css'
    ]
  },
  {
    nome: '06_SAAS_admin.md',
    titulo: 'Frontend SuperAdmin SaaS',
    arquivos: [
      'frontend/pages/saasadmin.html',
      'frontend/js/saasadmin.js'
    ]
  },
  {
    nome: '07_PAGAMENTO_onboarding.md',
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
      if (extension === 'md') lang = 'markdown';

      const fileCode = fs.readFileSync(fullPath, 'utf8');

      const bloco = `## 📄 Arquivo: \`${relPath}\`\n\n\`\`\`${lang}\n${fileCode}\n\`\`\`\n\n---\n\n`;
      mdContent += bloco;
      conteudoCompletoGlobal += bloco;
      console.log(`   + Incluído [${relPath}] -> ${g.nome}`);
    } else {
      console.warn(`   ⚠️ Arquivo não encontrado: ${relPath}`);
    }
  }

  const exportFilePath = path.join(exportDir, g.nome);
  fs.writeFileSync(exportFilePath, mdContent, 'utf8');
}

// Grava o arquivo consolidado na raiz
const globalExportPath = path.join(rootDir, 'codigo_conecta_joias.md');
fs.writeFileSync(globalExportPath, conteudoCompletoGlobal, 'utf8');
console.log(`\n✅ Exportação global concluída: codigo_conecta_joias.md (${(fs.statSync(globalExportPath).size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`✅ Arquivos modulares salvos na pasta gemini_export/`);
