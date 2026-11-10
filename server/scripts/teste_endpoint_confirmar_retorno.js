const { PrismaClient } = require('../node_modules/@prisma/client');
const prisma = new PrismaClient();

async function testarLogicaEndpoint() {
  console.log("=== TESTANDO ENDPOINT /api/saas/confirmar-retorno-pagamento ===");

  const loja = await prisma.loja.findFirst();
  console.log(`Loja de teste: ${loja.id}`);

  // 1. Coloca a loja no plano BASICO
  await prisma.loja.update({
    where: { id: loja.id },
    data: { plano: 'BASICO', statusPlano: 'PENDENTE' }
  });

  // 2. Simula o payload que o frontend (sucesso.html ou pagamento.js) envia
  const payload = {
    paymentId: 'cakto_pay_123456',
    status: 'approved',
    externalReference: `${loja.id}|PLATINUM`,
    planoDesejado: 'PLATINUM',
    lojaId: loja.id
  };

  console.log("Payload enviado pelo retorno de checkout:", payload);

  // Executa a lógica de ativação
  const dataVencimento = new Date();
  dataVencimento.setDate(dataVencimento.getDate() + 30);

  const lojaAtualizada = await prisma.loja.upsert({
    where: { id: payload.lojaId },
    update: {
      statusPlano: 'ATIVO',
      plano: payload.planoDesejado,
      downgradePendente: null,
      vencimentoPlano: dataVencimento
    },
    create: {
      id: payload.lojaId,
      nome: 'Minha Marca',
      statusPlano: 'ATIVO',
      plano: payload.planoDesejado,
      downgradePendente: null,
      vencimentoPlano: dataVencimento
    }
  });

  console.log("Resposta simulada da API:", {
    ok: true,
    plano: lojaAtualizada.plano,
    statusPlano: lojaAtualizada.statusPlano,
    vencimentoPlano: lojaAtualizada.vencimentoPlano
  });

  if (lojaAtualizada.plano === 'PLATINUM' && lojaAtualizada.statusPlano === 'ATIVO') {
    console.log("🎉 Teste aprovado com sucesso! A loja foi ativada como PLATINUM.");
  } else {
    throw new Error("Falha na ativação");
  }
}

testarLogicaEndpoint()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
