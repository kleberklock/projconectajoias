const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const novoPlano = process.argv[2] || 'BASICO';

async function main() {
  await prisma.loja.updateMany({
    data: { plano: novoPlano }
  });
  console.log(`Todas as lojas atualizadas para o plano: ${novoPlano}`);
  await prisma.$disconnect();
}

main().catch(console.error);
