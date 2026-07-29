const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const users = await p.usuario.findMany({
    select: { id: true, nome: true, role: true, lojaId: true, email: true, pin: true }
  });
  console.log('=== USUARIOS ===');
  users.forEach(u => console.log(`  [${u.role}] ${u.nome} | lojaId: ${u.lojaId} | email: ${u.email} | pin: ${u.pin}`));

  const configs = await p.configuracao.findMany({
    select: { lojaId: true, nomeEmpresa: true, corPrimaria: true, corSecundaria: true, bgPrimary: true, bgCard: true, temaPref: true }
  });
  console.log('\n=== CONFIGURACOES ===');
  configs.forEach(c => console.log(`  lojaId: ${c.lojaId} | nome: ${c.nomeEmpresa} | corPrimaria: ${c.corPrimaria} | bgPrimary: ${c.bgPrimary} | temaPref: ${c.temaPref}`));

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
