const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { BlobServiceClient } = require('@azure/storage-blob');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { MercadoPagoConfig, Preference, Payment, Preapproval } = require('mercadopago');
const { criarCobranca, criarCobrancaPlanoSaaS, obterQrCodePix, obterCodigoBarrasBoleto } = require('./asaas-service');
const comissaoService = require('./services/ComissaoService');
const crypto = require('crypto');

// Função de segurança que garante um JWT_SECRET robusto gravado no .env
function garantirChaveJwtSegura() {
  const envPath = path.resolve(__dirname, '.env');
  let envContent = '';
  
  try {
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    } else {
      envContent = `PORT=5000\nJWT_SECRET=\n`;
    }
  } catch (err) {
    console.error('Erro ao ler arquivo .env:', err.message);
    return;
  }

  const jwtInseguros = [
    'sua_chave_secreta_super_segura_de_producao',
    'conectajoias_super_secret_key_2026',
    'defina_uma_chave_secreta_super_segura_aqui',
    'insira_uma_chave_secreta_aqui'
  ];

  let currentSecret = process.env.JWT_SECRET || '';

  if (!currentSecret || jwtInseguros.includes(currentSecret.trim())) {
    console.log('🛡️ Gerando chave JWT_SECRET criptográfica robusta...');
    const novaChave = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET = novaChave;

    if (envContent.includes('JWT_SECRET=')) {
      envContent = envContent.replace(/JWT_SECRET=.*/, `JWT_SECRET=${novaChave}`);
    } else {
      envContent += `\nJWT_SECRET=${novaChave}\n`;
    }
    
    try {
      fs.writeFileSync(envPath, envContent, 'utf8');
      console.log('✅ Nova chave JWT_SECRET gravada com sucesso no arquivo .env.');
    } catch (err) {
      console.error('Erro ao gravar nova chave no .env:', err.message);
    }
  }
}

garantirChaveJwtSegura();

const { AsyncLocalStorage } = require('async_hooks');
const context = new AsyncLocalStorage();

const app = express();
const basePrisma = new PrismaClient();
const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const store = context.getStore();
        const lojaId = store ? store.lojaId : null;
        const user = store ? store.user : null;
        const isSuperAdmin = user && user.role === 'SuperAdmin';

        // Modelos que contêm o campo 'lojaId' no schema
        const modelsWithLojaId = [
          'Usuario',
          'Produto',
          'ProdutoVariacao',
          'Consignado',
          'HistoricoAcerto',
          'VendaDireta',
          'VendaRevendedora',
          'Cliente',
          'Notificacao',
          'Configuracao',
          'FaixaComissao',
          'Treinamento'
        ];

        // Se o modelo contiver o campo lojaId, aplicamos as regras de RLS lógico
        if (modelsWithLojaId.includes(model)) {
          // Se o usuário estiver autenticado e não for SuperAdmin, mas não houver lojaId, bloqueia por segurança
          if (user && !isSuperAdmin && !lojaId) {
            throw new Error(`Erro de Contexto Tenant: O identificador de loja está ausente para a operação ${operation} no modelo ${model}.`);
          }

          // Se tivermos um lojaId ativo no contexto, forçamos o isolamento de dados
          if (lojaId) {
            // 1. Validação de Inserção (create / createMany)
            if (operation === 'create') {
              args.data = args.data || {};
              args.data.lojaId = lojaId;
            } else if (operation === 'createMany') {
              if (args.data) {
                if (Array.isArray(args.data)) {
                  args.data.forEach(item => {
                    item.lojaId = lojaId;
                  });
                } else {
                  args.data.lojaId = lojaId;
                }
              }
            }
            // 2. Operação findUnique: convertemos para findFirst para aceitar filtro customizado por lojaId
            else if (operation === 'findUnique') {
              args.where = args.where || {};
              args.where.lojaId = lojaId;
              return basePrisma[model].findFirst(args);
            }
            // 3. Operações de alteração/deleção individual (update / delete)
            // Realizamos uma verificação de tenant prévia para evitar violações
            else if (['update', 'delete'].includes(operation)) {
              args.where = args.where || {};
              const record = await basePrisma[model].findFirst({
                where: { ...args.where, lojaId }
              });
              if (!record) {
                throw new Error(`Acesso negado. O registro solicitado não foi encontrado ou não pertence a esta loja.`);
              }
            }
            // 4. Outras queries de busca (findMany, findFirst, updateMany, deleteMany, count, aggregate, groupBy)
            else if (['findMany', 'findFirst', 'updateMany', 'deleteMany', 'count', 'aggregate', 'groupBy'].includes(operation)) {
              args.where = args.where || {};
              args.where.lojaId = lojaId;
            }
          }
        }

        return query(args);
      }
    }
  }
});
const PORT = process.env.PORT || 5000;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("ERRO CRÍTICO: JWT_SECRET inválido.");
  process.exit(1);
}

const clientMercadoPago = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

// Configuração de CORS restrita ao frontend (inclui as portas de desenvolvimento local 5500 e 8080 e subdomínios)
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';
const CORS_ORIGINS = [
  frontendUrl,
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    const isAllowed = CORS_ORIGINS.some(allowed => {
      if (allowed === origin) return true;
      const allowedDomain = allowed.replace(/^https?:\/\//, '');
      const originDomain = origin.replace(/^https?:\/\//, '');
      return originDomain === allowedDomain || originDomain.endsWith('.' + allowedDomain);
    });

    if (isAllowed || origin.includes('ngrok') || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      callback(null, true);
    } else {
      callback(new Error('Bloqueado pelo CORS do Conecta Joias'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Inicializa o contexto assíncrono para cada requisição HTTP
app.use((req, res, next) => {
  const store = { lojaId: null, user: null };
  context.run(store, () => {
    req.contextStore = store;
    next();
  });
});

// Criação automática das pastas de uploads locais
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DOCUMENTOS_DIR = path.join(UPLOADS_DIR, 'documentos');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(DOCUMENTOS_DIR)) {
  fs.mkdirSync(DOCUMENTOS_DIR, { recursive: true });
}

// Servir a pasta uploads de forma estática
app.use('/uploads', express.static(UPLOADS_DIR));

// Servir o frontend de forma segura sob a mesma porta para ngrok
app.use((req, res, next) => {
  const lowercasePath = req.path.toLowerCase();
  if (lowercasePath.startsWith('/server') || lowercasePath.includes('.env') || lowercasePath.startsWith('/.git')) {
    return res.status(403).send('Acesso proibido');
  }
  next();
});

// Forçar a rota raiz '/' a servir a Landing Page apresentacao.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'pages', 'apresentacao.html'));
});

// Aliases para as páginas principais dentro da pasta pages ficarem acessíveis a partir do nível da raiz
const paginas = [
  'login.html',
  'manager.html',
  'superadmin.html',
  'pagamento.html',
  'sucesso.html',
  'falha.html',
  'recibo.html',
  'saasadmin.html',
  'onboarding.html',
  'termo_assinatura.html',
  'termos_uso.html',
  'politica_privacidade.html',
  'apresentacao.html'
];

paginas.forEach(pagina => {
  app.get(`/${pagina}`, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'pages', pagina));
  });
});

app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Configuração do Multer para Imagens em Memória
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // limite de 5MB
});

// Funções Auxiliares para Trava de Planos (SaaS)
async function verificarLimiteConsultoras(lojaId, adicionais = 1) {
  if (!lojaId || lojaId === 'default-loja') return { ok: true };
  
  try {
    const lojaObj = await prisma.loja.findUnique({ where: { id: lojaId } });
    if (!lojaObj) return { ok: true };
    
    const plano = (lojaObj.plano || 'BRONZE').toUpperCase();
    if (plano === 'PLATINUM') return { ok: true };

    const totalConsultoras = await prisma.usuario.count({
      where: { role: 'Consultant', lojaId }
    });

    let limite = 5;
    if (plano === 'BASICO') limite = 2;
    else if (plano === 'BRONZE') limite = 5;
    else if (plano === 'GOLD') limite = 25;

    if (totalConsultoras + adicionais > limite) {
      return {
        ok: false,
        plano,
        limite,
        totalAtual: totalConsultoras,
        error: `Limite do plano ${plano} atingido (${totalConsultoras}/${limite} consultoras). Faça o upgrade da sua assinatura para cadastrar mais.`
      };
    }
    return { ok: true };
  } catch (err) {
    console.error("Erro ao verificar limite de consultoras:", err);
    return { ok: true }; // Em caso de erro, permite por segurança
  }
}

async function verificarLimiteEstoque(lojaId, adicionais = 0) {
  if (!lojaId || lojaId === 'default-loja') return { ok: true };

  try {
    const lojaObj = await prisma.loja.findUnique({ where: { id: lojaId } });
    if (!lojaObj) return { ok: true };

    const plano = (lojaObj.plano || 'BRONZE').toUpperCase();
    if (plano === 'PLATINUM') return { ok: true };

    const totalProdutos = await prisma.produtoVariacao.aggregate({
      where: { lojaId },
      _sum: {
        quantidade: true
      }
    });
    const totalEstoqueAtual = totalProdutos._sum.quantidade || 0;

    let limite = 300;
    if (plano === 'BASICO') limite = 50;
    else if (plano === 'BRONZE') limite = 300;
    else if (plano === 'GOLD') limite = 1500;

    if (totalEstoqueAtual + adicionais > limite) {
      return {
        ok: false,
        plano,
        limite,
        totalAtual: totalEstoqueAtual,
        error: `Limite de peças do plano ${plano} atingido (${totalEstoqueAtual}/${limite} peças em estoque central). Não é possível cadastrar mais ${adicionais} peças sem fazer o upgrade do seu plano.`
      };
    }
    return { ok: true };
  } catch (err) {
    console.error("Erro ao verificar limite de estoque:", err);
    return { ok: true };
  }
}

// Configuração do Multer para Documentos em Memória (suporta Azure Storage + Local)
const uploadDocs = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // limite de 5MB para documentos
});

// Configuração do Azure Blob Storage (se houver Connection String)
let containerClient = null;
if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
    containerClient = blobServiceClient.getContainerClient(process.env.AZURE_STORAGE_CONTAINER_NAME || 'semijoias');
  } catch (error) {
    console.error("Erro ao conectar com o Azure Blob Storage:", error.message);
  }
}

// Helper universal para upload de arquivos (Azure Blob Storage com fallback local)
async function uploadArquivoParaStorage(fileBuffer, originalName, mimeType, subPasta = 'documentos') {
  if (containerClient) {
    try {
      const cleanName = originalName ? originalName.replace(/\s+/g, '_') : 'arquivo';
      const blobName = `${subPasta}/${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${cleanName}`;
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.upload(fileBuffer, fileBuffer.length, {
        blobHTTPHeaders: { blobContentType: mimeType || 'application/octet-stream' }
      });
      return blockBlobClient.url;
    } catch (azureErr) {
      console.error(`[Upload Storage] Erro no Azure Blob Storage (${subPasta}):`, azureErr.message);
    }
  }

  // Fallback local
  const targetDir = subPasta === 'documentos' ? DOCUMENTOS_DIR : UPLOADS_DIR;
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const ext = path.extname(originalName || '') || '.png';
  const localFileName = `${subPasta}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}${ext}`;
  const localFilePath = path.join(targetDir, localFileName);
  fs.writeFileSync(localFilePath, fileBuffer);

  return subPasta === 'documentos' 
    ? `/uploads/documentos/${localFileName}` 
    : `/uploads/${localFileName}`;
}

// Helper universal para exclusão de arquivos (Azure Blob Storage com fallback local)
async function excluirArquivoDoStorage(caminhoUrl) {
  if (!caminhoUrl) return;

  if (containerClient) {
    try {
      const containerName = containerClient.containerName;
      const urlParts = caminhoUrl.split(`/${containerName}/`);
      if (urlParts.length > 1) {
        const blobName = decodeURIComponent(urlParts[1]);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        await blockBlobClient.deleteIfExists();
        console.log(`[Storage] Blob ${blobName} deletado com sucesso do Azure.`);
        return;
      }
    } catch (azureErr) {
      console.error("[Storage] Erro ao deletar blob no Azure:", azureErr.message);
    }
  }

  try {
    if (caminhoUrl.startsWith('/uploads/')) {
      const relativePath = caminhoUrl.replace('/uploads/', '');
      const absolutePath = path.join(UPLOADS_DIR, relativePath);
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
        console.log(`[Storage] Arquivo local ${absolutePath} deletado com sucesso.`);
      }
    }
  } catch (localErr) {
    console.error("[Storage] Erro ao deletar arquivo local:", localErr.message);
  }
}

// ==========================================
// MIDDLEWARES DE AUTENTICAÇÃO E PERMISSÕES
// ==========================================

const autenticarJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Acesso negado. Token de autenticação não fornecido.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    if (req.contextStore) {
      req.contextStore.user = decoded;
      if (decoded.lojaId) {
        req.contextStore.lojaId = decoded.lojaId;
      }
    }
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Token inválido ou expirado.' });
  }
};

// Middleware opcional: decodifica o JWT se presente, mas não bloqueia se ausente.
// Usado em rotas públicas que também atendem usuários autenticados (ex: /api/config).
const autenticarJWTOpcional = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      if (req.contextStore) {
        req.contextStore.user = decoded;
        if (decoded.lojaId) {
          req.contextStore.lojaId = decoded.lojaId;
        }
      }
    } catch (_) {
      // Token inválido: ignora silenciosamente e continua como anônimo
      req.user = null;
    }
  }
  next();
};

const autorizarRole = (rolesAutorizadas) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({ error: 'Acesso negado. Usuário não autenticado.' });
    }

    const normalizar = (r) => {
      const u = (r || '').toString().toUpperCase();
      if (['MANAGER', 'ADMIN', 'ADMIN_LOJA', 'GESTORA', 'GESTORA_LOJA'].includes(u)) return 'MANAGER';
      if (['SUPERADMIN', 'SUPER_ADMIN', 'ADMINISTRADOR'].includes(u)) return 'SUPERADMIN';
      if (['CONSULTANT', 'REVENDEDORA', 'VENDEDORA'].includes(u)) return 'CONSULTANT';
      return u;
    };

    const userRoleNorm = normalizar(req.user.role);
    const permitidasNorm = rolesAutorizadas.map(r => normalizar(r));

    if (!permitidasNorm.includes(userRoleNorm)) {
      return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para realizar esta ação.' });
    }
    next();
  };
};

const identificarLoja = async (req, res, next) => {
  // SuperAdmin não exige lojaId fixo — pode operar em nome de qualquer loja via header
  if (req.user && req.user.role === 'SuperAdmin') {
    // Aceita o lojaId do token (se tiver) ou do header (para operar como uma loja específica)
    let lojaId = req.user.lojaId || req.headers['x-loja-id'] || null;
    
    // Tratamento defensivo contra null ou "null" enviado pelo frontend
    if (!lojaId || lojaId === 'null' || lojaId === 'undefined') {
      lojaId = 'default-loja';
    }
    
    req.lojaId = lojaId;
    if (req.contextStore) {
      req.contextStore.lojaId = req.lojaId;
    }
    return next();
  }

  // Para Manager e Consultant: lojaId é obrigatório e vem do token
  let lojaId = req.headers['x-loja-id'];
  if (req.user && req.user.lojaId) {
    lojaId = req.user.lojaId; // Token tem prioridade sobre o header
  }

  // Tratamento defensivo contra null ou "null" enviado pelo frontend
  if (!lojaId || lojaId === 'null' || lojaId === 'undefined') {
    lojaId = 'default-loja';
  }

  // Bloqueio de Lojas Suspensas para Manager e Consultant
  if (lojaId && lojaId !== 'default-loja') {
    try {
      const lojaObj = await prisma.loja.findUnique({
        where: { id: lojaId },
        select: { statusPlano: true }
      });
      if (lojaObj && lojaObj.statusPlano === 'SUSPENSO') {
        return res.status(403).json({ error: 'Acesso negado. A assinatura da sua loja está suspensa. Entre em contato com a administração central.' });
      }
    } catch (err) {
      console.error('Erro ao verificar status da loja:', err);
    }
  }

  req.lojaId = lojaId;
  if (req.contextStore) {
    req.contextStore.lojaId = lojaId;
  }
  next();
};

// Middleware para autorizar acesso a recursos baseado no plano da loja
const autorizarPlano = (planosPermitidos) => {
  return async (req, res, next) => {
    try {
      const lojaId = req.lojaId;
      if (!lojaId) {
        return res.status(400).json({ error: 'Loja não identificada na requisição.' });
      }

      // Se for loja default ou superadmin operando sem loja específica, permite por segurança
      if (lojaId === 'default-loja' || (req.user && req.user.role === 'SuperAdmin' && !req.user.lojaId)) {
        return next();
      }

      const lojaObj = await prisma.loja.findUnique({
        where: { id: lojaId }
      });

      if (!lojaObj) {
        return res.status(404).json({ error: 'Loja associada não encontrada.' });
      }

      const planoAtual = (lojaObj.plano || 'BASICO').toUpperCase();

      if (!planosPermitidos.includes(planoAtual)) {
        return res.status(403).json({
          error: `Funcionalidade não disponível no plano ${planoAtual}. Faça o upgrade da sua assinatura para liberá-la.`,
          recursoBloqueado: true,
          planoRequerido: planosPermitidos[0]
        });
      }

      next();
    } catch (err) {
      console.error("Erro no middleware autorizarPlano:", err);
      res.status(500).json({ error: 'Erro interno ao validar permissão do plano.' });
    }
  };
};

// Gravação de Logs de Auditoria
async function registrarLog(req, acao, detalhes, usuarioInfo = null) {
  try {
    let usuarioId = usuarioInfo ? usuarioInfo.id : (req.user ? req.user.id : null);
    let usuarioNome = usuarioInfo ? usuarioInfo.nome : (req.user ? req.user.nome : null);

    await prisma.logAcao.create({
      data: {
        usuarioId,
        usuarioNome,
        acao,
        detalhes
      }
    });
  } catch (error) {
    console.error("Erro ao gravar log de auditoria:", error);
  }
}

// ==========================================
// ROTAS DE AUTENTICAÇÃO (LOGIN / REGISTRO)
// ==========================================

// Limiter para rota de login (máximo 10 tentativas a cada 15 minutos por IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1' || req.ip.includes('127.0.0.1') || process.env.NODE_ENV !== 'production'
});

// Limiter para criação de novas marcas/tenants (máximo 5 cadastros por hora por IP)
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Limite de criação de marcas excedido. Tente novamente em uma hora.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1' || req.ip.includes('127.0.0.1') || process.env.NODE_ENV !== 'production'
});

// Limiter para processamento de pagamentos/checkout (máximo 10 tentativas a cada 30 minutos por IP)
const paymentLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas de pagamento por este endereço. Tente novamente em 30 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1' || req.ip.includes('127.0.0.1') || process.env.NODE_ENV !== 'production'
});

// Função para gerar uma senha aleatória de 8 caracteres
function gerarSenhaAleatoria(tamanho = 8) {
  const caracteres = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*';
  let senha = '';
  for (let i = 0; i < tamanho; i++) {
    senha += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
  }
  return senha;
}

// Função para validar se a senha é forte
function validarSenhaForte(senha) {
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%&*(),.?":{}|<>]).{8,}$/;
  return regex.test(senha);
}

// Função para gerar um PIN de 4 dígitos único
async function gerarPinUnico() {
  let pin;
  let pinExiste = true;
  while (pinExiste) {
    pin = Math.floor(1000 + Math.random() * 9000).toString(); // gera número de 4 dígitos (1000-9999)
    const usuario = await prisma.usuario.findUnique({ where: { pin } });
    if (!usuario) {
      pinExiste = false;
    }
  }
  return pin;
}

// Login Geral (E-mail ou PIN)
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, senha } = req.body; // 'email' aqui pode ser o E-mail (Admin) ou PIN (Revendedora)
  if (!email || !senha) {
    return res.status(400).json({ error: 'Preencha todos os campos.' });
  }

  try {
    let usuario;
    // Se o identificador for um número de exatamente 4 dígitos, busca por PIN
    if (/^\d{4}$/.test(email)) {
      usuario = await prisma.usuario.findUnique({ where: { pin: email } });
    } else {
      usuario = await prisma.usuario.findUnique({ where: { email } });
    }

    if (!usuario) {
      return res.status(400).json({ error: 'Identificador (E-mail ou PIN) ou senha incorretos.' });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senhaHash);
    if (!senhaValida) {
      return res.status(400).json({ error: 'Identificador (E-mail ou PIN) ou senha incorretos.' });
    }

    // Verifica se a loja do usuário está suspensa (bloqueia se o tenant estiver suspenso)
    let planoLoja = 'BASICO';
    if (usuario.lojaId) {
      const lojaObj = await prisma.loja.findUnique({
        where: { id: usuario.lojaId },
        select: { statusPlano: true, plano: true }
      });
      if (lojaObj) {
        if (lojaObj.statusPlano === 'SUSPENSO') {
          return res.status(403).json({ error: 'Acesso negado. A assinatura da sua loja está suspensa. Entre em contato com a administração central.' });
        }
        planoLoja = (lojaObj.plano || 'BASICO').toUpperCase();
      }
    }

    // Gera Token JWT
    const token = jwt.sign(
      { id: usuario.id, nome: usuario.nome, email: usuario.email, pin: usuario.pin, role: usuario.role, lojaId: usuario.lojaId },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Busca as configurações visuais da loja para retornar junto com o login
    // (garante que a revendedora herde as cores corretas sem uma segunda requisição)
    let configLoja = null;
    if (usuario.lojaId) {
      try {
        configLoja = await prisma.configuracao.findFirst({
          where: { lojaId: usuario.lojaId }
        });
      } catch (configErr) {
        console.warn('Aviso: não foi possível buscar config da loja no login:', configErr.message);
      }
    }

    // Registra log de auditoria
    registrarLog(req, "LOGIN", `Usuário realizou login com sucesso usando ${usuario.pin ? 'PIN' : 'E-mail'}.`, usuario);

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        pin: usuario.pin,
        role: usuario.role,
        comissao: usuario.comissao,
        lojaId: usuario.lojaId,
        planoLoja
      },
      // Configurações visuais da loja para aplicação imediata no frontend
      configLoja: configLoja ? {
        nomeEmpresa: configLoja.nomeEmpresa,
        logoUrl: configLoja.logoUrl,
        corPrimaria: configLoja.corPrimaria,
        corSecundaria: configLoja.corSecundaria,
        bgPrimary: configLoja.bgPrimary,
        bgCard: configLoja.bgCard,
        temaPref: configLoja.temaPref
      } : null
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno no servidor ao tentar logar.' });
  }
});


// Auto-cadastro público de Gestora (Manager)
app.post('/api/auth/signup', signupLimiter, async (req, res) => {
  const { nome, email, senha, nomeLoja, whatsapp } = req.body;
  if (!nome || !email || !senha || !nomeLoja) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes: nome, email, senha e nomeLoja.' });
  }

  if (!validarSenhaForte(senha)) {
    return res.status(400).json({ error: 'A senha deve conter pelo menos 8 caracteres, incluindo pelo menos uma letra maiúscula, uma letra minúscula, um número e um caractere especial (!@#$%&*(),.?\":{}|<>).' });
  }

  try {
    const emailExiste = await prisma.usuario.findUnique({ where: { email } });
    if (emailExiste) {
      return res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
    }

    // Criar uma nova loja/marca para a gestora
    const lojaIdLimpo = nomeLoja.toLowerCase().replace(/[^a-z0-9]/g, "-") + "-" + Math.floor(1000 + Math.random() * 9000);

    const novaLoja = await prisma.loja.create({
      data: {
        id: lojaIdLimpo,
        nome: nomeLoja
      }
    });

    // Criar configuração visual padrão para a nova loja
    await prisma.configuracao.create({
      data: {
        lojaId: novaLoja.id,
        nomeEmpresa: nomeLoja,
        logoUrl: "",
        corPrimaria: "#d4af37",
        corSecundaria: "#111111",
        bgPrimary: "#0a0a0a",
        bgCard: "#121212",
        temaPref: "ESCURO"
      }
    });

    const pin = await gerarPinUnico();
    const senhaHash = await bcrypt.hash(senha, 10);

    const novaGestora = await prisma.usuario.create({
      data: {
        nome,
        email,
        whatsapp: whatsapp || null,
        pin,
        senhaHash,
        role: 'Manager',
        lojaId: novaLoja.id,
        comissao: 0.0
      }
    });

    // Gerar Token JWT para logar imediatamente
    const token = jwt.sign(
      { id: novaGestora.id, nome: novaGestora.nome, email: novaGestora.email, role: novaGestora.role, lojaId: novaGestora.lojaId },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Gestora e Marca registradas com sucesso!',
      token,
      pin,
      usuario: {
        id: novaGestora.id,
        nome: novaGestora.nome,
        email: novaGestora.email,
        role: novaGestora.role,
        lojaId: novaGestora.lojaId,
        pin: pin
      }
    });
  } catch (error) {
    console.error('Erro no auto-cadastro de gestora:', error);
    res.status(500).json({ error: 'Erro interno no servidor ao tentar realizar cadastro.' });
  }
});

// GET /api/auth/pre-login-config - Obter configuração de tema pública do usuário (PIN ou E-mail) para a tela de login
app.get('/api/auth/pre-login-config', async (req, res) => {
  const { identificador } = req.query;
  if (!identificador) {
    return res.status(400).json({ error: 'Identificador ausente.' });
  }

  try {
    let usuario;
    if (/^\d{4}$/.test(identificador)) {
      usuario = await prisma.usuario.findUnique({ where: { pin: identificador } });
    } else {
      usuario = await prisma.usuario.findUnique({ where: { email: identificador } });
    }

    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    // Busca as configurações da loja do usuário
    const config = await prisma.configuracao.findFirst({
      where: { lojaId: usuario.lojaId }
    });

    if (!config) {
      return res.status(404).json({ error: 'Configuração da loja não encontrada.' });
    }

    // Retorna apenas dados de tema visual públicos e seguros
    res.json({
      nomeEmpresa: config.nomeEmpresa,
      logoUrl: config.logoUrl,
      corPrimaria: config.corPrimaria,
      corSecundaria: config.corSecundaria,
      bgPrimary: config.bgPrimary,
      bgCard: config.bgCard,
      temaPref: config.temaPref
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar pré-configuração de login.' });
  }
});

// Admin cria novos usuários (Revendedoras ou outros Admins)
app.post('/api/auth/register', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { nome, email, senha, role, whatsapp, comissao, faixasComissao, tipoComissao, metaUnicaValor, metaUnicaBonus, metaUnicaTipoBonus, baseCalculo, regraPerda, limiteIsencaoPerda, periodoAcumulo, ciclo } = req.body;
  if (!nome || !email || !senha || !role) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
  }

  if (!validarSenhaForte(senha)) {
    return res.status(400).json({ error: 'A senha deve conter pelo menos 8 caracteres, incluindo pelo menos uma letra maiúscula, uma letra minúscula, um número e um caractere especial (!@#$%&*(),.?\":{}|<>).' });
  }

  // Normaliza a role para maiúsculas e mapeia valores antigos
  let normalizedRole = role.toUpperCase();
  if (normalizedRole === 'CONSULTANT' || normalizedRole === 'REVENDEDORA' || normalizedRole === 'VENDEDORA') {
    normalizedRole = 'Consultant';
  } else if (normalizedRole === 'ADMIN' || normalizedRole === 'MANAGER') {
    normalizedRole = 'Manager';
  }

  try {
    const emailExiste = await prisma.usuario.findUnique({ where: { email } });
    if (emailExiste) {
      return res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
    }

    // Validação de limite de plano de assinatura para consultoras (SaaS)
    if (normalizedRole === 'Consultant') {
      const limitCheck = await verificarLimiteConsultoras(req.lojaId, 1);
      if (!limitCheck.ok) {
        return res.status(403).json({ error: limitCheck.error });
      }
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    let pin = null;
    if (normalizedRole === 'Consultant') {
      pin = await gerarPinUnico();
    }

    const novoUsuario = await prisma.usuario.create({
      data: {
        nome,
        email,
        pin,
        senhaHash,
        role: normalizedRole,
        whatsapp,
        comissao: parseFloat(comissao) || 30.0,
        tipoComissao: tipoComissao || "FIXA",
        metaUnicaValor: parseFloat(metaUnicaValor) || 0.0,
        metaUnicaBonus: parseFloat(metaUnicaBonus) || 0.0,
        metaUnicaTipoBonus: metaUnicaTipoBonus || "PERCENTUAL",
        baseCalculo: baseCalculo || "BRUTO",
        regraPerda: regraPerda || "VALOR_VENDA",
        limiteIsencaoPerda: parseInt(limiteIsencaoPerda) || 0,
        periodoAcumulo: periodoAcumulo || "MANUAL",
        ciclo: ciclo ? JSON.stringify(ciclo) : null,
        lojaId: req.lojaId,
        faixasComissao: faixasComissao && Array.isArray(faixasComissao) ? {
          create: faixasComissao.map(f => ({
            valorMin: parseFloat(f.valorMin) || 0.0,
            valorMax: parseFloat(f.valorMax) || 0.0,
            percentual: parseFloat(f.percentual) || 0.0,
            lojaId: req.lojaId
          }))
        } : undefined
      },
      include: {
        faixasComissao: true
      }
    });



    res.status(201).json({
      message: 'Usuário cadastrado com sucesso!',
      usuario: {
        id: novoUsuario.id,
        nome: novoUsuario.nome,
        email: novoUsuario.email,
        pin: novoUsuario.pin,
        role: novoUsuario.role,
        comissao: novoUsuario.comissao,
        faixasComissao: novoUsuario.faixasComissao,
        tipoComissao: novoUsuario.tipoComissao,
        metaUnicaValor: novoUsuario.metaUnicaValor,
        metaUnicaBonus: novoUsuario.metaUnicaBonus,
        metaUnicaTipoBonus: novoUsuario.metaUnicaTipoBonus,
        baseCalculo: novoUsuario.baseCalculo,
        regraPerda: novoUsuario.regraPerda,
        limiteIsencaoPerda: novoUsuario.limiteIsencaoPerda,
        periodoAcumulo: novoUsuario.periodoAcumulo
      }
    });
  } catch (error) {
    console.error("Erro detalhado ao cadastrar usuário:", error);
    res.status(500).json({ error: `Erro ao cadastrar usuário: ${error.message}` });
  }
});

// ==========================================
// ROTAS DE GESTÃO DE ESTOQUE (PRODUTOS)
// ==========================================

// Listar Produtos (com filtro de segurança para revendedoras)
app.get('/api/produtos', autenticarJWT, identificarLoja, async (req, res) => {
  try {
    const produtos = await prisma.produto.findMany({
      where: { lojaId: req.lojaId },
      include: {
        variacoes: true
      },
      orderBy: { nome: 'asc' }
    });

    const produtosMapeados = produtos.map(p => {
      const quantidade = p.variacoes.reduce((acc, v) => acc + (v.quantidade || 0), 0);
      const quantidadeDefeito = p.variacoes.reduce((acc, v) => acc + (v.quantidadeDefeito || 0), 0);
      return {
        ...p,
        quantidade,
        quantidadeDefeito
      };
    });

    // Se o usuário logado for revendedora, removemos os custos por segurança comercial
    if (req.user.role === 'Consultant') {
      const produtosPublicos = produtosMapeados.map(p => {
        const custoTotal = p.custoBruto + p.custoBanho + p.custoLiquido;
        const precoVenda = custoTotal * p.markup;
        return {
          id: p.id,
          codigo: p.codigo,
          nome: p.nome,
          categoria: p.categoria,
          quantidade: p.quantidade,
          precoVenda: precoVenda > 0 ? precoVenda : 50.0,
          fotoUrl: p.fotoUrl
        };
      });
      return res.json(produtosPublicos);
    }

    // Admins recebem o estoque completo com custos e markup
    res.json(produtosMapeados);
  } catch (error) {
    console.error("Erro ao listar produtos:", error);
    res.status(500).json({ error: 'Erro ao listar produtos.' });
  }
});

// Listar Produtos com Defeito (Admin)
app.get('/api/produtos/defeitos', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  try {
    const variacoesComDefeito = await prisma.produtoVariacao.findMany({
      where: {
        lojaId: req.lojaId,
        quantidadeDefeito: {
          gt: 0
        }
      },
      include: {
        produto: true
      },
      orderBy: {
        produto: {
          nome: 'asc'
        }
      }
    });

    const produtosComDefeito = variacoesComDefeito.map(v => {
      return {
        ...v.produto,
        quantidade: v.quantidade,
        quantidadeDefeito: v.quantidadeDefeito,
        variacaoId: v.id,
        sku: v.sku,
        tamanho: v.tamanho,
        banho: v.banho
      };
    });

    res.json(produtosComDefeito);
  } catch (error) {
    console.error("Erro ao listar produtos com defeito:", error);
    res.status(500).json({ error: 'Erro ao listar produtos com defeito.' });
  }
});

// Criar Produto (Admin)
app.post('/api/produtos', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { codigo, nome, categoria, quantidade, custoBruto, custoBanho, custoLiquido, markup, fotoUrl, quantidadeDefeito } = req.body;
  if (!nome || !categoria) {
    return res.status(400).json({ error: 'Nome e categoria são obrigatórios.' });
  }

  const cod = codigo || 'REF-' + Math.floor(1000 + Math.random() * 9000);

  try {
    // Validação de limite de peças no estoque baseado no plano da loja (SaaS)
    const limitCheck = await verificarLimiteEstoque(req.lojaId, parseInt(quantidade) || 0);
    if (!limitCheck.ok) {
      return res.status(403).json({ error: limitCheck.error });
    }
    const qtdInt = parseInt(quantidade) || 0;
    const novoProduto = await prisma.produto.create({
      data: {
        codigo: cod,
        nome,
        categoria,
        custoBruto: parseFloat(custoBruto) || 0.0,
        custoBanho: parseFloat(custoBanho) || 0.0,
        custoLiquido: parseFloat(custoLiquido) || 0.0,
        markup: parseFloat(markup) || 3.0,
        fotoUrl,
        lojaId: req.lojaId,
        variacoes: {
          create: {
            lojaId: req.lojaId,
            sku: `${cod}-UN-OU`,
            tamanho: "Único",
            banho: "OURO",
            quantidade: qtdInt,
            quantidadeDefeito: parseInt(quantidadeDefeito) || 0
          }
        }
      },
      include: {
        variacoes: true
      }
    });

    const produtoRetorno = {
      ...novoProduto,
      quantidade: parseInt(quantidade) || 0,
      quantidadeDefeito: parseInt(quantidadeDefeito) || 0
    };

    registrarLog(req, "PRODUTO_CRIAR", `Criou o produto ${novoProduto.nome} (${novoProduto.codigo}) com estoque inicial de ${quantidade}.`);

    res.status(201).json(produtoRetorno);
  } catch (error) {
    console.error("Erro ao criar produto:", error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Já existe um produto cadastrado com este Código/Referência.' });
    }
    res.status(500).json({ error: 'Erro ao criar produto.' });
  }
});

// Editar Produto (Admin)
app.put('/api/produtos/:id', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { id } = req.params;
  const { codigo, nome, categoria, quantidade, custoBruto, custoBanho, custoLiquido, markup, fotoUrl, quantidadeDefeito } = req.body;

  try {
    const prod = await prisma.produto.findFirst({ where: { id, lojaId: req.lojaId } });
    if (!prod) {
      return res.status(403).json({ error: 'Acesso negado ou produto não encontrado nesta loja.' });
    }

    const qtdInt = parseInt(quantidade) || 0;
    const produtoAtualizado = await prisma.produto.update({
      where: { id },
      data: {
        codigo,
        nome,
        categoria,
        custoBruto: parseFloat(custoBruto) || 0.0,
        custoBanho: parseFloat(custoBanho) || 0.0,
        custoLiquido: parseFloat(custoLiquido) || 0.0,
        markup: parseFloat(markup) || 3.0,
        fotoUrl
      },
      include: {
        variacoes: true
      }
    });

    const cod = codigo || produtoAtualizado.codigo;
    let variacaoPadrao = produtoAtualizado.variacoes.find(v => v.tamanho === "Único" && v.banho === "OURO");

    if (variacaoPadrao) {
      await prisma.produtoVariacao.update({
        where: { id: variacaoPadrao.id },
        data: {
          sku: `${cod}-UN-OU`,
          quantidade: parseInt(quantidade) || 0,
          quantidadeDefeito: parseInt(quantidadeDefeito) || 0
        }
      });
    } else {
      await prisma.produtoVariacao.create({
        data: {
          lojaId: req.lojaId,
          produtoId: produtoAtualizado.id,
          sku: `${cod}-UN-OU`,
          tamanho: "Único",
          banho: "OURO",
          quantidade: parseInt(quantidade) || 0,
          quantidadeDefeito: parseInt(quantidadeDefeito) || 0
        }
      });
    }

    const produtoRetorno = {
      ...produtoAtualizado,
      quantidade: parseInt(quantidade) || 0,
      quantidadeDefeito: parseInt(quantidadeDefeito) || 0
    };

    registrarLog(req, "PRODUTO_EDITAR", `Atualizou dados do produto ${produtoAtualizado.nome} (${produtoAtualizado.codigo}). Estoque: ${quantidade}, Defeitos: ${quantidadeDefeito}.`);

    res.json(produtoRetorno);
  } catch (error) {
    console.error("Erro ao atualizar produto:", error);
    res.status(500).json({ error: 'Erro ao atualizar produto.' });
  }
});

// Excluir Produto (Admin)
app.delete('/api/produtos/:id', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { id } = req.params;
  try {
    const prod = await prisma.produto.findFirst({ where: { id, lojaId: req.lojaId } });
    if (!prod) {
      return res.status(403).json({ error: 'Acesso negado ou produto não encontrado nesta loja.' });
    }

    await prisma.produto.delete({ where: { id } });

    registrarLog(req, "PRODUTO_EXCLUIR", `Excluiu o produto ${prod.nome} (${prod.codigo}).`);

    res.json({ message: 'Produto removido com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir produto.' });
  }
});

// Excluir Todos os Produtos (Admin)
app.delete('/api/produtos', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  try {
    await prisma.$transaction([
      prisma.consignado.deleteMany({ where: { lojaId: req.lojaId } }), // Limpa os consignados relacionados desta loja
      prisma.produto.deleteMany({ where: { lojaId: req.lojaId } })
    ]);
    res.json({ message: 'Todo o estoque e os consignados associados foram excluídos com sucesso!' });
  } catch (error) {
    console.error("Erro ao limpar estoque:", error);
    res.status(500).json({ error: 'Erro ao tentar excluir todos os produtos do estoque.' });
  }
});

// ==========================================
// ROTAS DE GESTÃO DE REVENDEDORAS
// ==========================================

// Listar Revendedoras (Admin)
app.get('/api/revendedoras', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  try {
    const revendedoras = await prisma.usuario.findMany({
      where: { role: 'Consultant', lojaId: req.lojaId },
      select: {
        id: true,
        nome: true,
        email: true,
        pin: true,
        whatsapp: true,
        comissao: true,
        faixasComissao: true,
        tipoComissao: true,
        metaUnicaValor: true,
        metaUnicaBonus: true,
        metaUnicaTipoBonus: true,
        baseCalculo: true,
        regraPerda: true,
        limiteIsencaoPerda: true,
        periodoAcumulo: true,
        ciclo: true,
        createdAt: true,
        consignados: {
          where: { lojaId: req.lojaId },
          include: {
            produtoVariacao: {
              include: {
                produto: true
              }
            }
          }
        },
        vendas: {
          where: { lojaId: req.lojaId },
          select: {
            data: true,
            precoVenda: true,
            quantidade: true,
            produtoVariacaoId: true,
            produtoId: true
          }
        },
        historico: {
          where: { lojaId: req.lojaId },
          orderBy: { data: 'desc' }
        }
      },
      orderBy: { nome: 'asc' }
    });
    
    // Desserializa o ciclo e mapeia os consignados para compatibilidade com o frontend
    const revendedorasFormatadas = revendedoras.map(r => {
      const ultimoAcerto = r.historico && r.historico.length > 0 ? r.historico[0] : null;
      const dataInicioCiclo = ultimoAcerto ? new Date(ultimoAcerto.data) : new Date(0);

      // Mapeia vendas registradas no ciclo atual
      const mapaVendasCiclo = new Map();
      if (r.vendas && Array.isArray(r.vendas)) {
        r.vendas.forEach(v => {
          if (new Date(v.data) > dataInicioCiclo) {
            const keyVar = v.produtoVariacaoId || v.produtoId;
            mapaVendasCiclo.set(keyVar, (mapaVendasCiclo.get(keyVar) || 0) + (v.quantidade || 1));
            if (v.produtoId) {
              mapaVendasCiclo.set(v.produtoId, (mapaVendasCiclo.get(v.produtoId) || 0) + (v.quantidade || 1));
            }
          }
        });
      }

      let quantidadeAtivaTotal = 0;
      let valorMaletaAtivoTotal = 0;

      const consignadosMapeados = r.consignados.map(c => {
        const qtdVendidaApp = mapaVendasCiclo.get(c.produtoVariacaoId) || mapaVendasCiclo.get(c.produtoVariacao?.produtoId) || 0;
        const qtdDisponivel = c.quantidadeConsignada;

        quantidadeAtivaTotal += qtdDisponivel;
        valorMaletaAtivoTotal += (qtdDisponivel * (c.precoVenda || 0));

        return {
          id: c.id,
          lojaId: c.lojaId,
          usuarioId: c.usuarioId,
          produtoVariacaoId: c.produtoVariacaoId,
          quantidadeConsignada: c.quantidadeConsignada + qtdVendidaApp,
          quantidadeDisponivel: qtdDisponivel,
          quantidadeVendidaApp: qtdVendidaApp,
          precoVenda: c.precoVenda,
          createdAt: c.createdAt,
          // Propriedades virtuais para compatibilidade com o frontend
          produtoId: c.produtoVariacao?.produtoId,
          produto: c.produtoVariacao?.produto
        };
      });

      // Contabiliza total real de faturamento e peças vendidas do histórico e vendas
      let totalPecasVendidasGeral = 0;
      let faturamentoTotalGeral = 0;

      if (r.vendas && Array.isArray(r.vendas)) {
        r.vendas.forEach(v => {
          totalPecasVendidasGeral += (v.quantidade || 1);
          faturamentoTotalGeral += (v.precoVenda || 0) * (v.quantidade || 1);
        });
      }
      if (r.historico && Array.isArray(r.historico)) {
        r.historico.forEach(h => {
          totalPecasVendidasGeral += (h.totalVendida || 0);
          faturamentoTotalGeral += (h.faturamentoBruto || 0);
        });
      }

      return {
        ...r,
        consignados: consignadosMapeados,
        quantidadeAtiva: quantidadeAtivaTotal,
        valorMaletaAtivo: valorMaletaAtivoTotal,
        totalPecasVendidasGeral,
        faturamentoTotalGeral,
        ciclo: r.ciclo ? JSON.parse(r.ciclo) : null
      };
    });

    res.json(revendedorasFormatadas);
  } catch (error) {
    console.error("Erro ao listar revendedoras:", error);
    res.status(500).json({ error: 'Erro ao listar revendedoras.' });
  }
});

// Editar Revendedora (Admin)
app.put('/api/revendedoras/:id', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { id } = req.params;
  const { nome, email, whatsapp, comissao, faixasComissao, tipoComissao, metaUnicaValor, metaUnicaBonus, metaUnicaTipoBonus, baseCalculo, regraPerda, limiteIsencaoPerda, periodoAcumulo, senha, ciclo } = req.body;

  try {
    const revendedora = await prisma.usuario.findFirst({
      where: { id, role: 'Consultant', lojaId: req.lojaId }
    });

    if (!revendedora) {
      return res.status(403).json({ error: 'Acesso negado ou revendedora não encontrada nesta loja.' });
    }

    const updateData = {
      nome,
      email,
      whatsapp,
      comissao: parseFloat(comissao) || 30.0,
      tipoComissao: tipoComissao || "FIXA",
      metaUnicaValor: parseFloat(metaUnicaValor) || 0.0,
      metaUnicaBonus: parseFloat(metaUnicaBonus) || 0.0,
      metaUnicaTipoBonus: metaUnicaTipoBonus || "PERCENTUAL",
      baseCalculo: baseCalculo || "BRUTO",
      regraPerda: regraPerda || "VALOR_VENDA",
      limiteIsencaoPerda: parseInt(limiteIsencaoPerda) || 0,
      periodoAcumulo: periodoAcumulo || "MANUAL",
      ciclo: ciclo ? JSON.stringify(ciclo) : undefined
    };

    if (senha && senha.trim() !== '') {
      updateData.senhaHash = await bcrypt.hash(senha, 10);
    }

    if (faixasComissao && Array.isArray(faixasComissao)) {
      updateData.faixasComissao = {
        deleteMany: {},
        create: faixasComissao.map(f => ({
          valorMin: parseFloat(f.valorMin) || 0.0,
          valorMax: parseFloat(f.valorMax) || 0.0,
          percentual: parseFloat(f.percentual) || 0.0,
          lojaId: req.lojaId
        }))
      };
    }

    const revendedoraAtualizada = await prisma.usuario.update({
      where: { id },
      data: updateData,
      include: {
        faixasComissao: true
      }
    });
    res.json(revendedoraAtualizada);
  } catch (error) {
    console.error("Erro detalhado ao atualizar dados da revendedora:", error);
    res.status(500).json({ error: `Erro ao atualizar dados da revendedora: ${error.message}` });
  }
});

// Regenerar PIN e Senha da Revendedora (Admin)
app.put('/api/revendedoras/:id/reset-pin', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { id } = req.params;

  try {
    const usuario = await prisma.usuario.findFirst({
      where: { id, role: 'Consultant', lojaId: req.lojaId }
    });

    if (!usuario) {
      return res.status(404).json({ error: 'Revendedora não encontrada nesta loja.' });
    }

    const novoPin = await gerarPinUnico();
    const novaSenha = gerarSenhaAleatoria(8);
    const senhaHash = await bcrypt.hash(novaSenha, 10);

    await prisma.usuario.update({
      where: { id },
      data: {
        pin: novoPin,
        senhaHash: senhaHash
      }
    });

    res.json({
      message: 'PIN e senha temporária regenerados com sucesso!',
      pin: novoPin,
      senha: novaSenha
    });
  } catch (error) {
    console.error("Erro ao regenerar PIN/senha:", error);
    res.status(500).json({ error: 'Erro ao tentar regenerar PIN e senha da revendedora.' });
  }
});

// Solicitar novas fotos do RG (deleta os atuais e envia notificação)
app.post('/api/revendedoras/:id/solicitar-novo-rg', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { id } = req.params;
  const { motivo } = req.body;

  if (!motivo || motivo.trim() === "") {
    return res.status(400).json({ error: 'É necessário informar o motivo da solicitação de novas fotos do RG.' });
  }

  try {
    const revendedora = await prisma.usuario.findFirst({
      where: { id, role: 'Consultant', lojaId: req.lojaId }
    });

    if (!revendedora) {
      return res.status(404).json({ error: 'Revendedora não encontrada nesta loja.' });
    }

    // 1. Buscar os documentos do tipo RG do cofre virtual
    const documentosRg = await prisma.documentoUsuario.findMany({
      where: {
        usuarioId: id,
        tipo: { in: ['RG', 'RG_FRENTE', 'RG_VERSO'] }
      }
    });

    // 2. Excluir fisicamente do storage
    for (const doc of documentosRg) {
      await excluirArquivoDoStorage(doc.caminhoUrl);
    }

    // 3. Excluir os registros no banco de dados
    await prisma.documentoUsuario.deleteMany({
      where: {
        usuarioId: id,
        tipo: { in: ['RG', 'RG_FRENTE', 'RG_VERSO'] }
      }
    });

    // 4. Enviar notificação para a revendedora
    const mensagem = `A administração solicitou novas fotos do seu RG. Motivo: "${motivo}". Por favor, acesse o painel e envie novamente.`;
    await prisma.notificacao.create({
      data: {
        lojaId: req.lojaId,
        tipo: 'solicitacao_rg',
        mensagem: mensagem,
        detalhes: JSON.stringify({ motivo, solicitadoPor: req.user.nome }),
        destinatarioId: id
      }
    });

    // 5. Registrar log de auditoria
    await prisma.logAcao.create({
      data: {
        usuarioId: req.user.id,
        usuarioNome: req.user.nome,
        acao: 'SOLICITACAO_RG_REVOLTA',
        detalhes: `Solicitou nova foto do RG da revendedora ${revendedora.nome} (ID: ${id}). Motivo: "${motivo}".`
      }
    });

    res.json({ success: true, message: 'Solicitação registrada com sucesso! Documentos de RG atuais removidos e notificação enviada para a revendedora.' });
  } catch (error) {
    console.error("Erro ao solicitar nova foto do RG:", error);
    res.status(500).json({ error: 'Erro ao processar solicitação de novas fotos do RG no servidor.' });
  }
});

// Excluir uma Revendedora (Admin) com retorno automático de peças ao estoque central
app.delete('/api/revendedoras/:id', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { id } = req.params;
  try {
    const revendedora = await prisma.usuario.findFirst({
      where: { id, role: 'Consultant', lojaId: req.lojaId }
    });

    if (!revendedora) {
      return res.status(403).json({ error: 'Acesso negado ou revendedora não encontrada nesta loja.' });
    }

    await prisma.$transaction(async (tx) => {
      // Devolve todas as peças ativas do consignado ao estoque central
      const consignados = await tx.consignado.findMany({
        where: { usuarioId: id, lojaId: req.lojaId }
      });

      for (const c of consignados) {
        if (c.quantidadeConsignada > 0 && c.produtoVariacaoId) {
          await tx.produtoVariacao.update({
            where: { id: c.produtoVariacaoId },
            data: { quantidade: { increment: c.quantidadeConsignada } }
          });
        }
      }

      await tx.usuario.delete({
        where: { id }
      });
    });

    res.json({ message: 'Revendedora excluída com sucesso e peças devolvidas ao Estoque Central!' });
  } catch (error) {
    console.error("Erro ao excluir revendedora:", error);
    res.status(500).json({ error: 'Erro ao excluir revendedora.' });
  }
});

// Excluir todas as Revendedoras (Admin)
app.delete('/api/revendedoras', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  try {
    await prisma.usuario.deleteMany({
      where: {
        role: 'Consultant',
        lojaId: req.lojaId
      }
    });
    res.json({ message: 'Todas as revendedoras foram excluídas com sucesso!' });
  } catch (error) {
    console.error("Erro ao excluir todas as revendedoras:", error);
    res.status(500).json({ error: 'Erro ao excluir todas as revendedoras.' });
  }
});

// Obter Maleta Própria (Revendedora logada)
app.get('/api/revendedoras/minha-maleta', autenticarJWT, identificarLoja, async (req, res) => {
  try {
    const usuarioId = req.user.id;
    const consignados = await prisma.consignado.findMany({
      where: { usuarioId, lojaId: req.lojaId },
      include: {
        produtoVariacao: {
          include: {
            produto: {
              select: {
                codigo: true,
                nome: true,
                categoria: true,
                fotoUrl: true
              }
            }
          }
        }
      }
    });

    const ultimoAcerto = await prisma.historicoAcerto.findFirst({
      where: { usuarioId, lojaId: req.lojaId },
      orderBy: { data: 'desc' }
    });
    const dataInicioCiclo = ultimoAcerto ? new Date(ultimoAcerto.data) : new Date(0);

    // Recalcula retroativamente todas as vendas do ciclo em aberto da revendedora
    try {
      await comissaoService.recalcularVendasCicloEmAberto(prisma, usuarioId, req.lojaId);
    } catch (e) {
      console.error("Erro ao recalcular vendas em minha-maleta:", e);
    }

    const vendasCiclo = await prisma.vendaRevendedora.findMany({
      where: {
        usuarioId,
        lojaId: req.lojaId,
        data: { gt: dataInicioCiclo }
      }
    });

    const mapaVendasCiclo = new Map();
    vendasCiclo.forEach(v => {
      const keyVar = v.produtoVariacaoId || v.produtoId;
      mapaVendasCiclo.set(keyVar, (mapaVendasCiclo.get(keyVar) || 0) + (v.quantidade || 1));
      if (v.produtoId) {
        mapaVendasCiclo.set(v.produtoId, (mapaVendasCiclo.get(v.produtoId) || 0) + (v.quantidade || 1));
      }
    });

    const maletaFormatada = consignados.map(c => {
      const qtdVendidaApp = mapaVendasCiclo.get(c.produtoVariacaoId) || mapaVendasCiclo.get(c.produtoVariacao?.produtoId) || 0;
      const disponivel = c.quantidadeConsignada;

      return {
        id: c.id,
        produtoId: c.produtoVariacao.produtoId,
        produtoVariacaoId: c.produtoVariacaoId,
        sku: c.produtoVariacao.sku,
        tamanho: c.produtoVariacao.tamanho,
        banho: c.produtoVariacao.banho,
        corPedra: c.produtoVariacao.corPedra,
        codigo: c.produtoVariacao.produto.codigo,
        nome: c.produtoVariacao.produto.nome,
        categoria: c.produtoVariacao.produto.categoria,
        quantidadeConsignadaTotal: c.quantidadeConsignada + qtdVendidaApp,
        quantidadeConsignada: disponivel, // Retorna a quantidade disponível para o frontend da revendedora
        quantidadeDisponivel: disponivel,
        quantidadeVendidaApp: qtdVendidaApp,
        precoVenda: c.precoVenda,
        fotoUrl: c.produtoVariacao.produto.fotoUrl
      };
    });

    // Busca faixas de comissão da revendedora
    let faixas = await prisma.faixaComissao.findMany({
      where: { usuarioId: req.user.id },
      orderBy: { valorMin: 'asc' }
    });

    // Fallback: busca faixas da loja se a revendedora não tiver faixas específicas
    if (faixas.length === 0) {
      faixas = await prisma.faixaComissao.findMany({
        where: { lojaId: req.lojaId, usuarioId: null },
        orderBy: { valorMin: 'asc' }
      });
    }

    // Busca configurações adicionais do usuário
    const usuarioConfig = await prisma.usuario.findUnique({
      where: { id: req.user.id },
      select: {
        tipoComissao: true,
        metaUnicaValor: true,
        metaUnicaBonus: true,
        metaUnicaTipoBonus: true,
        baseCalculo: true,
        regraPerda: true,
        limiteIsencaoPerda: true,
        periodoAcumulo: true
      }
    });

    // Calcula o total vendido no ciclo atual para exibir na barra de progressão
    const totalVendidoCiclo = vendasCiclo.reduce((acc, v) => acc + (Number(v.precoVenda || 0) * Number(v.quantidade || 1)), 0);

    res.json({
      consignado: maletaFormatada,
      faixasComissao: faixas,
      config: usuarioConfig,
      totalVendidoCiclo: totalVendidoCiclo
    });
  } catch (error) {
    console.error("Erro ao carregar maleta própria:", error);
    res.status(500).json({ error: 'Erro ao carregar dados da maleta.' });
  }
});

// ==========================================
// ROTAS DE CONSIGNAÇÕES E ACERTOS
// ==========================================

// Enviar Peças para a Maleta (Consignar - Admin)
app.post('/api/consignacoes', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { usuarioId, produtoVariacaoId, produtoId, quantidade } = req.body;
  const qtdParsed = parseInt(quantidade);
  if (!usuarioId || (!produtoVariacaoId && !produtoId) || isNaN(qtdParsed) || qtdParsed <= 0) {
    return res.status(400).json({ error: 'Dados incompletos para consignação. A quantidade deve ser um número maior que zero.' });
  }

  try {
    let variacao = null;
    if (produtoVariacaoId) {
      variacao = await prisma.produtoVariacao.findFirst({
        where: { id: produtoVariacaoId, lojaId: req.lojaId },
        include: { produto: true }
      });
    } else if (produtoId) {
      variacao = await prisma.produtoVariacao.findFirst({
        where: { 
          produtoId: produtoId,
          lojaId: req.lojaId
        },
        include: { produto: true }
      });
    }

    if (!variacao && produtoId) {
      const prodPai = await prisma.produto.findFirst({ where: { id: produtoId, lojaId: req.lojaId } });
      if (!prodPai) {
        return res.status(404).json({ error: 'Produto não encontrado nesta loja.' });
      }
      variacao = await prisma.produtoVariacao.create({
        data: {
          lojaId: req.lojaId,
          produtoId: prodPai.id,
          sku: `${prodPai.codigo || 'PROD'}-UN-OU`,
          tamanho: "Único",
          banho: "OURO",
          quantidade: prodPai.quantidade || 0
        },
        include: { produto: true }
      });
    }

    if (!variacao) {
      return res.status(404).json({ error: 'Variação de produto não encontrada nesta loja.' });
    }

    const variacaoIdReal = variacao.id;

    // Calcula estoque real combinando produto pai e variações do produto
    let estoqueDisponivelReal = Math.max(variacao.quantidade || 0, variacao.produto ? (variacao.produto.quantidade || 0) : 0);

    const prodIdTarget = produtoId || (variacao.produto ? variacao.produto.id : null);
    if (prodIdTarget) {
      const prodBanco = await prisma.produto.findFirst({
        where: { id: prodIdTarget, lojaId: req.lojaId },
        include: { variacoes: true }
      });
      if (prodBanco) {
        const somaVariacoes = (prodBanco.variacoes || []).reduce((acc, v) => acc + (v.quantidade || 0), 0);
        estoqueDisponivelReal = Math.max(estoqueDisponivelReal, prodBanco.quantidade || 0, somaVariacoes);
      }
    }

    if (estoqueDisponivelReal < qtdParsed) {
      return res.status(400).json({ error: `Estoque central insuficiente para esta semijoia. Disponível: ${estoqueDisponivelReal} unidade(s).` });
    }

    const revendedora = await prisma.usuario.findFirst({ where: { id: usuarioId, lojaId: req.lojaId } });
    if (!revendedora) {
      return res.status(404).json({ error: 'Revendedora não encontrada nesta loja.' });
    }

    // Calcula preço de venda atualizado com base nos custos e markup do produto-pai
    const produto = variacao.produto;
    const custoTotal = (produto.custoBruto || 0) + (produto.custoBanho || 0) + (produto.custoLiquido || 0);
    const precoVendaCalculado = custoTotal * (produto.markup || 1);

    const novoEstoqueConsolidado = Math.max(0, estoqueDisponivelReal - qtdParsed);

    // Deduz do estoque central da variação
    await prisma.produtoVariacao.update({
      where: { id: variacaoIdReal },
      data: { quantidade: novoEstoqueConsolidado }
    });

    // Cria ou atualiza o registro de consignação
    const consignadoExistente = await prisma.consignado.findFirst({
      where: {
        usuarioId,
        produtoVariacaoId: variacaoIdReal,
        lojaId: req.lojaId
      }
    });

    let consignacao;
    if (consignadoExistente) {
      consignacao = await prisma.consignado.update({
        where: { id: consignadoExistente.id },
        data: {
          quantidadeConsignada: { increment: qtdParsed },
          precoVenda: precoVendaCalculado
        }
      });
    } else {
      consignacao = await prisma.consignado.create({
        data: {
          usuarioId,
          produtoVariacaoId: variacaoIdReal,
          quantidadeConsignada: qtdParsed,
          precoVenda: precoVendaCalculado,
          lojaId: req.lojaId
        }
      });
    }

    const nomeRevendedora = revendedora.nome;
    registrarLog(req, "CONSIGNACAO_CRIAR", `Consignou ${qtdParsed} unidades do produto ${produto.nome} (SKU: ${variacao.sku}) para a revendedora ${nomeRevendedora}.`);

    // Dispara notificação no sistema para a revendedora
    try {
      await criarNotificacao(
        req.lojaId,
        'novas_pecas_maleta',
        `Novas peças foram adicionadas à sua maleta! ${qtdParsed}x ${produto.nome} (SKU: ${variacao.sku}).`,
        { produtoNome: produto.nome, sku: variacao.sku, quantidade: qtdParsed, precoVenda: precoVendaCalculado },
        usuarioId
      );
    } catch (notifErr) {
      console.error("Erro ao gerar notificação de novas peças na maleta:", notifErr);
    }

    res.json(consignacao);
  } catch (error) {
    console.error('Erro ao consignar:', error);
    res.status(500).json({ error: 'Erro ao processar consignação no banco de dados.' });
  }
});

// Devolver peças consignadas da maleta para o estoque central
app.post('/api/consignacoes/devolver', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { consignadoId, quantidadeDevolver } = req.body;
  const qtdParsed = parseInt(quantidadeDevolver);

  if (!consignadoId || isNaN(qtdParsed) || qtdParsed <= 0) {
    return res.status(400).json({ error: 'Dados incompletos. Informe o ID do consignado e a quantidade maior que zero.' });
  }

  try {
    const consignado = await prisma.consignado.findFirst({
      where: { id: consignadoId, lojaId: req.lojaId },
      include: {
        produtoVariacao: {
          include: {
            produto: true
          }
        },
        usuario: true
      }
    });

    if (!consignado) {
      return res.status(404).json({ error: 'Consignado não encontrado ou não pertence a esta loja.' });
    }

    const ultimoAcerto = await prisma.historicoAcerto.findFirst({
      where: { usuarioId: consignado.usuarioId, lojaId: req.lojaId },
      orderBy: { data: 'desc' }
    });
    const dataInicioCiclo = ultimoAcerto ? new Date(ultimoAcerto.data) : new Date(0);

    const vendasCiclo = await prisma.vendaRevendedora.findMany({
      where: {
        usuarioId: consignado.usuarioId,
        produtoVariacaoId: consignado.produtoVariacaoId,
        lojaId: req.lojaId,
        data: { gt: dataInicioCiclo }
      }
    });

    const totalJaVendido = vendasCiclo.reduce((acc, v) => acc + (v.quantidade || 1), 0);
    const disponivelNaMaleta = Math.max(0, consignado.quantidadeConsignada - totalJaVendido);

    if (disponivelNaMaleta < qtdParsed) {
      return res.status(400).json({ error: `Quantidade a devolver (${qtdParsed}) maior do que a quantidade disponível na maleta (${disponivelNaMaleta}).` });
    }

    await prisma.$transaction(async (tx) => {
      await tx.produtoVariacao.update({
        where: { id: consignado.produtoVariacaoId },
        data: { quantidade: { increment: qtdParsed } }
      });

      if (consignado.quantidadeConsignada === qtdParsed && totalJaVendido === 0) {
        await tx.consignado.delete({
          where: { id: consignado.id }
        });
      } else {
        await tx.consignado.update({
          where: { id: consignado.id },
          data: { quantidadeConsignada: { decrement: qtdParsed } }
        });
      }
    });

    await registrarLog(req, 'CONSIGNACAO_DEVOLVER', `Devolveu ${qtdParsed} unidades do produto ${consignado.produtoVariacao.produto.nome} (SKU: ${consignado.produtoVariacao.sku}) da maleta da revendedora ${consignado.usuario.nome} para o estoque central.`);
    
    // Dispara notificação para a administradora
    try {
      await criarNotificacao(
        req.lojaId,
        'devolucao_maleta',
        `A revendedora ${consignado.usuario.nome} devolveu ${qtdParsed}x ${consignado.produtoVariacao.produto.nome} ao estoque central.`,
        { revendedoraNome: consignado.usuario.nome, produtoNome: consignado.produtoVariacao.produto.nome, quantidade: qtdParsed },
        null
      );
    } catch (notifErr) {
      console.error("Erro ao gerar notificação de devolução:", notifErr);
    }

    res.json({ message: 'Peças devolvidas ao estoque central com sucesso!' });
  } catch (error) {
    console.error('Erro ao devolver consignado:', error);
    res.status(500).json({ error: 'Erro ao processar a devolução no banco de dados.' });
  }
});

// Finalizar Acerto de Contas (Admin)
app.post('/api/acertos', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  // itensAcerto: [{ produtoId, quantidadeVendida, quantidadeDevolvida, quantidadePerdida, quantidadeDefeito }]
  const { usuarioId, itensAcerto, formaPagamento, detalhesItens, manterPecasMaleta } = req.body;
  const reterEstoqueComRevendedora = Boolean(manterPecasMaleta === true || manterPecasMaleta === 'true');

  if (!usuarioId || !itensAcerto || itensAcerto.length === 0) {
    return res.status(400).json({ error: 'Falta dados para o fechamento.' });
  }

  try {
    const revendedora = await prisma.usuario.findFirst({
      where: { id: usuarioId, role: 'Consultant', lojaId: req.lojaId },
      include: {
        faixasComissao: true,
        loja: {
          include: {
            faixasComissao: true
          }
        }
      }
    });
    if (!revendedora) return res.status(404).json({ error: 'Revendedora não encontrada nesta loja.' });

    let faturamentoBruto = 0;
    let custoTotalPecasVendidas = 0;
    let totalConsignada = 0;
    let totalVendida = 0;
    let totalDevolvida = 0;
    let totalPerdida = 0;
    let totalDefeito = 0;
    let valorDescontoPerda = 0;
    let lostPiecesCounter = 0;

    // Executa as operações críticas do acerto de contas em transação ACID para evitar estados inconsistentes
    const acertoResult = await prisma.$transaction(async (tx) => {
      for (const item of itensAcerto) {
        let consignado = null;
        if (item.consignadoId) {
          consignado = await tx.consignado.findFirst({ where: { id: item.consignadoId, lojaId: req.lojaId } });
        }
        if (!consignado && item.produtoVariacaoId) {
          consignado = await tx.consignado.findFirst({ where: { usuarioId, produtoVariacaoId: item.produtoVariacaoId, lojaId: req.lojaId } });
        }
        if (!consignado && item.produtoId) {
          consignado = await tx.consignado.findFirst({
            where: {
              usuarioId,
              produtoVariacao: { produtoId: item.produtoId },
              lojaId: req.lojaId
            }
          });
        }

        const qtdVendida = parseInt(item.quantidadeVendida) || 0;
        const qtdDevolvida = parseInt(item.quantidadeDevolvida) || 0;
        const qtdPerdida = parseInt(item.quantidadePerdida) || 0;
        const qtdDefeito = parseInt(item.quantidadeDefeito) || 0;
        const precoItem = item.precoVenda ? parseFloat(item.precoVenda) : (consignado ? consignado.precoVenda : 0);
        const qtdConsignadaItem = item.quantidadeConsignada || (consignado ? consignado.quantidadeConsignada : (qtdVendida + qtdDevolvida + qtdPerdida + qtdDefeito));

        // Busca custo real unitário da peça (custoBruto + custoBanho + custoLiquido)
        let prodId = item.produtoId;
        if (!prodId && consignado) {
          const pv = await tx.produtoVariacao.findUnique({ where: { id: consignado.produtoVariacaoId } });
          if (pv) prodId = pv.produtoId;
        }
        const produtoObj = prodId ? await tx.produto.findUnique({ where: { id: prodId } }) : null;
        const custoRealUnitario = produtoObj ? ((produtoObj.custoBruto || 0) + (produtoObj.custoBanho || 0) + (produtoObj.custoLiquido || 0)) : 0;

        totalConsignada += qtdConsignadaItem;
        totalVendida += qtdVendida;
        totalDevolvida += qtdDevolvida;
        totalPerdida += qtdPerdida;
        totalDefeito += qtdDefeito;
        faturamentoBruto += precoItem * qtdVendida;
        custoTotalPecasVendidas += custoRealUnitario * qtdVendida;

        // Valor das perdas: calcula com base na regra de perda personalizada da revendedora
        let itemPerdaValor = 0;
        if (qtdPerdida > 0) {
          let custoRealItem = custoRealUnitario;

          for (let i = 0; i < qtdPerdida; i++) {
            lostPiecesCounter++;
            if (revendedora.regraPerda === 'ISENTO' && lostPiecesCounter <= (revendedora.limiteIsencaoPerda || 0)) {
              itemPerdaValor += 0;
            } else if (revendedora.regraPerda === 'VALOR_CUSTO') {
              itemPerdaValor += custoRealItem;
            } else {
              itemPerdaValor += precoItem;
            }
          }
        }
        valorDescontoPerda += itemPerdaValor;

        const varId = consignado ? consignado.produtoVariacaoId : item.produtoVariacaoId;

        // 1. As devoluções normais retornam ao Estoque Central da variação SE NÃO forem retidas com a revendedora
        if (qtdDevolvida > 0 && varId && !reterEstoqueComRevendedora) {
          await tx.produtoVariacao.update({
            where: { id: varId },
            data: { quantidade: { increment: qtdDevolvida } }
          });
        }

        // 2. Defeitos: incrementam o contador de defeito na variação do produto
        if (qtdDefeito > 0 && varId) {
          await tx.produtoVariacao.update({
            where: { id: varId },
            data: { quantidadeDefeito: { increment: qtdDefeito } }
          });
        }

        // 3. Atualização ou Remoção do item consignado na maleta
        if (consignado) {
          if (reterEstoqueComRevendedora && qtdDevolvida > 0) {
            // Mantém a maleta com as peças não vendidas no novo ciclo
            await tx.consignado.update({
              where: { id: consignado.id },
              data: { quantidadeConsignada: qtdDevolvida }
            });
          } else {
            // Remove o item consignado zerado
            await tx.consignado.delete({ where: { id: consignado.id } });
          }
        } else if (reterEstoqueComRevendedora && qtdDevolvida > 0 && varId) {
          // Cria o registro consignado para o novo ciclo se não existia previamente
          await tx.consignado.create({
            data: {
              lojaId: req.lojaId,
              usuarioId,
              produtoVariacaoId: varId,
              quantidadeConsignada: qtdDevolvida,
              precoVenda: precoItem
            }
          });
        }
      }

      // Se NÃO for para reter estoque, limpa quaisquer itens consignados restantes
      if (!reterEstoqueComRevendedora) {
        await tx.consignado.deleteMany({ where: { usuarioId, lojaId: req.lojaId } });
      }

      // Volume de faturamento para fins de enquadramento de faixa ou meta
      let faturamentoVolumeParaFaixa = faturamentoBruto;
      if (revendedora.periodoAcumulo === 'MENSAL') {
        const agora = new Date();
        const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0, 0);
        const vendasMes = await tx.vendaRevendedora.findMany({
          where: {
            usuarioId,
            lojaId: req.lojaId,
            data: {
              gte: inicioMes
            }
          }
        });
        faturamentoVolumeParaFaixa = vendasMes.reduce((acc, v) => acc + (v.precoVenda * v.quantidade), 0);
        if (faturamentoVolumeParaFaixa < faturamentoBruto) {
          faturamentoVolumeParaFaixa = faturamentoBruto;
        }
      }

      // Utiliza o ComissaoService para calcular a comissão final de forma limpa e modular
      const calcComissao = comissaoService.calcularComissao(
        revendedora,
        faturamentoBruto,
        faturamentoVolumeParaFaixa,
        valorDescontoPerda,
        custoTotalPecasVendidas
      );

      const comissaoPaga = calcComissao.comissaoPaga;
      const liquidoConectaJoias = calcComissao.liquidoConectaJoias;
      const totalRetidoRev = parseFloat(req.body.totalRetidoRevendedora) || 0.0;
      const totalRecAdmin = parseFloat(req.body.totalRecebidoAdmin) || 0.0;
      const saldoFinal = comissaoPaga - totalRetidoRev;

      // Salva o histórico de acerto
      const acerto = await tx.historicoAcerto.create({
        data: {
          usuarioId,
          totalConsignada,
          totalVendida,
          totalDevolvida,
          totalPerdida,
          totalDefeito,
          faturamentoBruto,
          valorDescontoPerda,
          comissaoPaga,
          liquidoConectaJoias,
          formaPagamento: formaPagamento || "Pix",
          totalRetidoRevendedora: totalRetidoRev,
          totalRecebidoAdmin: totalRecAdmin,
          saldoFinalAcerto: saldoFinal,
          detalhesItens: detalhesItens ? JSON.stringify(detalhesItens) : null,
          lojaId: req.lojaId
        }
      });



      return { acerto, faturamentoBruto, comissaoPaga, totalRetidoRev, liquidoConectaJoias };
    });

    registrarLog(req, "ACERTO_CONCLUIR", `Concluiu acerto de contas com a revendedora ${revendedora.nome}. Pagamento: ${formaPagamento || "Pix"}. Vendido: ${totalVendida}, Devolvido: ${totalDevolvida}, Perda: ${totalPerdida}, Defeito: ${totalDefeito}. Faturamento Bruto: R$ ${acertoResult.faturamentoBruto.toFixed(2)}, Líquido Empresa: R$ ${acertoResult.liquidoConectaJoias.toFixed(2)}.`);

    // Dispara notificação no sistema para a revendedora
    try {
      await criarNotificacao(
        req.lojaId,
        'acerto_concluido',
        `Seu acerto de contas foi finalizado com sucesso pela administradora! Faturamento: R$ ${acertoResult.faturamentoBruto.toFixed(2)}, Comissão a receber: R$ ${acertoResult.comissaoPaga.toFixed(2)}.`,
        { acertoId: acertoResult.acerto.id, faturamento: acertoResult.faturamentoBruto, comissao: acertoResult.comissaoPaga },
        usuarioId
      );
    } catch (notifErr) {
      console.error("Erro ao gerar notificação de acerto concluído:", notifErr);
    }

    res.json({
      message: 'Acerto concluído com sucesso!',
      acerto: acertoResult.acerto
    });
  } catch (error) {
    console.error('Erro no acerto:', error);
    res.status(500).json({ error: 'Erro ao processar acerto no banco de dados.' });
  }
});

// Listar Histórico de Acertos
app.get('/api/acertos/historico', autenticarJWT, identificarLoja, async (req, res) => {
  try {
    let queryOptions = {
      where: { lojaId: req.lojaId },
      orderBy: { data: 'desc' }
    };

    // Revendedoras só veem o seu próprio histórico. Admins veem tudo.
    if (req.user.role === 'Consultant') {
      queryOptions.where.usuarioId = req.user.id;
    } else {
      queryOptions.include = {
        usuario: { select: { nome: true } }
      };
    }

    const historico = await prisma.historicoAcerto.findMany(queryOptions);
    res.json(historico);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar histórico.' });
  }
});

// ==========================================
// ROTAS DE VENDAS DIRETAS (ADMIN)
// ==========================================

app.post('/api/vendas-diretas', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  let { codigo, nome, preco, whatsappCliente, nomeCliente, clienteId, quantidade, produtoId, desconto, motivoDesconto, formaPagamento } = req.body;

  // Se veio produtoId e não veio codigo/nome, busca no estoque central
  if (produtoId && (!codigo || !nome)) {
    try {
      const prod = await prisma.produto.findFirst({ where: { id: produtoId, lojaId: req.lojaId } });
      if (prod) {
        codigo = prod.codigo;
        nome = prod.nome;
      }
    } catch (e) {
      console.error("Erro ao buscar produto por ID na venda direta:", e);
    }
  }

  if (!codigo || !nome || !preco) {
    return res.status(400).json({ error: 'Informações da venda incompletas.' });
  }

  if (clienteId) {
    try {
      const cliente = await prisma.cliente.findFirst({ where: { id: clienteId, lojaId: req.lojaId } });
      if (!cliente) {
        return res.status(403).json({ error: 'Cliente não encontrado nesta loja.' });
      }
    } catch (e) {
      console.error("Erro ao buscar cliente na venda direta:", e);
    }
  }

  const qtd = parseInt(quantidade) || 1;
  const descTotal = parseFloat(desconto) || 0.0;
  const motivo = motivoDesconto || null;
  const forma = formaPagamento || "Pix";
  const precoUnitario = parseFloat(preco) || 0.0;
  const precoTotalVenda = Math.max(0, (precoUnitario * qtd) - descTotal);

  try {
    // Registra a transação como uma venda em conjunto (1 única venda contendo a quantidade de itens)
    const venda = await prisma.vendaDireta.create({
      data: {
        codigo,
        nome,
        quantidade: qtd,
        preco: precoTotalVenda,
        whatsappCliente,
        nomeCliente,
        clienteId: clienteId || null,
        lojaId: req.lojaId,
        desconto: descTotal,
        motivoDesconto: motivo,
        formaPagamento: forma
      }
    });

    // Deduz a quantidade do estoque central se houver essa peça disponível
    const produto = await prisma.produto.findFirst({
      where: { codigo, lojaId: req.lojaId },
      include: { variacoes: true }
    });
    if (produto && produto.variacoes.length > 0) {
      const variacao = produto.variacoes.find(v => v.tamanho === "Único" && v.banho === "OURO") || produto.variacoes[0];
      const novaQtd = Math.max(0, variacao.quantidade - qtd);
      await prisma.produtoVariacao.update({
        where: { id: variacao.id },
        data: { quantidade: novaQtd }
      });
    }

    res.status(201).json(venda);
  } catch (error) {
    console.error("Erro ao registrar venda direta:", error);
    res.status(500).json({ error: 'Erro ao registrar venda direta.' });
  }
});

app.get('/api/vendas-diretas', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  try {
    const vendas = await prisma.vendaDireta.findMany({
      where: { lojaId: req.lojaId },
      orderBy: { data: 'desc' }
    });
    res.json(vendas);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao obter vendas diretas.' });
  }
});

// Excluir uma venda (Admin)
app.delete('/api/vendas/:tipo/:id', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { tipo, id } = req.params;
  try {
    if (tipo === 'direta') {
      const venda = await prisma.vendaDireta.findFirst({ where: { id, lojaId: req.lojaId } });
      if (!venda) return res.status(403).json({ error: 'Venda direta não encontrada nesta loja.' });
      await prisma.vendaDireta.delete({ where: { id } });
    } else if (tipo === 'revendedora') {
      const venda = await prisma.vendaRevendedora.findFirst({ where: { id, lojaId: req.lojaId } });
      if (!venda) return res.status(403).json({ error: 'Venda de revendedora não encontrada nesta loja.' });
      await prisma.vendaRevendedora.delete({ where: { id } });
    } else {
      return res.status(400).json({ error: 'Tipo de venda inválido.' });
    }
    res.json({ message: 'Venda excluída com sucesso!' });
  } catch (error) {
    console.error("Erro ao excluir venda:", error);
    res.status(500).json({ error: 'Erro ao excluir venda.' });
  }
});

// Excluir todas as vendas (Admin)
app.delete('/api/vendas', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  try {
    await prisma.$transaction([
      prisma.vendaDireta.deleteMany({ where: { lojaId: req.lojaId } }),
      prisma.vendaRevendedora.deleteMany({ where: { lojaId: req.lojaId } })
    ]);
    res.json({ message: 'Todo o histórico de vendas foi excluído com sucesso!' });
  } catch (error) {
    console.error("Erro ao excluir todo o histórico de vendas:", error);
    res.status(500).json({ error: 'Erro ao excluir todo o histórico de vendas.' });
  }
});

// Relatório DRE Simplificado (Admin)
app.get('/api/relatorios/dre', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, autorizarPlano(['GOLD', 'PLATINUM']), async (req, res) => {
  const { inicio, fim } = req.query;
  const cmvEstimado = parseFloat(req.query.cmvEstimado) || 33.0;

  try {
    // Validação robusta de datas para evitar erros no banco de dados se forem strings inválidas
    let dataInicio = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    if (inicio && inicio !== 'undefined' && inicio !== 'null' && inicio.trim() !== '') {
      const parsedInicio = new Date(inicio);
      if (!isNaN(parsedInicio.getTime())) {
        dataInicio = parsedInicio;
      }
    }

    let dataFim = new Date();
    if (fim && fim !== 'undefined' && fim !== 'null' && fim.trim() !== '') {
      const parsedFim = new Date(fim);
      if (!isNaN(parsedFim.getTime())) {
        dataFim = parsedFim;
      }
    }
    dataFim.setHours(23, 59, 59, 999);

    const vendasDiretas = await prisma.vendaDireta.findMany({
      where: {
        lojaId: req.lojaId,
        data: {
          gte: dataInicio,
          lte: dataFim
        }
      }
    });

    const acertos = await prisma.historicoAcerto.findMany({
      where: {
        lojaId: req.lojaId,
        data: {
          gte: dataInicio,
          lte: dataFim
        }
      }
    });

    const vendasRevendedora = await prisma.vendaRevendedora.findMany({
      where: {
        lojaId: req.lojaId,
        data: {
          gte: dataInicio,
          lte: dataFim
        }
      }
    });

    const produtos = await prisma.produto.findMany({
      where: { lojaId: req.lojaId }
    });
    const produtosMap = new Map(produtos.map(p => [p.codigo, p]));
    const produtosIdMap = new Map(produtos.map(p => [p.id, p]));

    let faturamentoVendasDiretas = 0;
    let custoVendasDiretas = 0;

    vendasDiretas.forEach(v => {
      faturamentoVendasDiretas += v.preco;
      const qtdItem = v.quantidade || 1;
      const prod = produtosMap.get(v.codigo);
      const custoReal = prod ? (prod.custoBruto + prod.custoBanho + prod.custoLiquido) : 0;
      if (custoReal > 0) {
        custoVendasDiretas += custoReal * qtdItem;
      } else {
        custoVendasDiretas += v.preco * (cmvEstimado / 100);
      }
    });

    let faturamentoAcertos = 0;
    let comissoesPagas = 0;
    let descontoPerdas = 0;

    acertos.forEach(a => {
      faturamentoAcertos += a.faturamentoBruto;
      comissoesPagas += a.comissaoPaga;
      descontoPerdas += a.valorDescontoPerda;
    });

    // 3. Custo, Faturamento e Comissões das Vendas das Revendedoras (App)
    let faturamentoVendasRevendedora = 0;
    let comissoesVendasRevendedora = 0;
    let custoVendasConsignado = 0;

    vendasRevendedora.forEach(vr => {
      const qtd = vr.quantidade || 1;
      faturamentoVendasRevendedora += (vr.precoVenda * qtd);
      comissoesVendasRevendedora += (vr.comissaoValor || 0);

      const prod = produtosIdMap.get(vr.produtoId) || produtosMap.get(vr.codigoProduto);
      const custoReal = prod ? (prod.custoBruto + prod.custoBanho + prod.custoLiquido) : 0;
      if (custoReal > 0) {
        custoVendasConsignado += custoReal * qtd;
      } else {
        custoVendasConsignado += vr.precoVenda * (cmvEstimado / 100) * qtd;
      }
    });

    if (custoVendasConsignado === 0 && faturamentoAcertos > 0) {
      custoVendasConsignado = faturamentoAcertos * (cmvEstimado / 100);
    }

    const faturamentoBrutoTotal = faturamentoVendasDiretas + faturamentoAcertos + faturamentoVendasRevendedora;
    const comissoesTotais = comissoesPagas + comissoesVendasRevendedora;
    const custoTotalMercadorias = custoVendasDiretas + custoVendasConsignado;


    const lucroLiquidoEstimado = faturamentoBrutoTotal - comissoesTotais - custoTotalMercadorias + descontoPerdas;
    const markupMedioReal = custoTotalMercadorias > 0 ? (faturamentoBrutoTotal / custoTotalMercadorias) : 3.0;
    const margemLucroReal = faturamentoBrutoTotal > 0 ? ((lucroLiquidoEstimado / faturamentoBrutoTotal) * 100) : 0.0;

    res.json({
      periodo: {
        inicio: dataInicio,
        fim: dataFim
      },
      resumo: {
        faturamentoVendasDiretas,
        faturamentoAcertos,
        faturamentoVendasRevendedora,
        faturamentoBrutoTotal,
        comissoesPagas,
        comissoesVendasRevendedora,
        comissoesTotais,
        descontoPerdas,
        impostos: 0,
        custoVendasDiretas,
        custoVendasConsignado,
        custoTotalMercadorias,
        despesasFixas: 0,
        lucroLiquidoEstimado,
        markupMedioReal,
        margemLucroReal
      }
    });

  } catch (error) {
    console.error("Erro ao gerar DRE:", error);
    res.status(500).json({ error: 'Erro ao gerar o relatório DRE.' });
  }
});

// ==========================================
// ROTAS DE VENDAS DE REVENDEDORAS
// ==========================================

app.post('/api/vendas-revendedora', autenticarJWT, autorizarRole(['Consultant']), identificarLoja, async (req, res) => {
  const { produtoVariacaoId, quantidade, desconto, motivoDesconto, formaPagamento, clienteId } = req.body;
  const usuarioId = req.user.id;

  const qtdParsed = parseInt(quantidade);
  const descTotal = parseFloat(desconto) || 0.0;

  if (!produtoVariacaoId || isNaN(qtdParsed) || qtdParsed <= 0) {
    return res.status(400).json({ error: 'Quantidade inválida ou dados incompletos para registrar a venda.' });
  }

  if (isNaN(descTotal) || descTotal < 0) {
    return res.status(400).json({ error: 'Desconto inválido. O valor do desconto não pode ser negativo.' });
  }

  try {
    // Busca o item consignado desta revendedora vinculado à variação específica
    const consignado = await prisma.consignado.findFirst({
      where: {
        usuarioId,
        produtoVariacaoId,
        lojaId: req.lojaId
      },
      include: { 
        produtoVariacao: {
          include: { produto: true }
        }, 
        usuario: true 
      }
    });

    if (!consignado) {
      return res.status(404).json({ error: 'Esta variação de produto não está na sua maleta.' });
    }

    // Busca o último acerto para verificar a quantidade já vendida no ciclo atual
    const ultimoAcerto = await prisma.historicoAcerto.findFirst({
      where: { usuarioId, lojaId: req.lojaId },
      orderBy: { data: 'desc' }
    });
    const dataInicioCiclo = ultimoAcerto ? new Date(ultimoAcerto.data) : new Date(0);

    const vendasCiclo = await prisma.vendaRevendedora.findMany({
      where: {
        usuarioId,
        produtoVariacaoId,
        lojaId: req.lojaId,
        data: { gt: dataInicioCiclo }
      }
    });

    const disponivelNaMaleta = Math.max(0, consignado.quantidadeConsignada);

    if (disponivelNaMaleta < qtdParsed) {
      return res.status(400).json({ error: `Quantidade insuficiente na maleta. Você tem apenas ${disponivelNaMaleta} unidade(s) disponível(is).` });
    }

    const descPorItem = descTotal / qtdParsed;
    if (descPorItem > consignado.precoVenda) {
      return res.status(400).json({ error: 'Desconto inválido. O desconto por item não pode ser superior ao preço de venda do produto.' });
    }

    const precoFinal = consignado.precoVenda - descPorItem;
    const comissaoValor = precoFinal * qtdParsed * (consignado.usuario.comissao / 100);

    // Quantidade física que sobrará na maleta após esta venda
    const novaQtd = disponivelNaMaleta - qtdParsed;

    const variacao = consignado.produtoVariacao;
    const produto = variacao.produto;

    const isLink = (formaPagamento === "Link de Pagamento");
    const canalPagamento = isLink ? "LINK_PAGO_ADMIN" : "DINHEIRO_REVENDEDORA";
    const pago = !isLink;

    // Registra a venda contendo as informações da variação e SKU
    const venda = await prisma.vendaRevendedora.create({
      data: {
        usuarioId,
        produtoId: produto.id,
        produtoVariacaoId: variacao.id,
        sku: variacao.sku,
        nomeProduto: produto.nome,
        codigoProduto: produto.codigo,
        quantidade: qtdParsed,
        precoVenda: precoFinal,
        comissaoValor,
        lojaId: req.lojaId,
        desconto: descPorItem,
        motivoDesconto: motivoDesconto || null,
        formaPagamento: formaPagamento || "Dinheiro",
        clienteId: clienteId || null,
        pago,
        canalPagamento
      }
    });

    // Atualiza a quantidade real em tempo real na tabela Consignado do banco de dados
    if (consignado.quantidadeConsignada - qtdParsed <= 0) {
      await prisma.consignado.delete({ where: { id: consignado.id } });
    } else {
      await prisma.consignado.update({
        where: { id: consignado.id },
        data: { quantidadeConsignada: { decrement: qtdParsed } }
      });
    }

    let linkSimulado = null;
    if (isLink) {
      const linkId = Math.random().toString(36).substring(2, 15);
      linkSimulado = `${frontendUrl}/pages/pagamento.html?id=${linkId}`;

      await prisma.linkPagamento.create({
        data: {
          id: linkId,
          usuarioId,
          clienteId: clienteId || null,
          valor: parseFloat(precoFinal * qtdParsed),
          formaEnvio: "PIX",
          status: 'PENDENTE',
          linkSimulado,
          vendaId: venda.id
        }
      });

      // Atualiza a venda com o ID do link
      await prisma.vendaRevendedora.update({
        where: { id: venda.id },
        data: { linkPagamentoId: linkId }
      });
    }

    // Recalcula retroativamente todas as vendas do ciclo em aberto da revendedora
    // e re-busca a venda para obter o comissaoValor correto (PROGRESSIVA/META_UNICA)
    let comissaoValorFinal = comissaoValor; // fallback para a estimativa inicial
    try {
      await comissaoService.recalcularVendasCicloEmAberto(prisma, usuarioId, req.lojaId);
      // Re-busca a venda recém-criada para ler o comissaoValor já atualizado pelo recálculo
      const vendaAtualizada = await prisma.vendaRevendedora.findUnique({ where: { id: venda.id } });
      if (vendaAtualizada) comissaoValorFinal = vendaAtualizada.comissaoValor;
    } catch (recalcErr) {
      console.error("Erro ao recalcular comissões do ciclo:", recalcErr);
    }

    // Cria notificação de venda para o Admin
    try {
      const valorTotal = precoFinal * quantidade;
      const nomeProd = consignado.produtoVariacao?.produto?.nome || 'Produto';
      const codProd = consignado.produtoVariacao?.produto?.codigo || '—';

      const novaNotif = await prisma.notificacao.create({
        data: {
          tipo: 'venda_revendedora',
          mensagem: `A revendedora ${consignado.usuario.nome} vendeu ${quantidade}x ${nomeProd} (Código: ${codProd}) no valor total de R$ ${valorTotal.toFixed(2).replace('.', ',')}.`,
          detalhes: JSON.stringify({
            vendaId: venda.id,
            revendedoraNome: consignado.usuario.nome,
            produtoNome: nomeProd,
            produtoCodigo: codProd,
            quantidade,
            precoVenda: precoFinal,
            valorTotal,
            comissaoValor: comissaoValorFinal,
            data: venda.data
          }),
          lojaId: req.lojaId
        }
      });
      dispararNotificacaoRealtime(req.lojaId, novaNotif);
    } catch (notifErr) {
      console.error("Erro ao gerar notificação de venda no backend:", notifErr);
    }



    res.status(201).json({
      venda,
      resumo: {
        nomeProduto: consignado.produtoVariacao?.produto?.nome || 'Produto',
        quantidade,
        totalVenda: consignado.precoVenda * quantidade,
        comissaoValor: comissaoValorFinal,
        qtdRestanteNaMaleta: novaQtd,
        linkSimulado
      }
    });
  } catch (error) {
    console.error('Erro ao registrar venda da revendedora:', error);
    res.status(500).json({ error: 'Erro ao registrar venda.' });
  }
});

// Listar vendas da revendedora logada
app.get('/api/vendas-revendedora', autenticarJWT, identificarLoja, async (req, res) => {
  try {
    let where = { lojaId: req.lojaId };
    if (!['Manager', 'SuperAdmin'].includes(req.user.role)) {
      where.usuarioId = req.user.id;
    } else if (req.query.usuarioId) {
      const revendedora = await prisma.usuario.findFirst({
        where: { id: req.query.usuarioId, lojaId: req.lojaId }
      });
      if (!revendedora) {
        return res.status(403).json({ error: 'Usuário não encontrado nesta loja.' });
      }
      where.usuarioId = req.query.usuarioId;
    }

    // Se solicitado apenas pendentes e temos um usuarioId definido
    if (req.query.apenasPendentes === 'true' && where.usuarioId) {
      // Busca o último acerto deste usuário
      const ultimoAcerto = await prisma.historicoAcerto.findFirst({
        where: { usuarioId: where.usuarioId, lojaId: req.lojaId },
        orderBy: { data: 'desc' }
      });
      if (ultimoAcerto) {
        where.data = {
          gt: ultimoAcerto.data
        };
      }
    }

    const vendas = await prisma.vendaRevendedora.findMany({
      where,
      orderBy: { data: 'desc' },
      include: {
        usuario: { select: { nome: true, whatsapp: true } },
        cliente: { select: { nome: true, whatsapp: true } }
      }
    });
    res.json(vendas);
  } catch (error) {
    console.error('Erro ao listar vendas:', error);
    res.status(500).json({ error: 'Erro ao listar vendas.' });
  }
});


// ==========================================
// UPLOADS NO AZURE BLOB STORAGE
// ==========================================

app.post('/api/uploads', autenticarJWT, upload.single('imagem'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }

  // Se não estiver configurado o Azure Blob Storage, realiza upload local na pasta de uploads
  if (!containerClient) {
    console.warn("Aviso: Azure Blob Storage não configurado. Salvando imagem localmente.");
    try {
      const ext = path.extname(req.file.originalname) || '.png';
      const localFileName = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}${ext}`;
      const localFilePath = path.join(UPLOADS_DIR, localFileName);
      fs.writeFileSync(localFilePath, req.file.buffer);
      
      // Retorna a URL relativa local
      return res.json({ url: `/uploads/${localFileName}` });
    } catch (err) {
      console.error("Erro ao salvar arquivo localmente:", err);
      return res.status(500).json({ error: 'Erro ao salvar imagem localmente.' });
    }
  }

  try {
    const blobName = `semijoia_${Date.now()}_${Math.random().toString(36).substr(2, 5)}_${req.file.originalname.replace(/\s+/g, '_')}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    // Faz o upload do buffer diretamente para o contêiner na Azure
    await blockBlobClient.upload(req.file.buffer, req.file.buffer.length, {
      blobHTTPHeaders: { blobContentType: req.file.mimetype }
    });

    // Retorna a URL pública
    res.json({ url: blockBlobClient.url });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao subir imagem no Azure Blob Storage.' });
  }
});

// ==========================================
// ROTA DE IMPORTAÇÃO EM MASSA (EXCEL/CSV)
// ==========================================

app.post('/api/importar', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, autorizarPlano(['BRONZE', 'GOLD', 'PLATINUM']), async (req, res) => {
  const { produtos, revendedoras, substituirTudo } = req.body;

  try {
    // 1. Validação de Limites de Plano na Importação em Massa (SaaS)
    
    // Validar limite de consultoras
    if (revendedoras && revendedoras.length > 0) {
      let novasConsultorasCount = 0;
      if (substituirTudo) {
        novasConsultorasCount = revendedoras.length;
        const limitCheck = await verificarLimiteConsultoras(req.lojaId, novasConsultorasCount);
        if (!limitCheck.ok) {
          const limite = limitCheck.limite;
          if (novasConsultorasCount > limite) {
            return res.status(403).json({ error: `A importação de ${novasConsultorasCount} revendedoras ultrapassa o limite do plano ${limitCheck.plano} (máximo ${limite} consultoras).` });
          }
        }
      } else {
        const nomesPlanilha = revendedoras.map(r => r.nome);
        const emailsPlanilha = revendedoras.map(r => r.email || '');
        const existentes = await prisma.usuario.count({
          where: {
            lojaId: req.lojaId,
            role: 'Consultant',
            OR: [
              { email: { in: emailsPlanilha } },
              { nome: { in: nomesPlanilha } }
            ]
          }
        });
        novasConsultorasCount = Math.max(0, revendedoras.length - existentes);
        if (novasConsultorasCount > 0) {
          const limitCheck = await verificarLimiteConsultoras(req.lojaId, novasConsultorasCount);
          if (!limitCheck.ok) {
            return res.status(403).json({ error: `A importação adicionará ${novasConsultorasCount} novas revendedoras, o que excede o limite atual do seu plano. ${limitCheck.error}` });
          }
        }
      }
    }

    // Validar limite de estoque (peças)
    if (produtos && produtos.length > 0) {
      let totalPecasPlanilha = produtos.reduce((sum, p) => sum + (parseInt(p.quantidade) || 0), 0);
      if (substituirTudo) {
        const lojaObj = await prisma.loja.findUnique({ where: { id: req.lojaId } });
        const plano = lojaObj ? (lojaObj.plano || 'BRONZE').toUpperCase() : 'BRONZE';
        if (plano !== 'PLATINUM') {
          let limite = 300;
          if (plano === 'BASICO') limite = 100;
          else if (plano === 'BRONZE') limite = 300;
          else if (plano === 'GOLD') limite = 1500;
          if (totalPecasPlanilha > limite) {
            return res.status(403).json({ error: `O estoque total da planilha (${totalPecasPlanilha} peças) excede o limite permitido pelo plano ${plano} (${limite} peças).` });
          }
        }
      } else {
        let estoqueAdicionalEstimado = 0;
        for (const p of produtos) {
          const existente = await prisma.produto.findFirst({
            where: { codigo: p.codigo, lojaId: req.lojaId },
            include: { variacoes: true }
          });
          const novaQtd = parseInt(p.quantidade) || 0;
          if (existente) {
            const variacao = existente.variacoes.find(v => v.tamanho === "Único" && v.banho === "OURO") || existente.variacoes[0];
            const qtdAtual = variacao ? (variacao.quantidade || 0) : 0;
            if (novaQtd > qtdAtual) {
              estoqueAdicionalEstimado += (novaQtd - qtdAtual);
            }
          } else {
            estoqueAdicionalEstimado += novaQtd;
          }
        }
        if (estoqueAdicionalEstimado > 0) {
          const limitCheck = await verificarLimiteEstoque(req.lojaId, estoqueAdicionalEstimado);
          if (!limitCheck.ok) {
            return res.status(403).json({ error: `A importação adicionará cerca de ${estoqueAdicionalEstimado} peças ao estoque, o que excede o limite atual do seu plano. ${limitCheck.error}` });
          }
        }
      }
    }

    if (substituirTudo) {
      // Limpa todas as tabelas (exceto administradores) da loja atual
      await prisma.$transaction([
        prisma.consignado.deleteMany({ where: { lojaId: req.lojaId } }),
        prisma.historicoAcerto.deleteMany({ where: { lojaId: req.lojaId } }),
        prisma.vendaDireta.deleteMany({ where: { lojaId: req.lojaId } }),
        prisma.vendaRevendedora.deleteMany({ where: { lojaId: req.lojaId } }),
        prisma.produto.deleteMany({ where: { lojaId: req.lojaId } }),
        prisma.usuario.deleteMany({ where: { role: 'Consultant', lojaId: req.lojaId } })
      ]);
    }

    // Importa Produtos
    if (produtos && produtos.length > 0) {
      for (const p of produtos) {
        const existente = await prisma.produto.findFirst({ where: { codigo: p.codigo, lojaId: req.lojaId } });

        if (existente) {
          if (!substituirTudo) {
            const produtoAtualizado = await prisma.produto.update({
              where: { id: existente.id },
              data: {
                custoBruto: parseFloat(p.custoBruto) || 0.0,
                custoBanho: parseFloat(p.custoBanho) || 0.0,
                custoLiquido: parseFloat(p.custoLiquido) || 0.0,
                markup: parseFloat(p.markup) || 3.0
              },
              include: { variacoes: true }
            });

            const cod = p.codigo || produtoAtualizado.codigo;
            let variacao = produtoAtualizado.variacoes.find(v => v.tamanho === "Único" && v.banho === "OURO");
            if (variacao) {
              await prisma.produtoVariacao.update({
                where: { id: variacao.id },
                data: {
                  sku: `${cod}-UN-OU`,
                  quantidade: parseInt(p.quantidade) || 0
                }
              });
            } else {
              await prisma.produtoVariacao.create({
                data: {
                  lojaId: req.lojaId,
                  produtoId: produtoAtualizado.id,
                  sku: `${cod}-UN-OU`,
                  tamanho: "Único",
                  banho: "OURO",
                  quantidade: parseInt(p.quantidade) || 0
                }
              });
            }
          }
        } else {
          await prisma.produto.create({
            data: {
              id: p.id && !p.id.startsWith('prod_') ? p.id : undefined,
              codigo: p.codigo,
              nome: p.nome,
              categoria: p.categoria || 'Outros',
              custoBruto: parseFloat(p.custoBruto) || 0.0,
              custoBanho: parseFloat(p.custoBanho) || 0.0,
              custoLiquido: parseFloat(p.custoLiquido) || 0.0,
              markup: parseFloat(p.markup) || 3.0,
              lojaId: req.lojaId,
              variacoes: {
                create: {
                  lojaId: req.lojaId,
                  sku: `${p.codigo}-UN-OU`,
                  tamanho: "Único",
                  banho: "OURO",
                  quantidade: parseInt(p.quantidade) || 0
                }
              }
            }
          });
        }
      }
    }

    // Importa Revendedoras
    const novasRevendedorasSenhas = [];
    if (revendedoras && revendedoras.length > 0) {
      for (const r of revendedoras) {
        const emailTemporario = r.email || (r.nome.toLowerCase().replace(/\s+/g, '') + "_" + Math.floor(Math.random() * 1000) + "@conectajoias.com");

        let existente = await prisma.usuario.findFirst({
          where: {
            lojaId: req.lojaId,
            OR: [
              { email: emailTemporario },
              { nome: { equals: r.nome } }
            ]
          }
        });

        let revendedoraId;

        if (existente) {
          revendedoraId = existente.id;
          if (!substituirTudo) {
            await prisma.usuario.update({
              where: { id: existente.id },
              data: {
                whatsapp: r.whatsapp,
                comissao: parseFloat(r.comissao) || 30.0
              }
            });
          }
        } else {
          const senhaGerada = gerarSenhaAleatoria(8);
          const senhaHash = await bcrypt.hash(senhaGerada, 10);
          const pin = r.pin || Math.floor(1000 + Math.random() * 9000).toString();

          const novaRev = await prisma.usuario.create({
            data: {
              id: r.id && !r.id.startsWith('rev_') ? r.id : undefined,
              nome: r.nome,
              email: emailTemporario,
              pin: pin,
              senhaHash: senhaHash,
              role: 'Consultant',
              whatsapp: r.whatsapp,
              comissao: parseFloat(r.comissao) || 30.0,
              lojaId: req.lojaId
            }
          });
          revendedoraId = novaRev.id;
          novasRevendedorasSenhas.push({
            nome: r.nome,
            email: emailTemporario,
            pin: pin,
            senha: senhaGerada
          });
        }

        // Importa itens consignados da maleta
        if (r.consignado && r.consignado.length > 0) {
          for (const c of r.consignado) {
            const prod = await prisma.produto.findFirst({
              where: { codigo: c.codigo, lojaId: req.lojaId },
              include: { variacoes: true }
            });
            if (prod && prod.variacoes.length > 0) {
              const variacao = prod.variacoes.find(v => v.tamanho === "Único" && v.banho === "OURO") || prod.variacoes[0];
              const consExistente = await prisma.consignado.findFirst({
                where: {
                  usuarioId: revendedoraId,
                  produtoVariacaoId: variacao.id,
                  lojaId: req.lojaId
                }
              });

              if (consExistente) {
                await prisma.consignado.update({
                  where: { id: consExistente.id },
                  data: {
                    quantidadeConsignada: substituirTudo ? parseInt(c.quantidadeConsignada) : (consExistente.quantidadeConsignada + parseInt(c.quantidadeConsignada)),
                    precoVenda: parseFloat(c.precoVenda) || (prod.custoBruto + prod.custoBanho + prod.custoLiquido) * prod.markup
                  }
                });
              } else {
                await prisma.consignado.create({
                  data: {
                    usuarioId: revendedoraId,
                    produtoVariacaoId: variacao.id,
                    quantidadeConsignada: parseInt(c.quantidadeConsignada) || 0,
                    precoVenda: parseFloat(c.precoVenda) || (prod.custoBruto + prod.custoBanho + prod.custoLiquido) * prod.markup,
                    lojaId: req.lojaId
                  }
                });
              }
            }
          }
        }
      }
    }

    res.json({
      message: 'Dados importados e sincronizados com sucesso no banco de dados SQLite!',
      novasRevendedoras: novasRevendedorasSenhas
    });
  } catch (error) {
    console.error("Erro na importação em massa:", error);
    res.status(500).json({ error: 'Erro ao processar importação no banco de dados.' });
  }
});

// ==========================================
// ROTAS DE CLIENTES
// ==========================================

// Listar Clientes
app.get('/api/clientes', autenticarJWT, autorizarRole(['Consultant', 'Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  try {
    let where = { lojaId: req.lojaId };
    // Consultoras só veem os clientes que cadastraram
    if (req.user.role === 'Consultant') {
      where.usuarioId = req.user.id;
    }
    const clientes = await prisma.cliente.findMany({
      where,
      include: {
        usuario: {
          select: {
            nome: true
          }
        }
      },
      orderBy: { nome: 'asc' }
    });
    res.json(clientes);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar clientes.' });
  }
});

// Criar Cliente
app.post('/api/clientes', autenticarJWT, autorizarRole(['Consultant', 'Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { nome, whatsapp, dataNascimento, observacoes } = req.body;
  if (!nome || !whatsapp) {
    return res.status(400).json({ error: 'Nome e WhatsApp são obrigatórios.' });
  }

  const isConsultant = req.user.role === 'Consultant';
  const userFilter = isConsultant ? req.user.id : null;

  try {
    // Validar se o cliente já existe para este mesmo usuário (ou loja para admin)
    const existente = await prisma.cliente.findFirst({
      where: {
        lojaId: req.lojaId,
        whatsapp,
        usuarioId: userFilter
      }
    });

    if (existente) {
      return res.status(400).json({ error: 'Já existe uma cliente cadastrada com este WhatsApp.' });
    }

    const cliente = await prisma.cliente.create({
      data: {
        nome,
        whatsapp,
        dataNascimento: dataNascimento || null,
        observacoes: observacoes || null,
        lojaId: req.lojaId,
        usuarioId: userFilter
      }
    });
    res.status(201).json(cliente);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao cadastrar cliente.' });
  }
});

// Editar Cliente
app.put('/api/clientes/:id', autenticarJWT, autorizarRole(['Consultant', 'Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { id } = req.params;
  const { nome, whatsapp, dataNascimento, observacoes } = req.body;

  let searchWhere = { id, lojaId: req.lojaId };
  if (req.user.role === 'Consultant') {
    searchWhere.usuarioId = req.user.id;
  }

  try {
    const cliente = await prisma.cliente.findFirst({ where: searchWhere });
    if (!cliente) {
      return res.status(403).json({ error: 'Acesso negado ou cliente não encontrada.' });
    }

    // Se mudou whatsapp, garante que não colide com outra cliente do mesmo usuário/loja
    if (whatsapp && whatsapp !== cliente.whatsapp) {
      const colide = await prisma.cliente.findFirst({
        where: {
          lojaId: req.lojaId,
          whatsapp,
          usuarioId: req.user.role === 'Consultant' ? req.user.id : null,
          id: { not: id }
        }
      });
      if (colide) {
        return res.status(400).json({ error: 'Já existe outra cliente cadastrada com este WhatsApp.' });
      }
    }

    const clienteAtualizado = await prisma.cliente.update({
      where: { id },
      data: { nome, whatsapp, dataNascimento: dataNascimento || null, observacoes: observacoes || null }
    });
    res.json(clienteAtualizado);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar cliente.' });
  }
});

// Excluir Cliente
app.delete('/api/clientes/:id', autenticarJWT, autorizarRole(['Consultant', 'Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { id } = req.params;

  let searchWhere = { id, lojaId: req.lojaId };
  if (req.user.role === 'Consultant') {
    searchWhere.usuarioId = req.user.id;
  }

  try {
    const cliente = await prisma.cliente.findFirst({ where: searchWhere });
    if (!cliente) {
      return res.status(403).json({ error: 'Acesso negado ou cliente não encontrada.' });
    }

    await prisma.cliente.delete({ where: { id } });
    res.json({ message: 'Cliente removida com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir cliente.' });
  }
});

// Listar clientes aniversariantes (do dia e do mês)
app.get('/api/clientes/aniversariantes', autenticarJWT, autorizarRole(['Consultant', 'Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  try {
    const hoje = new Date();
    const mesAtual = String(hoje.getMonth() + 1).padStart(2, '0');
    const diaAtual = String(hoje.getDate()).padStart(2, '0');

    let where = { lojaId: req.lojaId };
    if (req.user.role === 'Consultant') {
      where.usuarioId = req.user.id;
    }

    const clientes = await prisma.cliente.findMany({
      where,
      select: { id: true, nome: true, whatsapp: true, dataNascimento: true, usuario: { select: { nome: true } } }
    });

    const aniversariantesHoje = [];
    const aniversariantesMes = [];

    for (const cli of clientes) {
      if (!cli.dataNascimento) continue;
      const parts = cli.dataNascimento.split(/[-/]/);
      let mes = '', dia = '';
      if (parts[0].length === 4) { // YYYY-MM-DD
        mes = parts[1];
        dia = parts[2];
      } else if (parts[2] && parts[2].length === 4) { // DD/MM/YYYY
        dia = parts[0];
        mes = parts[1];
      }

      if (mes === mesAtual) {
        const item = { ...cli, eHoje: dia === diaAtual };
        aniversariantesMes.push(item);
        if (dia === diaAtual) {
          aniversariantesHoje.push(item);
        }
      }
    }

    res.json({ hoje: aniversariantesHoje, mes: aniversariantesMes });
  } catch (error) {
    console.error('Erro ao buscar aniversariantes:', error);
    res.status(500).json({ error: 'Erro ao carregar aniversariantes.' });
  }
});
app.delete('/api/clientes', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  try {
    await prisma.cliente.deleteMany({
      where: { lojaId: req.lojaId }
    });
    res.json({ message: 'Todas as clientes foram removidas com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir todas as clientes.' });
  }
});

// ==========================================
// ROTAS DE NOTIFICAÇÕES (ADMIN)
// ==========================================

let sseClients = [];

function dispararNotificacaoRealtime(lojaId, notificacao) {
  // Envia a notificação somente para quem é o destinatário correto
  sseClients.forEach(c => {
    if (c.lojaId === lojaId) {
      const isDestinatario = 
        // Notificação para administrador (destinatarioId null) e o cliente SSE é admin
        (notificacao.destinatarioId === null && (c.role === 'Manager' || c.role === 'SuperAdmin')) ||
        // Notificação para uma revendedora específica (destinatarioId === c.usuarioId)
        (notificacao.destinatarioId !== null && c.usuarioId === notificacao.destinatarioId);

      if (isDestinatario) {
        try {
          c.res.write(`data: ${JSON.stringify({ tipo: 'notificacao', data: notificacao })}\n\n`);
        } catch (err) {
          console.error('Erro ao enviar mensagem SSE para cliente:', err.message);
        }
      }
    }
  });
}

async function criarNotificacao(lojaId, tipo, message, detalhesObj = {}, destinatarioId = null) {
  try {
    const novaNotif = await prisma.notificacao.create({
      data: {
        tipo,
        mensagem: message,
        detalhes: JSON.stringify(detalhesObj),
        destinatarioId,
        lojaId
      }
    });
    dispararNotificacaoRealtime(lojaId, novaNotif);
    return novaNotif;
  } catch (error) {
    console.error("Erro ao criar/disparar notificação:", error);
  }
}

async function notificarModificacaoCatalogo(lojaId) {
  try {
    const revendedoras = await prisma.usuario.findMany({
      where: { role: 'Consultant', lojaId }
    });
    for (const rev of revendedoras) {
      await criarNotificacao(
        lojaId,
        'atualizacao_catalogo',
        'O catálogo de semijoias da administradora foi atualizado! Verifique as novidades.',
        { dataAlteracao: new Date().toISOString() },
        rev.id
      );
    }
  } catch (err) {
    console.error("Erro ao notificar modificação de catálogo:", err);
  }
}

// Canal de notificações em tempo real (SSE)
app.get('/api/realtime/notificacoes', autenticarJWT, autorizarRole(['Consultant', 'Manager', 'SuperAdmin']), identificarLoja, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const cliente = {
    id: Date.now(),
    lojaId: req.lojaId,
    role: req.user ? req.user.role : 'Manager',
    usuarioId: req.user ? req.user.id : null,
    res
  };
  sseClients.push(cliente);

  // Envia ping inicial
  res.write(`data: ${JSON.stringify({ tipo: 'ping', message: 'Conectado ao canal de notificações em tempo real.' })}\n\n`);

  // Mantém a conexão ativa com pings a cada 15 segundos
  const keepAlive = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ tipo: 'ping' })}\n\n`);
    } catch (e) {
      clearInterval(keepAlive);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients = sseClients.filter(c => c.id !== cliente.id);
  });
});

// Listar notificações não lidas
app.get('/api/notificacoes', autenticarJWT, autorizarRole(['Consultant', 'Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  try {
    let where = { lida: false, lojaId: req.lojaId };
    if (req.user.role === 'Consultant') {
      where.destinatarioId = req.user.id;
    } else {
      where.destinatarioId = null; // Admins recebem apenas notificações sem destinatário específico
    }

    const notificacoes = await prisma.notificacao.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
    res.json(notificacoes);
  } catch (error) {
    console.error('Erro ao buscar notificações:', error);
    res.status(500).json({ error: 'Erro ao buscar notificações.' });
  }
});

// Marcar notificações como lidas
app.put('/api/notificacoes/ler', autenticarJWT, autorizarRole(['Consultant', 'Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { ids } = req.body;
  try {
    let where = { lojaId: req.lojaId };
    if (req.user.role === 'Consultant') {
      where.destinatarioId = req.user.id;
    } else {
      where.destinatarioId = null;
    }

    if (ids && Array.isArray(ids) && ids.length > 0) {
      await prisma.notificacao.updateMany({
        where: { id: { in: ids }, ...where },
        data: { lida: true }
      });
    } else {
      await prisma.notificacao.updateMany({
        where: { lida: false, ...where },
        data: { lida: true }
      });
    }
    res.json({ message: 'Notificações marcadas como lidas!' });
  } catch (error) {
    console.error('Erro ao marcar notificações como lidas:', error);
    res.status(500).json({ error: 'Erro ao marcar notificações.' });
  }
});

// ==========================================
// ROTAS DE CONFIGURAÇÃO (WHITE-LABEL)
// ==========================================

// GET /api/config - Buscar configuração pública da loja
app.get('/api/config', autenticarJWTOpcional, identificarLoja, async (req, res) => {
  try {
    let config = await prisma.configuracao.findFirst({
      where: { lojaId: req.lojaId }
    });
    if (!config) {
      let lojaExiste = await prisma.loja.findUnique({ where: { id: req.lojaId } });
      if (!lojaExiste) {
        lojaExiste = await prisma.loja.create({
          data: { id: req.lojaId, nome: 'Minha Marca de Semijoias' }
        });
      }
      config = await prisma.configuracao.create({
        data: {
          lojaId: lojaExiste.id,
          nomeEmpresa: lojaExiste.nome || 'Conecta Joias',
          logoUrl: '',
          corPrimaria: '#d4af37',
          corSecundaria: '#111111',
          bgPrimary: '#0a0a0a',
          bgCard: '#121212',
          whatsappAtendimento: '',
          temaPref: 'Escuro',
          segmento: 'Semijoias',
          estiloLoja: 'Premium',
          onboardingCompleto: false
        }
      });
    }
    const loja = await prisma.loja.findUnique({ where: { id: req.lojaId } });
    const plano = (loja ? loja.plano : 'BASICO') || 'BASICO';
    res.json({
      ...config,
      plano: plano.toUpperCase()
    });
  } catch (error) {
    console.error('Erro ao buscar configuração:', error);
    res.status(500).json({ error: 'Erro ao carregar configurações da loja.' });
  }
});

// PUT /api/config - Atualizar configuração da loja (Somente Admin)
app.put('/api/config', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { nomeEmpresa, logoUrl, corPrimaria, corSecundaria, bgPrimary, bgCard, whatsappAtendimento, temaPref, segmento, estiloLoja, instagram, tiktok, site, onboardingCompleto } = req.body;
  try {
    let config = await prisma.configuracao.findFirst({
      where: { lojaId: req.lojaId }
    });
    if (!config) {
      config = await prisma.configuracao.create({
        data: {
          lojaId: req.lojaId,
          nomeEmpresa: nomeEmpresa || 'Conecta Joias',
          logoUrl: logoUrl || '',
          corPrimaria: corPrimaria || '#d4af37',
          corSecundaria: corSecundaria || '#111111',
          bgPrimary: bgPrimary || '#0a0a0a',
          bgCard: bgCard || '#121212',
          whatsappAtendimento: whatsappAtendimento || '',
          temaPref: temaPref || 'Escuro',
          segmento: segmento || 'Semijoias',
          estiloLoja: estiloLoja || 'Premium',
          onboardingCompleto: onboardingCompleto !== undefined ? onboardingCompleto : false
        }
      });
    } else {
      config = await prisma.configuracao.update({
        where: { id: config.id },
        data: {
          nomeEmpresa: nomeEmpresa !== undefined ? nomeEmpresa : config.nomeEmpresa,
          logoUrl: logoUrl !== undefined ? logoUrl : config.logoUrl,
          corPrimaria: corPrimaria !== undefined ? corPrimaria : config.corPrimaria,
          corSecundaria: corSecundaria !== undefined ? corSecundaria : config.corSecundaria,
          bgPrimary: bgPrimary !== undefined ? bgPrimary : config.bgPrimary,
          bgCard: bgCard !== undefined ? bgCard : config.bgCard,
          whatsappAtendimento: whatsappAtendimento !== undefined ? whatsappAtendimento : config.whatsappAtendimento,
          temaPref: temaPref !== undefined ? temaPref : config.temaPref,
          segmento: segmento !== undefined ? segmento : config.segmento,
          estiloLoja: estiloLoja !== undefined ? estiloLoja : config.estiloLoja,
          instagram: instagram !== undefined ? instagram : (config.instagram || ''),
          tiktok: tiktok !== undefined ? tiktok : (config.tiktok || ''),
          site: site !== undefined ? site : (config.site || ''),
          onboardingCompleto: onboardingCompleto !== undefined ? onboardingCompleto : config.onboardingCompleto
        }
      });
    }
    // Sincroniza o logoUrl diretamente na tabela Loja
    if (logoUrl !== undefined) {
      await prisma.loja.update({
        where: { id: req.lojaId },
        data: { logoUrl: logoUrl }
      });
    }
    await registrarLog(req, 'Atualizar Configurações', `Configuração alterada: ${JSON.stringify(config)}`);
    res.json(config);
  } catch (error) {
    console.error('Erro ao atualizar configuração:', error);
    res.status(500).json({ error: 'Erro ao atualizar configurações da loja.' });
  }
});

// ==========================================
// ROTAS EXCLUSIVAS DO SuperAdmin (Gestão Global de Lojas)
// ==========================================

// Listar todas as lojas (apenas SuperAdmin)
app.get('/api/admin/lojas', autenticarJWT, autorizarRole(['SuperAdmin']), async (req, res) => {
  try {
    const lojas = await prisma.loja.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { usuarios: true, produtos: true }
        }
      }
    });
    res.json(lojas);
  } catch (error) {
    console.error('Erro ao listar lojas:', error);
    res.status(500).json({ error: 'Erro ao listar lojas.' });
  }
});

// Criar nova loja (apenas SuperAdmin)
app.post('/api/admin/lojas', autenticarJWT, autorizarRole(['SuperAdmin']), async (req, res) => {
  const { nome, cnpj } = req.body;
  if (!nome) {
    return res.status(400).json({ error: 'O nome da loja é obrigatório.' });
  }
  try {
    const novaLoja = await prisma.loja.create({
      data: { nome, cnpj: cnpj || null }
    });
    // Cria a configuração padrão da nova loja
    await prisma.configuracao.create({
      data: {
        lojaId: novaLoja.id,
        nomeEmpresa: nome,
        logoUrl: '',
        corPrimaria: '#d4af37',
        corSecundaria: '#111111',
        bgPrimary: '#0a0a0a',
        bgCard: '#121212',
        temaPref: 'ESCURO'
      }
    });
    await registrarLog(req, 'CRIAR_LOJA', `SuperAdmin criou a loja: ${nome} (ID: ${novaLoja.id})`);
    res.status(201).json(novaLoja);
  } catch (error) {
    console.error('Erro ao criar loja:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Já existe uma loja com este CNPJ.' });
    }
    res.status(500).json({ error: 'Erro ao criar loja.' });
  }
});

// Obter detalhes de uma loja específica (SuperAdmin)
app.get('/api/admin/lojas/:id', autenticarJWT, autorizarRole(['SuperAdmin']), async (req, res) => {
  const { id } = req.params;
  try {
    const loja = await prisma.loja.findUnique({
      where: { id },
      include: {
        configuracao: true,
        _count: { select: { usuarios: true, produtos: true, vendasDireta: true } }
      }
    });
    if (!loja) {
      return res.status(404).json({ error: 'Loja não encontrada.' });
    }
    res.json(loja);
  } catch (error) {
    console.error('Erro ao buscar loja:', error);
    res.status(500).json({ error: 'Erro ao buscar loja.' });
  }
});


// ==========================================
// NOVAS ROTAS - GESTÃO DE REVENDEDORAS E PAGAMENTOS
// ==========================================

// 1. Onboarding público de revendedora (Sem autenticação)
app.post('/api/public/onboarding', signupLimiter, uploadDocs.fields([
  { name: 'rgFrenteFile', maxCount: 1 },
  { name: 'rgVersoFile', maxCount: 1 },
  { name: 'cpfFile', maxCount: 1 },
  { name: 'enderecoFile', maxCount: 1 },
  { name: 'termoFile', maxCount: 1 }
]), async (req, res) => {
  const { nome, email, whatsapp, cpf, rg, endereco, vendedoraPrincipal, comoConheceu, experienciaVendas, comentarios, lojaId } = req.body;

  if (!nome || !email || !whatsapp || !cpf) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes: nome, e-mail, whatsapp e CPF.' });
  }

  const lid = lojaId || 'default-loja';

  try {
    // Validação de limite de plano de assinatura para consultoras (SaaS)
    const limitCheck = await verificarLimiteConsultoras(lid, 1);
    if (!limitCheck.ok) {
      return res.status(403).json({ error: limitCheck.error });
    }

    // Verifica e-mail ou cpf existente
    const usuarioExiste = await prisma.usuario.findFirst({
      where: {
        OR: [
          { email },
          { pin: whatsapp.replace(/\D/g, '').slice(-4) }
        ]
      }
    });

    if (usuarioExiste) {
      return res.status(400).json({ error: 'Este e-mail ou um número com final de WhatsApp semelhante já possui cadastro.' });
    }

    const pin = await gerarPinUnico();
    const senhaProvisoria = Math.floor(100000 + Math.random() * 900000).toString(); // senha provisória de 6 dígitos
    const senhaHash = await bcrypt.hash(senhaProvisoria, 10);

    const novoUsuario = await prisma.usuario.create({
      data: {
        nome,
        email,
        whatsapp,
        pin,
        senhaHash,
        role: 'Consultant',
        documentoCpf: cpf,
        documentoRg: rg,
        documentoEndereco: endereco,
        lojaId: lid,
        respostaOnboarding: {
          create: {
            vendedoraPrincipal,
            comoConheceu,
            experienciaVendas,
            comentarios
          }
        }
      }
    });

    // Salvar caminhos dos arquivos do upload no cofre virtual (Azure ou Local)
    const arquivos = req.files;
    if (arquivos) {
      const docsToCreate = [];
      if (arquivos.rgFrenteFile && arquivos.rgFrenteFile[0]) {
        const file = arquivos.rgFrenteFile[0];
        const url = await uploadArquivoParaStorage(file.buffer, file.originalname, file.mimetype, 'documentos');
        docsToCreate.push({
          tipo: 'RG_FRENTE',
          nomeArquivo: file.originalname,
          caminhoUrl: url
        });
      }
      if (arquivos.rgVersoFile && arquivos.rgVersoFile[0]) {
        const file = arquivos.rgVersoFile[0];
        const url = await uploadArquivoParaStorage(file.buffer, file.originalname, file.mimetype, 'documentos');
        docsToCreate.push({
          tipo: 'RG_VERSO',
          nomeArquivo: file.originalname,
          caminhoUrl: url
        });
      }
      if (arquivos.cpfFile && arquivos.cpfFile[0]) {
        const file = arquivos.cpfFile[0];
        const url = await uploadArquivoParaStorage(file.buffer, file.originalname, file.mimetype, 'documentos');
        docsToCreate.push({
          tipo: 'CPF',
          nomeArquivo: file.originalname,
          caminhoUrl: url
        });
      }
      if (arquivos.enderecoFile && arquivos.enderecoFile[0]) {
        const file = arquivos.enderecoFile[0];
        const url = await uploadArquivoParaStorage(file.buffer, file.originalname, file.mimetype, 'documentos');
        docsToCreate.push({
          tipo: 'COMPROVANTE_RESIDENCIA',
          nomeArquivo: file.originalname,
          caminhoUrl: url
        });
      }
      if (arquivos.termoFile && arquivos.termoFile[0]) {
        const file = arquivos.termoFile[0];
        const url = await uploadArquivoParaStorage(file.buffer, file.originalname, file.mimetype, 'documentos');
        docsToCreate.push({
          tipo: 'TERMO_RESPONSABILIDADE',
          nomeArquivo: file.originalname,
          caminhoUrl: url
        });
      }

      if (docsToCreate.length > 0) {
        for (const doc of docsToCreate) {
          await prisma.documentoUsuario.create({
            data: {
              usuarioId: novoUsuario.id,
              tipo: doc.tipo,
              nomeArquivo: doc.nomeArquivo,
              caminhoUrl: doc.caminhoUrl
            }
          });
        }
      }
    }

    await prisma.logAcao.create({
      data: {
        usuarioId: novoUsuario.id,
        usuarioNome: nome,
        acao: 'VENDEDORA_ONBOARDING',
        detalhes: `Revendedora preencheu o questionário e cadastrou-se pelo link de onboarding. PIN: ${pin}`
      }
    });

    res.status(201).json({
      message: 'Onboarding realizado com sucesso!',
      pin,
      senha: senhaProvisoria
    });

  } catch (error) {
    console.error('Erro no onboarding público:', error);
    res.status(500).json({ error: `Erro no processamento do cadastro: ${error.message}` });
  }
});

// Mapa em memória para tokens/códigos de redefinição de senha (válidos por 15 min)
const codigosRecuperacao = new Map();

// Solicitar código de redefinição de senha
app.post('/api/public/solicitar-recuperacao-senha', signupLimiter, async (req, res) => {
  const { identificador } = req.body;
  if (!identificador) {
    return res.status(400).json({ error: 'Informe seu e-mail, PIN ou WhatsApp.' });
  }

  try {
    const identLimpo = identificador.trim();
    const usuario = await prisma.usuario.findFirst({
      where: {
        OR: [
          { email: identLimpo },
          { pin: identLimpo },
          { whatsapp: identLimpo.replace(/\D/g, '') }
        ]
      }
    });

    if (!usuario) {
      return res.json({ success: true, message: 'Se o identificador existir em nossa base, as instruções foram enviadas!' });
    }

    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    codigosRecuperacao.set(usuario.id, {
      codigo,
      expiresAt: Date.now() + 15 * 60 * 1000
    });

    if (usuario.whatsapp) {
      console.log(`🔑 [Recuperação de Senha] Código gerado para ${usuario.nome}: ${codigo}`);
    }

    res.json({
      success: true,
      message: 'Código de verificação gerado!',
      usuarioId: usuario.id,
      codigoSimulado: codigo
    });
  } catch (error) {
    console.error('Erro ao solicitar recuperação de senha:', error);
    res.status(500).json({ error: 'Erro ao processar solicitação de redefinição de senha.' });
  }
});

// Redefinir senha com o código de verificação
app.post('/api/public/redefinir-senha', signupLimiter, async (req, res) => {
  const { usuarioId, codigo, novaSenha } = req.body;
  if (!usuarioId || !codigo || !novaSenha) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios: usuário, código e nova senha.' });
  }

  if (novaSenha.length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter no mínimo 6 caracteres.' });
  }

  try {
    const info = codigosRecuperacao.get(usuarioId);
    if (!info || info.codigo !== codigo.trim() || Date.now() > info.expiresAt) {
      return res.status(400).json({ error: 'Código de verificação inválido ou expirado.' });
    }

    const senhaHash = await bcrypt.hash(novaSenha, 10);
    await prisma.usuario.update({
      where: { id: usuarioId },
      data: { senhaHash }
    });

    codigosRecuperacao.delete(usuarioId);

    await prisma.logAcao.create({
      data: {
        usuarioId,
        acao: 'RECUPERACAO_SENHA_SUCESSO',
        detalhes: 'Senha redefinida com sucesso pelo fluxo de segurança.'
      }
    });

    res.json({ message: 'Senha redefinida com sucesso! Você já pode fazer login com sua nova senha.' });
  } catch (error) {
    console.error('Erro ao redefinir senha:', error);
    res.status(500).json({ error: 'Erro ao redefinir senha.' });
  }
});


app.get('/api/usuarios/:id/documentos', autenticarJWT, identificarLoja, async (req, res) => {
  const { id } = req.params;
  try {
    // Consultant só pode acessar seus próprios documentos
    if (req.user.role === 'Consultant' && req.user.id !== id) {
      return res.status(403).json({ error: 'Acesso negado. Você só pode consultar seus próprios documentos.' });
    }

    // Se não for SuperAdmin, valida se pertence à mesma loja (apenas para Managers)
    if (req.user.role === 'Manager' && req.user.role !== 'SuperAdmin') {
      const usuarioDestino = await prisma.usuario.findFirst({
        where: { id: id, lojaId: req.lojaId }
      });
      if (!usuarioDestino) {
        return res.status(403).json({ error: 'Acesso negado. Este usuário não pertence à sua loja.' });
      }
    }

    const documentos = await prisma.documentoUsuario.findMany({
      where: { usuarioId: id }
    });
    const respostaOnb = await prisma.respostaOnboarding.findUnique({
      where: { usuarioId: id }
    });
    res.json({ documentos, respostaOnboarding: respostaOnb });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar documentos.' });
  }
});

// Novo endpoint: Upload de documentos para o cofre virtual da revendedora
app.post('/api/usuarios/documentos/upload', autenticarJWT, uploadDocs.fields([
  { name: 'rgFrente', maxCount: 1 },
  { name: 'rgVerso', maxCount: 1 },
  { name: 'documento', maxCount: 1 }
]), async (req, res) => {
  try {
    const usuarioId = req.user.id;
    const arquivos = req.files;

    if (!arquivos || Object.keys(arquivos).length === 0) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    const criados = [];

    if (arquivos.rgFrente && arquivos.rgFrente[0]) {
      const file = arquivos.rgFrente[0];
      const url = await uploadArquivoParaStorage(file.buffer, file.originalname, file.mimetype, 'documentos');
      const doc = await prisma.documentoUsuario.create({
        data: {
          usuarioId,
          tipo: 'RG_FRENTE',
          nomeArquivo: file.originalname,
          caminhoUrl: url
        }
      });
      criados.push(doc);
    }

    if (arquivos.rgVerso && arquivos.rgVerso[0]) {
      const file = arquivos.rgVerso[0];
      const url = await uploadArquivoParaStorage(file.buffer, file.originalname, file.mimetype, 'documentos');
      const doc = await prisma.documentoUsuario.create({
        data: {
          usuarioId,
          tipo: 'RG_VERSO',
          nomeArquivo: file.originalname,
          caminhoUrl: url
        }
      });
      criados.push(doc);
    }

    if (arquivos.documento && arquivos.documento[0]) {
      const file = arquivos.documento[0];
      const tipo = req.query.tipo || 'COMPROVANTE_RESIDENCIA';
      const url = await uploadArquivoParaStorage(file.buffer, file.originalname, file.mimetype, 'documentos');
      const doc = await prisma.documentoUsuario.create({
        data: {
          usuarioId,
          tipo: tipo,
          nomeArquivo: file.originalname,
          caminhoUrl: url
        }
      });
      criados.push(doc);
    }

    if (criados.length > 0) {
      try {
        await criarNotificacao(
          req.lojaId,
          'cofre_virtual_upload',
          `A revendedora ${req.user.nome} enviou ${criados.length} novo(s) documento(s)/foto(s) para o Cofre Virtual.`,
          { usuarioNome: req.user.nome, totalDocumentos: criados.length },
          null
        );
      } catch (notifErr) {
        console.error("Erro ao gerar notificação do cofre virtual:", notifErr);
      }
    }

    res.status(201).json({ message: 'Documentos carregados com sucesso!', documentos: criados });
  } catch (error) {
    console.error('Erro ao fazer upload de documentos:', error);
    res.status(500).json({ error: 'Erro ao fazer upload de documentos.' });
  }
});

// 3. Criar link de pagamento (Revendedora ou Admin)
app.post('/api/pagamentos/link', autenticarJWT, identificarLoja, autorizarPlano(['BRONZE', 'GOLD', 'PLATINUM']), async (req, res) => {
  const { clienteId, valor, formaEnvio, vendaId } = req.body;
  let formaEnvioEfetiva = formaEnvio || req.body.forma;
  if (formaEnvioEfetiva) {
    formaEnvioEfetiva = formaEnvioEfetiva.toUpperCase();
    if (formaEnvioEfetiva.includes("PIX")) formaEnvioEfetiva = "PIX";
    else if (formaEnvioEfetiva.includes("CARTA") || formaEnvioEfetiva.includes("CREDIT") || formaEnvioEfetiva.includes("DEBIT")) formaEnvioEfetiva = "CARTAO";
    else if (formaEnvioEfetiva.includes("BOLET")) formaEnvioEfetiva = "BOLETO";
  }

  if (!valor || !formaEnvioEfetiva) {
    return res.status(400).json({ error: 'Valor e Forma de Envio (PIX, BOLETO, CARTAO) são obrigatórios.' });
  }

  try {
    const linkId = Math.random().toString(36).substring(2, 15);
    const linkSimulado = `${frontendUrl}/pages/pagamento.html?id=${linkId}`;

    const link = await prisma.linkPagamento.create({
      data: {
        id: linkId,
        usuarioId: req.user.id,
        clienteId: clienteId || null,
        valor: parseFloat(valor),
        formaEnvio: formaEnvioEfetiva,
        status: 'PENDENTE',
        linkSimulado,
        vendaId: vendaId || null
      }
    });

    // Se houver uma vendaId, vamos atualizar a venda para apontar para o link e marcar como não paga temporariamente
    if (vendaId) {
      await prisma.vendaRevendedora.updateMany({
        where: { id: vendaId },
        data: {
          pago: false,
          linkPagamentoId: linkId
        }
      });
    }

    res.status(201).json(link);
  } catch (error) {
    console.error('Erro ao gerar link de pagamento:', error);
    res.status(500).json({ error: 'Erro ao gerar link de pagamento.' });
  }
});

// Buscar detalhes de um acerto de contas (Público)
app.get('/api/public/acertos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const acerto = await prisma.historicoAcerto.findUnique({
      where: { id },
      include: {
        usuario: { select: { nome: true, whatsapp: true } },
        loja: { select: { nome: true, logoUrl: true, corPrimaria: true, corSecundaria: true, bgPrimary: true, bgCard: true } }
      }
    });

    if (!acerto) {
      return res.status(404).json({ error: 'Recibo de acerto não encontrado.' });
    }

    res.json(acerto);
  } catch (error) {
    console.error('Erro ao buscar recibo de acerto público:', error);
    res.status(500).json({ error: 'Erro ao buscar dados do acerto.' });
  }
});

// Buscar detalhes de um link de pagamento (Público - sem JWT para o cliente final)
app.get('/api/public/pagamento/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const link = await prisma.linkPagamento.findUnique({
      where: { id },
      include: {
        usuario: { select: { nome: true } },
        cliente: { select: { nome: true, whatsapp: true } }
      }
    });
    if (!link) {
      return res.status(404).json({ error: 'Link de pagamento não encontrado.' });
    }

    const responseData = { ...link };

    // Se já tiver uma transação ASAAS e for PIX ou BOLETO e ainda estiver pendente,
    // busca os dados mais atualizados de QR Code/Linha digitável
    if (link.asaasPaymentId && link.status === 'PENDENTE') {
      try {
        if (link.formaEnvio === 'PIX') {
          const pixInfo = await obterQrCodePix(link.asaasPaymentId);
          responseData.pixQrCode = pixInfo.encodedImage;
          responseData.pixCopiaCola = pixInfo.payload;
        } else if (link.formaEnvio === 'BOLETO') {
          const boletoInfo = await obterCodigoBarrasBoleto(link.asaasPaymentId);
          responseData.boletoLinhaDigitavel = boletoInfo.identificationField;
          responseData.boletoCodigoBarras = boletoInfo.barCode;
        }
      } catch (err) {
        console.error('Erro ao recuperar dados dinâmicos do ASAAS:', err.message);
      }
    }

    res.json(responseData);
  } catch (error) {
    console.error('Erro ao buscar link de pagamento:', error);
    res.status(500).json({ error: 'Erro ao buscar link de pagamento.' });
  }
});

// Processar pagamento real via ASAAS (Público)
app.post('/api/public/pagamento/:id/processar', paymentLimiter, async (req, res) => {
  const { id } = req.params;
  const {
    formaEnvio,
    clienteNome,
    clienteCpfCnpj,
    clienteEmail,
    clienteWhatsapp,
    cartaoDados,
    enderecoDados
  } = req.body;

  if (!formaEnvio) {
    return res.status(400).json({ error: 'Forma de envio/pagamento é obrigatória.' });
  }

  try {
    const link = await prisma.linkPagamento.findUnique({
      where: { id },
      include: {
        cliente: true
      }
    });

    if (!link) {
      return res.status(404).json({ error: 'Link de pagamento não encontrado.' });
    }

    if (link.status === 'PAGO') {
      return res.status(400).json({ error: 'Este link de pagamento já foi pago.' });
    }

    // Chama o serviço ASAAS para criar a cobrança
    const cobranca = await criarCobranca({
      clienteNome: clienteNome || (link.cliente ? link.cliente.nome : 'Cliente Conecta Joias'),
      clienteCpfCnpj,
      clienteEmail,
      clienteWhatsapp: clienteWhatsapp || (link.cliente ? link.cliente.whatsapp : ''),
      valor: link.valor,
      formaEnvio,
      vendaId: link.vendaId,
      linkId: link.id,
      cartaoDados,
      enderecoDados
    });

    // Se for pagamento por Cartão e a transação já foi confirmada
    let statusNovo = 'PENDENTE';
    if (cobranca.status === 'RECEIVED' || cobranca.status === 'CONFIRMED') {
      statusNovo = 'PAGO';
    }

    // Atualiza nosso link local com a referência do ASAAS
    const linkAtualizado = await prisma.linkPagamento.update({
      where: { id },
      data: {
        formaEnvio,
        status: statusNovo,
        asaasPaymentId: cobranca.id,
        asaasInvoiceUrl: cobranca.bankSlipUrl || cobranca.invoiceUrl || null
      }
    });

    // Se for Cartão e deu certo, faz a baixa automática agora
    if (statusNovo === 'PAGO' && link.vendaId) {
      await prisma.vendaRevendedora.updateMany({
        where: { id: link.vendaId },
        data: {
          pago: true,
          canalPagamento: 'LINK_PAGO_ADMIN'
        }
      });

      // Gravar log
      await prisma.logAcao.create({
        data: {
          usuarioId: link.usuarioId,
          acao: 'VENDA_BAIXA_AUTOMATICA',
          detalhes: `Baixa automática executada via webhook/cartão para a venda ${link.vendaId} após cobrança ASAAS: ${cobranca.id}.`
        }
      });
    }

    // Prepara resposta com dados específicos de PIX ou Boleto
    const resposta = {
      status: statusNovo,
      asaasPaymentId: cobranca.id,
      invoiceUrl: cobranca.bankSlipUrl || cobranca.invoiceUrl || null
    };

    if (formaEnvio === 'PIX') {
      const pixInfo = await obterQrCodePix(cobranca.id);
      resposta.pixQrCode = pixInfo.encodedImage;
      resposta.pixCopiaCola = pixInfo.payload;
    } else if (formaEnvio === 'BOLETO') {
      const boletoInfo = await obterCodigoBarrasBoleto(cobranca.id);
      resposta.boletoLinhaDigitavel = boletoInfo.identificationField;
      resposta.boletoCodigoBarras = boletoInfo.barCode;
    }

    res.json(resposta);
  } catch (error) {
    console.error('Erro ao processar pagamento no backend:', error.message);
    res.status(500).json({ error: error.message || 'Erro ao processar pagamento.' });
  }
});

// Listar links de pagamento da revendedora
const listarLinksPagamento = async (req, res) => {
  try {
    const links = await prisma.linkPagamento.findMany({
      where: { usuarioId: req.user.id },
      include: {
        cliente: { select: { nome: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(links);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar links de pagamento.' });
  }
};

app.get('/api/pagamentos/link', autenticarJWT, identificarLoja, autorizarPlano(['BRONZE', 'GOLD', 'PLATINUM']), listarLinksPagamento);
app.get('/api/pagamentos/links', autenticarJWT, identificarLoja, autorizarPlano(['BRONZE', 'GOLD', 'PLATINUM']), listarLinksPagamento);

// Simular confirmação de pagamento (Webhook / Baixa Automática)
app.post('/api/public/pagamento/:id/confirmar', async (req, res) => {
  const { id } = req.params;
  try {
    const link = await prisma.linkPagamento.findUnique({ where: { id } });
    if (!link) {
      return res.status(404).json({ error: 'Link de pagamento não encontrado.' });
    }

    if (link.status === 'PAGO') {
      return res.json({ message: 'Este link já foi pago anteriormente.', link });
    }

    // Atualiza o link para PAGO
    const linkAtualizado = await prisma.linkPagamento.update({
      where: { id },
      data: { status: 'PAGO' }
    });

    // Se estiver associado a uma venda, dá a baixa automática
    if (link.vendaId) {
      await prisma.vendaRevendedora.updateMany({
        where: { id: link.vendaId },
        data: {
          pago: true,
          canalPagamento: 'LINK_PAGO_ADMIN'
        }
      });

      // Registrar logs de auditoria
      await prisma.logAcao.create({
        data: {
          usuarioId: link.usuarioId,
          acao: 'VENDA_BAIXA_AUTOMATICA',
          detalhes: `Baixa automática executada para a venda ${link.vendaId} após compensação do link de pagamento (${link.formaEnvio}) de R$ ${link.valor.toFixed(2)}.`
        }
      });
    }

    res.json({ message: 'Pagamento confirmado e baixa automática realizada!', link: linkAtualizado });
  } catch (error) {
    console.error('Erro ao confirmar pagamento:', error);
    res.status(500).json({ error: 'Erro ao processar a confirmação de pagamento.' });
  }
});

// Rota para criar assinatura ou preferência de pagamento no Mercado Pago (Assinaturas / Checkout Pro)
// Rota para criar assinatura ou preferência de pagamento no Mercado Pago (Assinaturas / Checkout Pro)
app.post('/api/criar-pagamento', async (req, res) => {
  try {
    const { usuarioId, planoNome, preco } = req.body;
    const nomePlanoClean = String(planoNome || 'Plano Gold').trim();
    const precoNum = Number(preco) || 297;
    const planoRefClean = nomePlanoClean.toUpperCase().includes('BRONZE') ? 'BRONZE' : (nomePlanoClean.toUpperCase().includes('PLATINUM') ? 'PLATINUM' : 'GOLD');
    const externalRef = `${usuarioId || 'admin'}|${planoRefClean}`;
    
    // Frontend URL para redirecionamento do navegador do usuário pós-pagamento (Live Server)
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';
    // Public URL / Ngrok para recebimento de webhooks do servidor do Mercado Pago
    const publicUrl = process.env.PUBLIC_URL || 'http://localhost:5000';

    // 1. Tenta criar link de assinatura recorrente mensal via Mercado Pago (Preapproval)
    try {
      if (typeof Preapproval !== 'undefined') {
        const preapproval = new Preapproval(clientMercadoPago);
        const response = await preapproval.create({
          body: {
            reason: `Assinatura ${nomePlanoClean} - Conecta Joias`,
            auto_recurring: {
              frequency: 1,
              frequency_type: 'months',
              transaction_amount: precoNum,
              currency_id: 'BRL'
            },
            back_url: `${frontendUrl}/pages/sucesso.html`,
            external_reference: externalRef,
            status: 'authorized'
          }
        });

        if (response && (response.init_point || response.sandbox_init_point)) {
          const linkSub = response.init_point || response.sandbox_init_point;
          console.log(`✅ [Mercado Pago Assinatura] Link recorrente gerado: ${linkSub}`);
          return res.status(200).json({ linkDePagamento: linkSub });
        }
      }
    } catch (subErr) {
      console.warn('⚠️ Falha ao criar assinatura no MP, usando checkout padrão:', subErr.message || subErr);
    }

    // 2. Fallback: Preferência de Checkout Pro Mercado Pago
    const preference = new Preference(clientMercadoPago);
    const response = await preference.create({
      body: {
        items: [
          {
            title: `Assinatura ${nomePlanoClean} - Conecta Joias`,
            quantity: 1,
            unit_price: precoNum,
            currency_id: 'BRL'
          }
        ],
        external_reference: externalRef,
        notification_url: `${publicUrl}/api/webhook/mercadopago`,
        back_urls: {
          success: `${frontendUrl}/pages/sucesso.html`,
          failure: `${frontendUrl}/pages/falha.html`,
          pending: `${frontendUrl}/pages/sucesso.html`
        }
      }
    });

    return res.status(200).json({ linkDePagamento: response.init_point });
  } catch (error) {
    console.error('Erro ao criar pagamento/assinatura no Mercado Pago:', error);
    return res.status(500).json({ error: 'Erro ao processar criação de pagamento no Mercado Pago' });
  }
});

// Webhook do Mercado Pago para notificação de pagamento, estorno e cancelamento
app.post('/api/webhook/mercadopago', async (req, res) => {
  // Retorno imediato 200 OK exigido pelo Mercado Pago
  res.status(200).send('OK');

  const { type } = req.query;
  const paymentId = req.query['data.id'] || req.query.id;

  if (paymentId) {
    try {
      const payment = new Payment(clientMercadoPago);
      const pagamentoMP = await payment.get({ id: paymentId });

      if (pagamentoMP) {
        const rawRef = pagamentoMP.external_reference || '';
        const parts = rawRef.split('|');
        const usuarioId = parts[0];
        const planoExt = parts[1] || 'GOLD';

        if (usuarioId) {
          const usuario = await prisma.usuario.findUnique({
            where: { id: usuarioId }
          });

          let lojaTargetId = (usuario && usuario.lojaId) ? usuario.lojaId : usuarioId;
          let lojaExiste = await prisma.loja.findUnique({ where: { id: lojaTargetId } });
          if (!lojaExiste) {
            // Fallback: se usuarioId não foi encontrado como usuário ou lojaId, tenta buscar a loja padrão
            lojaExiste = await prisma.loja.findFirst();
            if (lojaExiste) lojaTargetId = lojaExiste.id;
          }

          if (lojaExiste) {
            if (pagamentoMP.status === 'approved') {
              const dataVencimento = new Date();
              dataVencimento.setDate(dataVencimento.getDate() + 30);

              const novoPlanoFinal = lojaExiste.downgradePendente || planoExt;

              await prisma.loja.update({
                where: { id: lojaTargetId },
                data: {
                  statusPlano: 'ATIVO',
                  plano: novoPlanoFinal,
                  downgradePendente: null,
                  vencimentoPlano: dataVencimento
                }
              });
              console.log(`✅ [Webhook Mercado Pago] Pagamento APROVADO! Plano ${novoPlanoFinal} ativado com sucesso para a Loja ${lojaTargetId}.`);
            } else if (['refunded', 'charged_back', 'cancelled', 'rejected'].includes(pagamentoMP.status)) {
              await prisma.loja.update({
                where: { id: lojaTargetId },
                data: {
                  statusPlano: 'SUSPENSO',
                  plano: 'BASICO'
                }
              });
              console.log(`⚠️ [Webhook Mercado Pago] Pagamento ${pagamentoMP.status.toUpperCase()}! Loja ${lojaTargetId} alterada para Plano BASICO / SUSPENSO.`);
            }
          }
        }
      }
    } catch (err) {
      console.error('Erro ao processar webhook do Mercado Pago:', err);
    }
  }
});

// Webhook público para receber eventos de pagamento do ASAAS
app.post('/api/webhooks/asaas', async (req, res) => {
  const tokenRecebido = req.headers['asaas-access-token'];
  const tokenEsperado = process.env.ASAAS_WEBHOOK_SECRET;

  if (!tokenEsperado || tokenRecebido !== tokenEsperado) {
    console.error("🚫 [Webhook ASAAS] Tentativa de acesso não autorizada ao Webhook de pagamentos.");
    return res.status(401).json({ error: 'Acesso não autorizado. Chave de Webhook inválida.' });
  }

  const { event, payment } = req.body;

  if (!event || !payment) {
    return res.status(400).json({ error: 'Payload do webhook inválido.' });
  }

  console.log(`[Webhook ASAAS] Evento recebido: ${event} para o pagamento ${payment.id}`);

  // Eventos de sucesso de pagamento
  if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
    try {
      const linkId = payment.externalReference;

      // Tratar pagamento de Plano SaaS
      if (linkId && linkId.startsWith('SAAS_PLANO_')) {
        const parts = linkId.split('_');
        const lojaId = parts[2];
        const novoPlano = parts[3];

        if (lojaId && novoPlano) {
          const dataVencimento = new Date();
          dataVencimento.setDate(dataVencimento.getDate() + 30);

          await prisma.loja.update({
            where: { id: lojaId },
            data: {
              plano: novoPlano.toUpperCase(),
              statusPlano: 'ATIVO',
              vencimentoPlano: dataVencimento,
              asaasCustomerId: payment.customer || null
            }
          });

          await prisma.logAcao.create({
            data: {
              usuarioId: 'SISTEMA',
              acao: 'PLANO_SAAS_PAGO_WEBHOOK',
              detalhes: `Assinatura do Plano ${novoPlano.toUpperCase()} confirmada via Webhook ASAAS (${payment.billingType}). Vencimento renovado até ${dataVencimento.toLocaleDateString('pt-BR')}.`
            }
          });

          await prisma.notificacao.create({
            data: {
              lojaId,
              tipo: 'plano_saas',
              mensagem: `Sua assinatura do Plano ${novoPlano.toUpperCase()} foi ativada com sucesso!`,
              detalhes: JSON.stringify({
                plano: novoPlano,
                valor: payment.value,
                vencimento: dataVencimento
              })
            }
          });

          return res.json({ success: true, message: `Plano SaaS ${novoPlano} ativado com sucesso!` });
        }
      }

      // 1. Localizar o link de venda correspondente
      let link = null;
      if (linkId) {
        link = await prisma.linkPagamento.findUnique({ where: { id: linkId } });
      }

      // Fallback: busca por asaasPaymentId
      if (!link) {
        link = await prisma.linkPagamento.findFirst({
          where: { asaasPaymentId: payment.id }
        });
      }

      if (!link) {
        console.warn(`[Webhook ASAAS] Link de pagamento correspondente não foi encontrado para o pagamento ${payment.id}`);
        return res.status(200).json({ message: 'Evento recebido, mas nenhum link local correspondente foi encontrado.' });
      }

      if (link.status === 'PAGO') {
        return res.status(200).json({ message: 'Este pagamento já havia sido baixado anteriormente.' });
      }

      // 2. Atualizar o status do link para PAGO
      await prisma.linkPagamento.update({
        where: { id: link.id },
        data: { status: 'PAGO' }
      });

      // 3. Dar baixa automática na venda
      if (link.vendaId) {
        await prisma.vendaRevendedora.updateMany({
          where: { id: link.vendaId },
          data: {
            pago: true,
            canalPagamento: 'LINK_PAGO_ADMIN'
          }
        });

        // Registrar log de auditoria
        await prisma.logAcao.create({
          data: {
            usuarioId: link.usuarioId,
            acao: 'VENDA_BAIXA_AUTOMATICA_WEBHOOK',
            detalhes: `Baixa automática via Webhook ASAAS (${event}) executada para a venda ${link.vendaId} após recebimento de R$ ${payment.value.toFixed(2)}.`
          }
        });

        // Criar notificação para o gestor
        const usuario = await prisma.usuario.findUnique({
          where: { id: link.usuarioId },
          select: { lojaId: true }
        });

        const lojaId = usuario?.lojaId || 'default-loja';

        await prisma.notificacao.create({
          data: {
            lojaId,
            tipo: 'venda_revendedora',
            mensagem: `Venda ${link.vendaId} paga automaticamente via link (${payment.billingType}).`,
            detalhes: JSON.stringify({
              linkId: link.id,
              vendaId: link.vendaId,
              valor: payment.value,
              netValue: payment.netValue,
              asaasPaymentId: payment.id
            })
          }
        });
      }

      return res.json({ success: true, message: 'Baixa processada com sucesso!' });
    } catch (error) {
      console.error('[Webhook ASAAS] Erro ao processar baixa de pagamento:', error);
      return res.status(500).json({ error: 'Erro interno ao processar baixa de pagamento no webhook.' });
    }
  }

  // Eventos de falha de pagamento (Opção C)
  if (event === 'PAYMENT_REFUSED' || event === 'PAYMENT_OVERDUE') {
    try {
      const linkId = payment.externalReference;
      let link = linkId ? await prisma.linkPagamento.findUnique({ where: { id: linkId } }) : null;
      if (!link) {
        link = await prisma.linkPagamento.findFirst({
          where: { asaasPaymentId: payment.id }
        });
      }

      if (link) {
        const revendedora = await prisma.usuario.findUnique({
          where: { id: link.usuarioId }
        });


      }
    } catch (err) {
      console.error('[Webhook ASAAS] Erro ao agendar mensagem de falha de pagamento:', err);
    }
  }

  // Resposta padrão para outros tipos de eventos
  res.json({ received: true });
});

// 4. Criar Termo de Responsabilidade/Consignação (Admin)
app.post('/api/termos/gerar', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, autorizarPlano(['GOLD', 'PLATINUM']), async (req, res) => {
  const { usuarioId, titulo, conteudo, prazoDevolucao } = req.body;
  if (!usuarioId || !titulo || !conteudo) {
    return res.status(400).json({ error: 'Revendedora, título e conteúdo do termo são obrigatórios.' });
  }

  try {
    const termo = await prisma.termoConsignacao.create({
      data: {
        usuarioId,
        titulo,
        conteudo,
        prazoDevolucao: prazoDevolucao ? new Date(prazoDevolucao) : null,
        status: 'PENDENTE'
      }
    });

    try {
      await criarNotificacao(
        req.lojaId,
        'termo_solicitado',
        `A vendedora principal solicitou a assinatura do Termo da Maleta: "${titulo}".`,
        { termoId: termo.id, titulo },
        usuarioId
      );
    } catch (notifErr) {
      console.error("Erro ao gerar notificação de solicitação de termo:", notifErr);
    }

    res.status(201).json(termo);
  } catch (error) {
    console.error('Erro ao criar termo:', error);
    res.status(500).json({ error: 'Erro ao gerar termo de consignação.' });
  }
});

// Listar Termos de Consignação (Geral/Admin)
app.get('/api/termos', autenticarJWT, identificarLoja, autorizarPlano(['GOLD', 'PLATINUM']), async (req, res) => {
  try {
    let where = {};
    if (req.user.role === 'Consultant') {
      where.usuarioId = req.user.id;
    } else if (req.user.role === 'Manager') {
      where.usuario = { lojaId: req.lojaId };
    }
    const termos = await prisma.termoConsignacao.findMany({
      where,
      include: {
        usuario: { select: { nome: true, pin: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(termos);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar termos de consignação.' });
  }
});

// Obter detalhes de um termo específico (Público - para assinatura)
app.get('/api/public/termos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const termo = await prisma.termoConsignacao.findUnique({
      where: { id },
      include: {
        usuario: { select: { nome: true } }
      }
    });
    if (!termo) {
      return res.status(404).json({ error: 'Termo de consignação não encontrado.' });
    }
    res.json(termo);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao obter termo de consignação.' });
  }
});

// Assinar Termo Digitalmente
app.post('/api/public/termos/:id/assinar', async (req, res) => {
  const { id } = req.params;
  const { nome, cpf, assinaturaImg, ip } = req.body;
  if (!nome || !cpf || !assinaturaImg) {
    return res.status(400).json({ error: 'Nome, CPF e Assinatura Gráfica são obrigatórios.' });
  }

  try {
    const termo = await prisma.termoConsignacao.findUnique({ where: { id } });
    if (!termo) {
      return res.status(404).json({ error: 'Termo de consignação não encontrado.' });
    }

    const termoAssinado = await prisma.termoConsignacao.update({
      where: { id },
      data: {
        status: 'ASSINADO',
        assinaturaNome: nome,
        assinaturaCpf: cpf,
        assinaturaIp: ip || '127.0.0.1',
        dataAssinatura: new Date()
      }
    });

    try {
      const usr = await prisma.usuario.findUnique({ where: { id: termo.usuarioId } });
      await criarNotificacao(
        usr ? usr.lojaId : 'default-loja',
        'termo_assinado',
        `A revendedora ${nome} assinou o Termo da Maleta: "${termo.titulo}".`,
        { termoId: id, nome, cpf },
        null
      );
    } catch (notifErr) {
      console.error("Erro ao gerar notificação de assinatura de termo:", notifErr);
    }

    // Atualiza status no usuário também
    await prisma.usuario.update({
      where: { id: termo.usuarioId },
      data: { termoAssinado: true }
    });

    // Grava no log de auditoria
    await prisma.logAcao.create({
      data: {
        usuarioId: termo.usuarioId,
        acao: 'TERMO_ASSINATURA_DIGITAL',
        detalhes: `Termo de Consignação "${termo.titulo}" assinado eletronicamente por ${nome} (CPF: ${cpf}) sob o IP ${ip || '127.0.0.1'}.`
      }
    });

    res.json({ message: 'Termo assinado com sucesso!', termo: termoAssinado });
  } catch (error) {
    console.error('Erro ao assinar termo:', error);
    res.status(500).json({ error: 'Erro ao processar assinatura eletrônica.' });
  }
});



// 6. Listar treinamentos cadastrados
app.get('/api/treinamentos', autenticarJWT, identificarLoja, async (req, res) => {
  try {
    const treinamentos = await prisma.treinamento.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(treinamentos);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar treinamentos.' });
  }
});

// Adicionar treinamento (Admin)
app.post('/api/treinamentos', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { titulo, descricao, tipo, url } = req.body;
  if (!titulo || !tipo || !url) {
    return res.status(400).json({ error: 'Título, Tipo (VIDEO, PDF) e URL do conteúdo são obrigatórios.' });
  }

  try {
    const novoTreinamento = await prisma.treinamento.create({
      data: {
        titulo,
        descricao,
        tipo,
        url,
        lojaId: req.lojaId
      }
    });
    res.status(201).json(novoTreinamento);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao cadastrar treinamento.' });
  }
});

// Excluir treinamento (Admin)
app.delete('/api/treinamentos/:id', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.treinamento.delete({ where: { id } });
    res.json({ message: 'Treinamento excluído com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir treinamento.' });
  }
});

// 7. Reiniciar ciclo de comissões/metas (Admin)
app.post('/api/revendedoras/:id/reiniciar-comissoes', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { id } = req.params;
  try {
    const rev = await prisma.usuario.findFirst({ where: { id, role: 'Consultant', lojaId: req.lojaId } });
    if (!rev) {
      return res.status(404).json({ error: 'Revendedora não encontrada nesta loja.' });
    }

    await prisma.logAcao.create({
      data: {
        usuarioId: id,
        acao: 'REVENDEDORA_REINICIO_COMISSAO',
        detalhes: `Reinício do ciclo de comissões da revendedora ${rev.nome} executado.`
      }
    });

    res.json({ message: 'Ciclo de comissões reiniciado com sucesso!' });
  } catch (error) {
    console.error('Erro ao reiniciar comissão:', error);
    res.status(500).json({ error: 'Erro ao processar o reinício da comissão.' });
  }
});

// ==========================================
// SISTEMA DE CHAMADOS / REPORTES DE ERRO
// ==========================================

// Criar chamado de erro (Qualquer usuário logado da loja)
app.post('/api/reportes-erro', autenticarJWT, upload.single('anexo'), async (req, res) => {
  const { titulo, descricao, categoria, prioridade, urlOrigem } = req.body;
  const lojaId = req.headers['x-loja-id'] || req.user.lojaId || 'default-loja';

  try {
    let anexoUrl = null;
    if (req.file) {
      if (!containerClient) {
        const ext = path.extname(req.file.originalname) || '.png';
        const localFileName = `report_${Date.now()}_${Math.random().toString(36).substr(2, 5)}${ext}`;
        const localFilePath = path.join(UPLOADS_DIR, localFileName);
        fs.writeFileSync(localFilePath, req.file.buffer);
        anexoUrl = `/uploads/${localFileName}`;
      } else {
        const blobName = `report_${Date.now()}_${Math.random().toString(36).substr(2, 5)}_${req.file.originalname.replace(/\s+/g, '_')}`;
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        await blockBlobClient.upload(req.file.buffer, req.file.buffer.length, {
          blobHTTPHeaders: { blobContentType: req.file.mimetype }
        });
        anexoUrl = blockBlobClient.url;
      }
    }

    const reporte = await prisma.reporteErro.create({
      data: {
        lojaId: lojaId !== 'null' && lojaId !== 'undefined' ? lojaId : 'default-loja',
        usuarioId: req.user.id,
        nomeUsuario: req.user.nome || 'Usuário',
        emailUsuario: req.user.email || '',
        roleUsuario: req.user.role || 'Consultant',
        titulo: titulo || 'Bug Report',
        descricao: descricao || '',
        categoria: categoria || 'BUG',
        prioridade: prioridade || 'MEDIA',
        urlOrigem,
        anexoUrl
      }
    });

    res.status(201).json(reporte);
  } catch (error) {
    console.error('Erro ao registrar chamado:', error);
    res.status(500).json({ error: 'Erro ao registrar reporte de erro.' });
  }
});

// Listar chamados de erro (SuperAdmin do SaaS)
app.get('/api/saas/reportes-erro', autenticarJWT, autorizarRole(['SuperAdmin']), async (req, res) => {
  try {
    const reportes = await prisma.reporteErro.findMany({
      include: {
        loja: { select: { nome: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(reportes);
  } catch (error) {
    console.error('Erro ao listar chamados:', error);
    res.status(500).json({ error: 'Erro ao obter chamados de erro.' });
  }
});

// Responder/Alterar status de chamado (SuperAdmin)
app.put('/api/saas/reportes-erro/:id', autenticarJWT, autorizarRole(['SuperAdmin']), async (req, res) => {
  const { id } = req.params;
  const { status, respostaAdmin } = req.body;

  try {
    const reporte = await prisma.reporteErro.update({
      where: { id },
      data: {
        status,
        respostaAdmin
      }
    });
    res.json(reporte);
  } catch (error) {
    console.error('Erro ao responder chamado:', error);
    res.status(500).json({ error: 'Erro ao atualizar chamado.' });
  }
});

// ==========================================
// ROTAS DE ADMINISTRAÇÃO GLOBAL DO SAAS (SUPERADMIN)
// ==========================================


// Buscar estatísticas globais do SaaS
app.get('/api/saas/stats', autenticarJWT, autorizarRole(['SuperAdmin']), async (req, res) => {
  try {
    const totalLojas = await prisma.loja.count();
    const lojasSuspensasCount = await prisma.loja.count({ where: { statusPlano: 'SUSPENSO' } });
    const lojasAtivas = Math.max(0, totalLojas - lojasSuspensasCount);
    const totalUsuarios = await prisma.usuario.count();
    const totalConsultoras = await prisma.usuario.count({ where: { role: 'Consultant' } });
    const totalLogs = await prisma.logAcao.count();

    // Calcular faturamento global a partir de todas as vendas no banco de dados
    const totalDiretasAgg = await prisma.vendaDireta.aggregate({ _sum: { preco: true } });
    const totalRevendedorasAgg = await prisma.vendaRevendedora.aggregate({ _sum: { precoVenda: true } });
    
    const faturamentoGlobal = (totalDiretasAgg._sum.preco || 0) + (totalRevendedorasAgg._sum.precoVenda || 0);

    res.json({
      totalLojas,
      lojasAtivas,
      totalUsuarios,
      totalConsultoras,
      faturamentoGlobal,
      totalLogs
    });
  } catch (error) {
    console.error("Erro ao buscar estatísticas do SaaS:", error);
    res.status(500).json({ error: 'Erro interno ao processar dados analíticos do SaaS.' });
  }
});

// Listar todas as lojas do ecossistema SaaS
app.get('/api/saas/lojas', autenticarJWT, autorizarRole(['SuperAdmin']), async (req, res) => {
  try {
    const lojas = await prisma.loja.findMany({
      include: {
        _count: {
          select: {
            usuarios: { where: { role: 'Consultant' } },
            produtos: true
          }
        },
        vendasDireta: true,
        vendasRev: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const resultado = lojas.map(loja => {
      // Faturamento da loja
      const totalDireta = loja.vendasDireta.reduce((acc, v) => acc + (v.preco || 0), 0);
      const totalRev = loja.vendasRev.reduce((acc, v) => acc + ((v.precoVenda * (v.quantidade || 1)) || 0), 0);
      const faturamento = totalDireta + totalRev;

      return {
        id: loja.id,
        nome: loja.nome,
        cnpj: loja.cnpj || "Não Informado",
        plano: loja.plano || "BRONZE",
        createdAt: loja.createdAt,
        status: loja.statusPlano === 'SUSPENSO' ? 'SUSPENDED' : 'ACTIVE',
        consultorasCount: loja._count.usuarios,
        estoqueCount: loja._count.produtos,
        faturamento,
        temaVisual: 'ESCURO / LUXO'
      };
    });

    res.json(resultado);
  } catch (error) {
    console.error("Erro ao buscar lista de lojas do SaaS:", error);
    res.status(500).json({ error: 'Erro ao carregar lojas cadastradas.' });
  }
});

// Listar logs de auditoria globais do SaaS
app.get('/api/saas/logs', autenticarJWT, autorizarRole(['SuperAdmin']), async (req, res) => {
  try {
    const logs = await prisma.logAcao.findMany({
      orderBy: { data: 'desc' },
      take: 100 // Proteção: limita o consumo de dados da tabela de auditoria a 100 linhas por busca
    });
    res.json(logs);
  } catch (error) {
    console.error("Erro ao buscar logs de auditoria do SaaS:", error);
    res.status(500).json({ error: 'Erro ao carregar logs de segurança.' });
  }
});

// Alterar status de uma loja (Suspender / Reativar)
app.put('/api/saas/lojas/:id/status', autenticarJWT, autorizarRole(['SuperAdmin']), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (status !== 'ACTIVE' && status !== 'SUSPENDED') {
    return res.status(400).json({ error: 'Status inválido. Deve ser ACTIVE ou SUSPENDED.' });
  }

  try {
    const lojaExiste = await prisma.loja.findUnique({ where: { id } });
    if (!lojaExiste) {
      return res.status(404).json({ error: 'Loja não encontrada na base de dados.' });
    }

    const novoStatus = status === 'SUSPENDED' ? 'SUSPENSO' : 'ATIVO';
    await prisma.loja.update({
      where: { id },
      data: { statusPlano: novoStatus }
    });

    // Grava log de segurança da ação crítica realizada pelo Super Admin
    await prisma.logAcao.create({
      data: {
        usuarioId: req.user.id,
        usuarioNome: req.user.nome,
        acao: status === 'SUSPENDED' ? 'LOJA_SUSPENSA' : 'LOJA_REATIVADA',
        detalhes: `Super Admin ${req.user.nome} alterou o status da loja ${lojaExiste.nome} (ID: ${id}) para ${status}.`
      }
    });

    res.json({ message: `Status da loja ${lojaExiste.nome} alterado com sucesso!`, status });
  } catch (error) {
    console.error("Erro ao atualizar status da loja:", error);
    res.status(500).json({ error: 'Erro interno ao tentar atualizar status do tenant.' });
  }
});

// Alterar plano de uma loja (Bronze / Gold / Platinum)
app.put('/api/saas/lojas/:id/plano', autenticarJWT, autorizarRole(['SuperAdmin']), async (req, res) => {
  const { id } = req.params;
  const { plano } = req.body;

  const planosPermitidos = ['BRONZE', 'GOLD', 'PLATINUM'];
  if (!plano || !planosPermitidos.includes(plano.toUpperCase())) {
    return res.status(400).json({ error: 'Plano inválido. Deve ser BRONZE, GOLD ou PLATINUM.' });
  }

  try {
    const lojaExiste = await prisma.loja.findUnique({ where: { id } });
    if (!lojaExiste) {
      return res.status(404).json({ error: 'Loja não encontrada na base de dados.' });
    }

    const lojaAtualizada = await prisma.loja.update({
      where: { id },
      data: { plano: plano.toUpperCase() }
    });

    // Grava log de segurança
    await prisma.logAcao.create({
      data: {
        usuarioId: req.user.id,
        usuarioNome: req.user.nome,
        acao: 'LOJA_PLANO_ALTERADO',
        detalhes: `Super Admin ${req.user.nome} alterou o plano da loja ${lojaExiste.nome} (ID: ${id}) para ${plano.toUpperCase()}.`
      }
    });

    res.json({ message: `Plano da loja ${lojaExiste.nome} atualizado com sucesso para ${plano.toUpperCase()}!`, loja: lojaAtualizada });
  } catch (error) {
    console.error("Erro ao atualizar plano da loja:", error);
    res.status(500).json({ error: 'Erro interno ao tentar atualizar plano do tenant.' });
  }
});

// Buscar detalhes do plano atual da loja do usuário logado (Gestor)
app.get('/api/saas/meu-plano', autenticarJWT, async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user.id },
      include: { loja: true }
    });

    if (!usuario || !usuario.lojaId || !usuario.loja) {
      return res.status(404).json({ error: 'Loja não encontrada para este usuário.' });
    }

    const loja = usuario.loja;
    const planoStr = (loja.plano || 'BASICO').toUpperCase();

    // Contar consultoras cadastradas
    const totalConsultoras = await prisma.usuario.count({
      where: { lojaId: loja.id, role: 'Consultant' }
    });

    // Somar total de peças em estoque no estoque da loja (soma das variações)
    const totalProdutos = await prisma.produtoVariacao.aggregate({
      where: { lojaId: loja.id },
      _sum: {
        quantidade: true
      }
    });
    const totalEstoque = totalProdutos._sum.quantidade || 0;

    // Limites de acordo com os 4 planos (Básico zerado e preços atualizados)
    const limites = {
      BASICO: { consultoras: 0, estoque: 0, valor: 0.00 },
      BRONZE: { consultoras: 5, estoque: 300, valor: 69.90 },
      GOLD: { consultoras: 25, estoque: 1500, valor: 99.90 },
      PLATINUM: { consultoras: 9999, estoque: 99999, valor: 249.90 }
    };

    const limiteAtual = limites[planoStr] || limites.BASICO;

    const excedeuConsultoras = totalConsultoras > limiteAtual.consultoras;
    const excedeuEstoque = totalEstoque > limiteAtual.estoque;
    const excedeuCota = (planoStr === 'BASICO') || (limiteAtual.consultoras !== 9999 && excedeuConsultoras) || (limiteAtual.estoque !== 99999 && excedeuEstoque);

    res.json({
      lojaId: loja.id,
      lojaNome: loja.nome,
      plano: planoStr,
      statusPlano: loja.statusPlano || (planoStr === 'BASICO' ? 'PENDENTE' : 'ATIVO'),
      vencimentoPlano: loja.vencimentoPlano,
      downgradePendente: loja.downgradePendente || null,
      excedeuCota,
      excedeuConsultoras,
      excedeuEstoque,
      uso: {
        totalConsultoras,
        limiteConsultoras: limiteAtual.consultoras,
        totalEstoque,
        limiteEstoque: limiteAtual.estoque
      },
      planosDisponiveis: [
        { id: 'BRONZE', nome: 'Plano Bronze', valor: 69.90, limiteConsultoras: 5, limiteEstoque: 300 },
        { id: 'GOLD', nome: 'Plano Gold', valor: 99.90, limiteConsultoras: 25, limiteEstoque: 1500, popular: true },
        { id: 'PLATINUM', nome: 'Plano Platinum', valor: 249.90, limiteConsultoras: 'Ilimitado', limiteEstoque: 'Ilimitado' }
      ]
    });
  } catch (error) {
    console.error("Erro ao buscar dados do plano da loja:", error);
    res.status(500).json({ error: 'Erro ao buscar dados do plano.' });
  }
});

// Rota para agendar Downgrade no fim do ciclo atual
app.post('/api/saas/solicitar-downgrade', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), async (req, res) => {
  try {
    const { novoPlano } = req.body;
    const planoTarget = String(novoPlano || 'BRONZE').toUpperCase();

    if (!['BRONZE', 'GOLD', 'BASICO'].includes(planoTarget)) {
      return res.status(400).json({ error: 'Plano inválido para downgrade.' });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user.id },
      include: { loja: true }
    });

    if (!usuario || !usuario.lojaId) {
      return res.status(404).json({ error: 'Loja não encontrada.' });
    }

    const loja = usuario.loja;
    await prisma.loja.update({
      where: { id: loja.id },
      data: { downgradePendente: planoTarget }
    });

    const vencimentoStr = loja.vencimentoPlano 
      ? new Date(loja.vencimentoPlano).toLocaleDateString('pt-BR')
      : 'fim do ciclo atual';

    res.json({
      message: `Downgrade agendado com sucesso! Você continuará usando o Plano ${loja.plano} até ${vencimentoStr}. A partir desta data, sua assinatura passará para o Plano ${planoTarget}.`,
      downgradePendente: planoTarget,
      vencimentoPlano: loja.vencimentoPlano
    });
  } catch (error) {
    console.error('Erro ao agendar downgrade:', error);
    res.status(500).json({ error: 'Erro interno ao agendar downgrade.' });
  }
});

// Processar pagamento/upgrade do plano SaaS via ASAAS
app.post('/api/saas/plano/pagar', autenticarJWT, async (req, res) => {
  const {
    plano,
    formaEnvio,
    clienteNome,
    clienteCpfCnpj,
    clienteEmail,
    clienteWhatsapp,
    cartaoDados,
    enderecoDados
  } = req.body;

  if (!plano || !['BRONZE', 'GOLD', 'PLATINUM'].includes(plano.toUpperCase())) {
    return res.status(400).json({ error: 'Plano inválido selecionado.' });
  }

  if (!formaEnvio) {
    return res.status(400).json({ error: 'Forma de pagamento é obrigatória.' });
  }

  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user.id },
      include: { loja: true }
    });

    if (!usuario || !usuario.lojaId || !usuario.loja) {
      return res.status(404).json({ error: 'Loja não encontrada para este usuário.' });
    }

    const loja = usuario.loja;

    const cobranca = await criarCobrancaPlanoSaaS({
      lojaId: loja.id,
      lojaNome: loja.nome,
      plano: plano.toUpperCase(),
      formaEnvio,
      clienteNome: clienteNome || usuario.nome,
      clienteCpfCnpj,
      clienteEmail: clienteEmail || usuario.email,
      clienteWhatsapp: clienteWhatsapp || usuario.whatsapp,
      cartaoDados,
      enderecoDados
    });

    let statusNovo = 'PENDENTE';
    if (cobranca.status === 'RECEIVED' || cobranca.status === 'CONFIRMED') {
      statusNovo = 'PAGO';
      const dataVencimento = new Date();
      dataVencimento.setDate(dataVencimento.getDate() + 30);

      await prisma.loja.update({
        where: { id: loja.id },
        data: {
          plano: plano.toUpperCase(),
          statusPlano: 'ATIVO',
          vencimentoPlano: dataVencimento,
          asaasCustomerId: cobranca.customer || null
        }
      });

      await prisma.logAcao.create({
        data: {
          usuarioId: req.user.id,
          usuarioNome: req.user.nome,
          acao: 'PLANO_SAAS_PAGO_DIRETO',
          detalhes: `Plano ${plano.toUpperCase()} pago e ativado diretamente via Cartão de Crédito.`
        }
      });
    }

    const resposta = {
      status: statusNovo,
      asaasPaymentId: cobranca.id,
      plano: plano.toUpperCase(),
      invoiceUrl: cobranca.bankSlipUrl || cobranca.invoiceUrl || null
    };

    if (formaEnvio === 'PIX') {
      const pixInfo = await obterQrCodePix(cobranca.id);
      resposta.pixQrCode = pixInfo.encodedImage;
      resposta.pixCopiaCola = pixInfo.payload;
    } else if (formaEnvio === 'BOLETO') {
      const boletoInfo = await obterCodigoBarrasBoleto(cobranca.id);
      resposta.boletoLinhaDigitavel = boletoInfo.identificationField;
      resposta.boletoCodigoBarras = boletoInfo.barCode;
    }

    res.json(resposta);
  } catch (error) {
    console.error("Erro ao processar pagamento de plano SaaS:", error);
    res.status(500).json({ error: error.message || 'Erro ao processar pagamento do plano.' });
  }
});

// Simular baixa/confirmação manual do pagamento do plano (Modo Dev / Homologação)
app.post('/api/saas/plano/simular-confirmacao', autenticarJWT, async (req, res) => {
  const { plano } = req.body;
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user.id },
      include: { loja: true }
    });

    if (!usuario || !usuario.lojaId || !usuario.loja) {
      return res.status(404).json({ error: 'Loja não encontrada.' });
    }

    const novoPlano = (plano || usuario.loja.plano || 'GOLD').toUpperCase();
    const dataVencimento = new Date();
    dataVencimento.setDate(dataVencimento.getDate() + 30);

    const lojaAtualizada = await prisma.loja.update({
      where: { id: usuario.lojaId },
      data: {
        plano: novoPlano,
        statusPlano: 'ATIVO',
        vencimentoPlano: dataVencimento
      }
    });

    await prisma.logAcao.create({
      data: {
        usuarioId: req.user.id,
        usuarioNome: req.user.nome,
        acao: 'PLANO_SAAS_SIMULACAO_PAGO',
        detalhes: `Simulação de pagamento efetuada para o Plano ${novoPlano}. Vencimento renovado até ${dataVencimento.toLocaleDateString('pt-BR')}.`
      }
    });

    res.json({ message: `Plano ${novoPlano} ativado com sucesso!`, loja: lojaAtualizada });
  } catch (error) {
    console.error("Erro ao simular confirmação do plano:", error);
    res.status(500).json({ error: 'Erro ao simular confirmação do plano.' });
  }
});

// Forçar backup físico do banco SQLite
app.post('/api/saas/backup', autenticarJWT, autorizarRole(['SuperAdmin']), async (req, res) => {
  try {
    const BACKUPS_DIR = path.join(UPLOADS_DIR, 'backups');
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }

    const dbPath = path.join(__dirname, 'dev.db');
    const backupName = `backup-${Date.now()}.db`;
    const backupPath = path.join(BACKUPS_DIR, backupName);

    if (!fs.existsSync(dbPath)) {
      return res.status(400).json({ error: 'Arquivo do banco de dados dev.db não encontrado.' });
    }

    // Copia fisicamente o banco
    fs.copyFileSync(dbPath, backupPath);

    // Grava log de auditoria
    await prisma.logAcao.create({
      data: {
        usuarioId: req.user.id,
        usuarioNome: req.user.nome,
        acao: 'BACKUP_GERADO',
        detalhes: `Super Admin ${req.user.nome} realizou backup físico do banco de dados (Arquivo: ${backupName}).`
      }
    });

    res.json({ message: 'Backup gerado com sucesso!', filename: backupName, sizeBytes: fs.statSync(backupPath).size });
  } catch (error) {
    console.error("Erro ao gerar backup físico:", error);
    res.status(500).json({ error: 'Falha interna ao realizar cópia física de segurança do banco.' });
  }
});

// Auto-diagnóstico de integridade estrutural do banco de dados
app.get('/api/saas/diagnostico', autenticarJWT, autorizarRole(['SuperAdmin']), async (req, res) => {
  try {
    let statusIntegridade = 'INTEGRO';
    let provedor = 'PostgreSQL';

    const dbUrl = process.env.DATABASE_URL || '';
    if (dbUrl.includes('file:') || dbUrl.includes('.db')) {
      provedor = 'SQLite';
      const resultado = await prisma.$queryRawUnsafe('PRAGMA integrity_check');
      statusIntegridade = resultado && resultado[0] && Object.values(resultado[0])[0] === 'ok' ? 'INTEGRO' : 'FALHA';
    } else {
      // Para PostgreSQL / Outros provedores
      await prisma.$queryRawUnsafe('SELECT 1');
      statusIntegridade = 'INTEGRO';
    }

    res.json({
      status: 'ONLINE',
      dbStatus: statusIntegridade,
      provedor: provedor,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Erro no diagnóstico do banco de dados:", error);
    res.status(500).json({ error: 'Falha ao executar rotina de auto-diagnóstico.' });
  }
});


// 5. Listar fila de mensagens pendentes do WhatsApp (Admin)
app.get('/api/whatsapp/fila', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  try {
    const fila = await prisma.mensagemWhatsapp.findMany({
      where: { lojaId: req.lojaId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(fila);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao obter fila de mensagens.' });
  }
});

// Marcar mensagem do WhatsApp como enviada (Admin)
app.post('/api/whatsapp/enviar/:id', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), async (req, res) => {
  const { id } = req.params;
  try {
    const msg = await prisma.mensagemWhatsapp.update({
      where: { id },
      data: { status: 'ENVIADO' }
    });
    res.json({ message: 'Mensagem marcada como enviada com sucesso.', msg });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar status da mensagem.' });
  }
});


// Função para garantir que a loja padrão, a configuração padrão e o SuperAdmin existam no banco
async function inicializarLojaPadrao() {
  try {
    let loja = await prisma.loja.findUnique({ where: { id: 'default-loja' } });
    if (!loja) {
      loja = await prisma.loja.create({
        data: {
          id: 'default-loja',
          nome: process.env.NOME_EMPRESA_PADRAO || 'Loja Padrão',
          cnpj: '00000000000000'
        }
      });
      console.log('Loja padrão criada com sucesso!');
    }

    // Garante que a configuração da loja padrão exista
    const config = await prisma.configuracao.findFirst({ where: { lojaId: 'default-loja' } });
    if (!config) {
      await prisma.configuracao.create({
        data: {
          lojaId: 'default-loja',
          nomeEmpresa: process.env.NOME_EMPRESA_PADRAO || 'Minha Loja',
          logoUrl: '',
          corPrimaria: '#d4af37',
          corSecundaria: '#111111',
          bgPrimary: '#0a0a0a',
          bgCard: '#121212',
          temaPref: 'ESCURO'
        }
      });
      console.log('Configuração da loja padrão criada com sucesso!');
    }

    // Garante que o SuperAdmin global exista
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
    const superAdminSenha = process.env.SUPER_ADMIN_SENHA;
    const superAdminPin = process.env.SUPER_ADMIN_PIN || '0001';

    if (superAdminEmail && superAdminSenha) {
      const superAdminExiste = await prisma.usuario.findUnique({ where: { email: superAdminEmail } });
      const senhaHash = await bcrypt.hash(superAdminSenha, 10);

      if (!superAdminExiste) {
        await prisma.usuario.create({
          data: {
            nome: 'Super Admin',
            email: superAdminEmail,
            pin: superAdminPin,
            senhaHash,
            role: 'SuperAdmin',
            lojaId: null, // SuperAdmin não pertence a nenhuma loja específica
            comissao: 0.0
          }
        });
        console.log(`SuperAdmin criado: ${superAdminEmail} com PIN ${superAdminPin}`);
      } else {
        // Atualiza PIN e Senha se mudaram no .env
        await prisma.usuario.update({
          where: { email: superAdminEmail },
          data: {
            pin: superAdminPin,
            senhaHash
          }
        });
        console.log(`SuperAdmin atualizado com PIN ${superAdminPin}`);
      }
    } else {
      console.warn('AVISO: SUPER_ADMIN_EMAIL e/ou SUPER_ADMIN_SENHA não definidos no .env. O SuperAdmin não foi criado automaticamente.');
    }
  } catch (error) {
    console.error('Erro ao inicializar loja/configuração padrão:', error);
  }
}

// Processador automático em segundo plano para envio da fila de mensagens do WhatsApp
async function processarFilaWhatsApp() {
  const url = process.env.WHATSAPP_API_URL || '';
  const token = process.env.WHATSAPP_API_KEY || '';
  const eSimulado = !url || !token;

  try {
    const fila = await prisma.mensagemWhatsapp.findMany({
      where: { status: 'PENDENTE' },
      orderBy: { createdAt: 'asc' },
      take: 5
    });

    if (fila.length === 0) return;

    for (const msg of fila) {
      console.log(`[WhatsApp Worker] Processando mensagem ID: ${msg.id} para o número: ${msg.numero}...`);
      
      const numeroLimpo = msg.numero.replace(/\D/g, '');
      const ddiPhone = (numeroLimpo.startsWith('55') || numeroLimpo.length < 10) 
        ? numeroLimpo 
        : '55' + numeroLimpo;

      if (eSimulado) {
        console.log(`--------------------------------------------------`);
        console.log(`📢 [WHATSAPP SIMULADO]`);
        console.log(`Para: ${ddiPhone}`);
        console.log(`Tipo: ${msg.tipo}`);
        console.log(`Mensagem: "${msg.mensagem}"`);
        console.log(`--------------------------------------------------`);

        await prisma.mensagemWhatsapp.update({
          where: { id: msg.id },
          data: { status: 'ENVIADO' }
        });
      } else {
        try {
          const payload = {
            phone: ddiPhone,
            message: msg.mensagem
          };

          const headers = {
            'Content-Type': 'application/json'
          };
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
            headers['access_token'] = token;
            headers['x-api-key'] = token;
          }

          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Erro na resposta da API: ${response.status} - ${errBody}`);
          }

          await prisma.mensagemWhatsapp.update({
            where: { id: msg.id },
            data: { status: 'ENVIADO' }
          });
          console.log(`✅ [WhatsApp Worker] Mensagem enviada com sucesso para ${ddiPhone}.`);
        } catch (apiErr) {
          console.error(`❌ [WhatsApp Worker] Falha ao enviar mensagem real para ${ddiPhone}:`, apiErr.message);
          await prisma.mensagemWhatsapp.update({
            where: { id: msg.id },
            data: { status: 'ERRO' }
          });
        }
      }
    }
  } catch (error) {
    console.error('[WhatsApp Worker] Erro geral ao processar fila do WhatsApp:', error.message);
  }
}

// Job diário para verificar janelas de ciclo de acerto e disparar notificações no WhatsApp (Nível 1)
async function verificarCiclosENotificarRevendedoras() {
  console.log('[Ciclo Worker] Iniciando verificação diária de ciclos de acerto...');
  try {
    const revendedoras = await prisma.usuario.findMany({
      where: { role: 'Consultant' }
    });

    const diaHoje = new Date().getDate();

    for (const rev of revendedoras) {
      if (!rev.ciclo || !rev.whatsapp || rev.whatsapp.trim() === '') continue;

      let ciclo = null;
      try {
        ciclo = JSON.parse(rev.ciclo);
      } catch (e) {
        continue;
      }

      if (!ciclo || !ciclo.ativo) continue;

      const { diaInicioAcerto, diaFimAcerto } = ciclo;
      if (!diaInicioAcerto || !diaFimAcerto) continue;

      // 1. Lembrete do primeiro dia da Janela de Acerto
      if (diaHoje === parseInt(diaInicioAcerto)) {
        const msgAbertura = `Olá, *${rev.nome}*! 📋\nA sua janela mensal de acerto de contas da Conecta Joias iniciou hoje e vai até o dia *${diaFimAcerto}*.\n\nPor favor, separe as peças vendidas e as de devolução e acesse o painel ou entre em contato com a administradora para realizar o fechamento do seu acerto. 💎🤝`;

        // Verifica se já não criamos mensagem idêntica nas últimas 12 horas para evitar duplicados
        const hojeMenos12h = new Date(Date.now() - 12 * 60 * 60 * 1000);
        const jaExiste = await prisma.mensagemWhatsapp.findFirst({
          where: {
            numero: rev.whatsapp,
            tipo: 'LEMBRETE_CICLO_ABERTO',
            createdAt: { gte: hojeMenos12h }
          }
        });

        if (!jaExiste) {
          await prisma.mensagemWhatsapp.create({
            data: {
              numero: rev.whatsapp,
              mensagem: msgAbertura,
              tipo: 'LEMBRETE_CICLO_ABERTO',
              status: 'PENDENTE',
              lojaId: rev.lojaId || 'default-loja'
            }
          });
          console.log(`[Ciclo Worker] Agendado lembrete de janela aberta para ${rev.nome}`);
        }
      }

      // 2. Lembrete de Atraso no Acerto (primeiro dia após o encerramento da janela)
      const diaAtraso = parseInt(diaFimAcerto) === 31 ? 1 : parseInt(diaFimAcerto) + 1;
      if (diaHoje === diaAtraso) {
        // Verifica se ela realmente tem peças consignadas (maleta não vazia) para cobrar acerto
        const totalConsignado = await prisma.consignado.count({
          where: { usuarioId: rev.id }
        });

        if (totalConsignado > 0) {
          const msgAtraso = `Olá, *${rev.nome}*! ⚠️\nIdentificamos que o prazo para o acerto do seu ciclo expirou ontem (dia *${diaFimAcerto}*).\n\nPor favor, entre em contato com a administradora o quanto antes para regularizar o saldo de peças e fechar o seu acerto. Agradecemos a colaboração! 💼✨`;

          const hojeMenos12h = new Date(Date.now() - 12 * 60 * 60 * 1000);
          const jaExiste = await prisma.mensagemWhatsapp.findFirst({
            where: {
              numero: rev.whatsapp,
              tipo: 'LEMBRETE_CICLO_ATRASADO',
              createdAt: { gte: hojeMenos12h }
            }
          });

          if (!jaExiste) {
            await prisma.mensagemWhatsapp.create({
              data: {
                numero: rev.whatsapp,
                mensagem: msgAtraso,
                tipo: 'LEMBRETE_CICLO_ATRASADO',
                status: 'PENDENTE',
                lojaId: rev.lojaId || 'default-loja'
              }
            });
            console.log(`[Ciclo Worker] Agendado aviso de acerto atrasado para ${rev.nome}`);
          }
        }
      }
    }
  } catch (err) {
    console.error('[Ciclo Worker] Erro ao verificar ciclos mensais das revendedoras:', err);
  }
}



// ==========================================
// MIDDLEWARE DE ERRO GLOBAL
// ==========================================
app.use((err, req, res, next) => {
  console.error("💥 [Global Error Handler] Erro capturado:", err.stack || err.message || err);

  const status = err.status || 500;
  const mensagem = process.env.NODE_ENV === 'production'
    ? 'Ocorreu um erro interno no servidor.'
    : err.message || 'Erro interno desconhecido.';

  res.status(status).json({
    error: mensagem
  });
});
// ==========================================
// INICIALIZAÇÃO
// ==========================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor rodando com sucesso na porta ${PORT}`);
    inicializarLojaPadrao();
    // Iniciar worker de processamento do WhatsApp a cada 10 segundos
    setInterval(processarFilaWhatsApp, 10000);
    
    // Rodar a verificação de ciclos 5 segundos após a inicialização e depois a cada 24 horas
    setTimeout(verificarCiclosENotificarRevendedoras, 5000);
    setInterval(verificarCiclosENotificarRevendedoras, 24 * 60 * 60 * 1000);
  });
} else {
  // Inicialização mínima para quando o módulo é requerido por testes
  inicializarLojaPadrao();
}// Manipuladores globais de segurança contra quedas do processo Node.js
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ [Segurança do Processo] Promessa Rejeitada Não Capturada:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('💥 [Segurança do Processo] Exceção Não Capturada:', err.stack || err.message || err);
});

module.exports = { prisma, context, app };

