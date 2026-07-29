const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  console.log('🧹 Iniciando limpeza do banco de dados...\n');

  // 1. Deletar todos os Consultants (revendedoras)
  const deletedConsultants = await p.usuario.deleteMany({
    where: { role: 'Consultant' }
  });
  console.log(`✅ Revendedoras deletadas: ${deletedConsultants.count}`);

  // 2. Limpar consignados órfãos (se houver)
  const deletedConsignados = await p.consignado.deleteMany({});
  console.log(`✅ Consignados limpos: ${deletedConsignados.count}`);

  // 3. Limpar vendas de revendedoras
  const deletedVendas = await p.vendaRevendedora.deleteMany({});
  console.log(`✅ Vendas de revendedoras limpas: ${deletedVendas.count}`);

  // 4. Limpar histórico de acertos
  const deletedAcertos = await p.historicoAcerto.deleteMany({});
  console.log(`✅ Histórico de acertos limpo: ${deletedAcertos.count}`);

  // 5. Limpar mensagens WhatsApp
  const deletedWpp = await p.mensagemWhatsapp.deleteMany({});
  console.log(`✅ Mensagens WhatsApp limpas: ${deletedWpp.count}`);

  // 6. Limpar termos de consignação
  const deletedTermos = await p.termoConsignacao.deleteMany({});
  console.log(`✅ Termos de consignação limpos: ${deletedTermos.count}`);

  // 7. Limpar notificações
  const deletedNotif = await p.notificacao.deleteMany({});
  console.log(`✅ Notificações limpas: ${deletedNotif.count}`);

  // 8. Mostrar estado final
  console.log('\n=== ESTADO FINAL DO BANCO ===');
  const users = await p.usuario.findMany({
    select: { id: true, nome: true, role: true, lojaId: true, email: true, pin: true }
  });
  users.forEach(u => console.log(`  [${u.role}] ${u.nome} | lojaId: ${u.lojaId} | email: ${u.email} | pin: ${u.pin}`));

  const configs = await p.configuracao.findMany({
    select: { lojaId: true, nomeEmpresa: true, corPrimaria: true, corSecundaria: true, bgPrimary: true, bgCard: true, temaPref: true }
  });
  console.log('\n=== CONFIGURACOES ===');
  configs.forEach(c => console.log(`  lojaId: ${c.lojaId} | nome: ${c.nomeEmpresa} | corPrimaria: ${c.corPrimaria} | bgPrimary: ${c.bgPrimary}`));

  console.log('\n✅ Limpeza concluída! Banco pronto para novos testes.');
  await p.$disconnect();
}

main().catch(e => { console.error('❌ Erro:', e.message); process.exit(1); });
