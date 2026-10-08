const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

const API_URL = 'http://localhost:5000/api';

async function login(email, senha) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha })
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function requestGet(endpoint, token, lojaId) {
  const headers = { 'Authorization': `Bearer ${token}` };
  if (lojaId) headers['x-loja-id'] = lojaId;
  const res = await fetch(`${API_URL}${endpoint}`, {
    headers
  });
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { status: res.status, data };
}

async function run() {
  console.log('========================================================================');
  console.log('🔒 TESTE DE BLOQUEIO DE RECURSO POR PLANO (MOVIMENTAÇÕES DE ESTOQUE)');
  console.log('========================================================================\n');

  // Localizar usuário Manager
  const manager = await prisma.usuario.findFirst({
    where: { role: 'Manager' },
    include: { loja: true }
  });
  const loja = manager.loja;
  console.log(`Loja: ${loja.nome} (ID: ${loja.id})`);
  console.log(`Manager: ${manager.nome} (Email: ${manager.email})`);

  // Garantir senha conhecida para o manager
  const senhaManager = 'admin123';
  const hashManager = await bcrypt.hash(senhaManager, 10);
  await prisma.usuario.update({
    where: { id: manager.id },
    data: { senhaHash: hashManager }
  });

  // Login do Manager
  const loginRes = await login(manager.email, senhaManager);
  if (loginRes.status !== 200 || !loginRes.data.token) {
    throw new Error(`Falha no login do manager: ${JSON.stringify(loginRes.data)}`);
  }
  const tokenManager = loginRes.data.token;
  console.log(`✅ Login do Manager realizado com sucesso.`);

  // -------------------------------------------------------------
  // TESTE 1: Loja com plano 'BASICO' deve bloquear acesso (403)
  // -------------------------------------------------------------
  await prisma.loja.update({
    where: { id: loja.id },
    data: { plano: 'BASICO' }
  });

  const res1 = await requestGet('/estoque/movimentacoes', tokenManager, loja.id);
  console.log(`\n[CENÁRIO 1] Loja no plano BASICO tentando acessar /api/estoque/movimentacoes:`);
  console.log(`HTTP Status: ${res1.status}`);
  console.log(`Resposta:`, res1.data);
  if (res1.status === 403 && res1.data.recursoBloqueado) {
    console.log(`✅ CENÁRIO 1 PASSOU: Endpoint bloqueado com 403 para plano BASICO!`);
  } else {
    console.error(`❌ CENÁRIO 1 FALHOU!`);
  }

  const res1b = await requestGet('/estoque/movimentacoes/resumo', tokenManager, loja.id);
  console.log(`\n[CENÁRIO 1b] Loja no plano BASICO tentando acessar /api/estoque/movimentacoes/resumo:`);
  console.log(`HTTP Status: ${res1b.status}`);
  if (res1b.status === 403) {
    console.log(`✅ CENÁRIO 1b PASSOU: Resumo de métricas também bloqueado com 403!`);
  } else {
    console.error(`❌ CENÁRIO 1b FALHOU!`);
  }

  // -------------------------------------------------------------
  // TESTE 2: Loja com plano 'BRONZE' deve permitir acesso (200)
  // -------------------------------------------------------------
  await prisma.loja.update({
    where: { id: loja.id },
    data: { plano: 'BRONZE' }
  });

  const res2 = await requestGet('/estoque/movimentacoes', tokenManager, loja.id);
  console.log(`\n[CENÁRIO 2] Loja no plano BRONZE tentando acessar /api/estoque/movimentacoes:`);
  console.log(`HTTP Status: ${res2.status}`);
  console.log(`Total de movimentações: ${Array.isArray(res2.data) ? res2.data.length : 'N/A'}`);
  if (res2.status === 200 && Array.isArray(res2.data)) {
    console.log(`✅ CENÁRIO 2 PASSOU: Acesso liberado no plano BRONZE!`);
  } else {
    console.error(`❌ CENÁRIO 2 FALHOU!`);
  }

  // -------------------------------------------------------------
  // TESTE 3: SuperAdmin operando loja no plano 'BASICO' deve ter acesso irrestrito
  // -------------------------------------------------------------
  await prisma.loja.update({
    where: { id: loja.id },
    data: { plano: 'BASICO' }
  });

  const superadmin = await prisma.usuario.findFirst({
    where: { role: 'SuperAdmin' }
  });
  const senhaSA = '0001';
  const hashSA = await bcrypt.hash(senhaSA, 10);
  await prisma.usuario.update({
    where: { id: superadmin.id },
    data: { senhaHash: hashSA }
  });

  const loginSARes = await login(superadmin.pin || superadmin.email, senhaSA);
  const tokenSA = loginSARes.data.token;

  const res3 = await requestGet('/estoque/movimentacoes', tokenSA, loja.id);
  console.log(`\n[CENÁRIO 3] SuperAdmin acessando movimentações de loja no plano BASICO:`);
  console.log(`HTTP Status: ${res3.status}`);
  if (res3.status === 200 && Array.isArray(res3.data)) {
    console.log(`✅ CENÁRIO 3 PASSOU: SuperAdmin tem bypass irrestrito com 200 OK!`);
  } else {
    console.error(`❌ CENÁRIO 3 FALHOU!`);
  }

  // Deixar loja no plano BRONZE (pago)
  await prisma.loja.update({
    where: { id: loja.id },
    data: { plano: 'BRONZE' }
  });
  console.log(`\nLoja retornada ao plano BRONZE para uso regular.`);

  await prisma.$disconnect();
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
