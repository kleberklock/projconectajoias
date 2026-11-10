const { PrismaClient } = require('../node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=== INICIANDO TESTE DO FLUXO DE RETORNO PÓS-PAGAMENTO ===");

  // 1. Localiza a primeira loja ou cria uma loja de teste
  let loja = await prisma.loja.findFirst();
  if (!loja) {
    loja = await prisma.loja.create({
      data: {
        id: 'loja-teste-pagamento',
        nome: 'Loja Teste Pagamento',
        plano: 'BASICO',
        statusPlano: 'PENDENTE'
      }
    });
  }

  console.log(`Loja identificada: ${loja.id} | Plano inicial: ${loja.plano} | Status inicial: ${loja.statusPlano}`);

  // Simula o estado no plano Básico
  await prisma.loja.update({
    where: { id: loja.id },
    data: { plano: 'BASICO', statusPlano: 'PENDENTE' }
  });

  const lojaAntes = await prisma.loja.findUnique({ where: { id: loja.id } });
  console.log(`Estado antes do pagamento: Plano=${lojaAntes.plano}, Status=${lojaAntes.statusPlano}`);

  // 2. Simula o retorno de checkout do plano GOLD
  const planoDesejado = 'GOLD';
  const dataVencimento = new Date();
  dataVencimento.setDate(dataVencimento.getDate() + 30);

  const lojaAtualizada = await prisma.loja.update({
    where: { id: loja.id },
    data: {
      statusPlano: 'ATIVO',
      plano: planoDesejado,
      downgradePendente: null,
      vencimentoPlano: dataVencimento
    }
  });

  console.log(`Estado pós-retorno: Plano=${lojaAtualizada.plano}, Status=${lojaAtualizada.statusPlano}, Vencimento=${lojaAtualizada.vencimentoPlano.toISOString()}`);

  if (lojaAtualizada.plano === 'GOLD' && lojaAtualizada.statusPlano === 'ATIVO') {
    console.log("✅ SUCESSO: O banco de dados foi atualizado com sucesso e o plano está ATIVO!");
  } else {
    console.error("❌ FALHA: O plano não foi atualizado como esperado.");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
