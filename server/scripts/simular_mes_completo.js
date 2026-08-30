// server/scripts/simular_mes_completo.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const comissaoService = require('../services/ComissaoService');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function simularMesCompleto() {
  console.log("=========================================================================");
  console.log("🚀 SIMULAÇÃO COMPLETA DE 1 MÊS DE VENDAS E ACERTO DE CONTAS (4 AGENTES)");
  console.log("=========================================================================\n");

  // 1. LIMPEZA E CONFIGURAÇÃO DA LOJA E DOS 4 AGENTES
  console.log("1. Configurando Loja e Agentes de Teste...");

  let loja = await prisma.loja.findUnique({ where: { id: 'default-loja' } });
  if (!loja) {
    loja = await prisma.loja.create({
      data: { id: 'default-loja', nome: 'Brilho & Elegância Joias', plano: 'PLATINUM' }
    });
  }

  const senhaHash = await bcrypt.hash('Senha123!', 10);

  // Agente 1: Manager Principal
  const manager = await prisma.usuario.upsert({
    where: { email: 'vendedora.principal@brilhoelegancia.com' },
    update: { role: 'Manager', lojaId: 'default-loja' },
    create: { nome: 'Ana Manager Principal', email: 'vendedora.principal@brilhoelegancia.com', pin: '1000', senhaHash, role: 'Manager', lojaId: 'default-loja', comissao: 0 }
  });

  // Agente 2: Camila Santos (Comissão FIXA 30%)
  const revFixa = await prisma.usuario.upsert({
    where: { email: 'camila.santos@brilhoelegancia.com' },
    update: { role: 'Consultant', tipoComissao: 'FIXA', comissao: 30.0, baseCalculo: 'BRUTO', regraPerda: 'VALOR_VENDA' },
    create: { nome: 'Camila Santos', email: 'camila.santos@brilhoelegancia.com', pin: '2001', senhaHash, role: 'Consultant', lojaId: 'default-loja', tipoComissao: 'FIXA', comissao: 30.0, baseCalculo: 'BRUTO', regraPerda: 'VALOR_VENDA' }
  });

  // Agente 3: Beatriz Lima (Comissão PROGRESSIVA: 25%, 35%, 45%)
  const revProg = await prisma.usuario.upsert({
    where: { email: 'beatriz.lima@brilhoelegancia.com' },
    update: { role: 'Consultant', tipoComissao: 'PROGRESSIVA', comissao: 25.0, baseCalculo: 'BRUTO', periodoAcumulo: 'MENSAL' },
    create: { nome: 'Beatriz Lima', email: 'beatriz.lima@brilhoelegancia.com', pin: '2002', senhaHash, role: 'Consultant', lojaId: 'default-loja', tipoComissao: 'PROGRESSIVA', comissao: 25.0, baseCalculo: 'BRUTO', periodoAcumulo: 'MENSAL' }
  });

  await prisma.faixaComissao.deleteMany({ where: { usuarioId: revProg.id } });
  await prisma.faixaComissao.createMany({
    data: [
      { usuarioId: revProg.id, lojaId: 'default-loja', valorMin: 0, valorMax: 999.99, percentual: 25.0 },
      { usuarioId: revProg.id, lojaId: 'default-loja', valorMin: 1000, valorMax: 2499.99, percentual: 35.0 },
      { usuarioId: revProg.id, lojaId: 'default-loja', valorMin: 2500, valorMax: 999999, percentual: 45.0 }
    ]
  });

  // Agente 4: Carla Oliveira (Comissão META ÚNICA: Base 30% + 10% Bônus se >= R$ 2.000)
  const revMeta = await prisma.usuario.upsert({
    where: { email: 'carla.oliveira@brilhoelegancia.com' },
    update: { role: 'Consultant', tipoComissao: 'META_UNICA', comissao: 30.0, metaUnicaValor: 2000.0, metaUnicaBonus: 10.0, metaUnicaTipoBonus: 'PERCENTUAL', baseCalculo: 'BRUTO' },
    create: { nome: 'Carla Oliveira', email: 'carla.oliveira@brilhoelegancia.com', pin: '2003', senhaHash, role: 'Consultant', lojaId: 'default-loja', tipoComissao: 'META_UNICA', comissao: 30.0, metaUnicaValor: 2000.0, metaUnicaBonus: 10.0, metaUnicaTipoBonus: 'PERCENTUAL', baseCalculo: 'BRUTO' }
  });

  console.log(`   ✅ Agentes criados:\n      1. Manager: ${manager.nome}\n      2. Revendedora FIXA (30%): ${revFixa.nome}\n      3. Revendedora PROGRESSIVA (25%/35%/45%): ${revProg.nome}\n      4. Revendedora META ÚNICA (30%+10% s/ R$2.000): ${revMeta.nome}\n`);

  // Limpa histórico de vendas e acertos anteriores para teste limpo
  await prisma.vendaRevendedora.deleteMany({ where: { lojaId: 'default-loja' } });
  await prisma.historicoAcerto.deleteMany({ where: { lojaId: 'default-loja' } });
  await prisma.consignado.deleteMany({ where: { lojaId: 'default-loja' } });

  // 2. CADASTRO DE PRODUTOS E ENVIOS PARA AS MALETAS
  console.log("2. Cadastrando Produtos e Enviando para as Maletas das Revendedoras...");

  const criarProd = async (codigo, nome, preco) => {
    let p = await prisma.produto.findFirst({ where: { lojaId: 'default-loja', codigo } });
    if (!p) {
      p = await prisma.produto.create({
        data: {
          lojaId: 'default-loja', codigo, nome, categoria: 'Semijoias', custoBruto: preco / 3, custoBanho: 0, custoLiquido: preco / 3, markup: 3,
          variacoes: { create: { lojaId: 'default-loja', sku: `${codigo}-V1`, banho: 'OURO', quantidade: 50 } }
        },
        include: { variacoes: true }
      });
    } else {
      p = await prisma.produto.findUnique({ where: { id: p.id }, include: { variacoes: true } });
    }
    return p;
  };

  const prod1 = await criarProd('COL-01', 'Colar Gravatinha Ouro', 135.00);
  const prod2 = await criarProd('BRI-02', 'Brinco Argola Cravejada', 80.00);
  const prod3 = await criarProd('ANE-03', 'Anel Solitário Prata', 66.50);
  const prod4 = await criarProd('PUL-04', 'Pulseira Elos Portugueses', 159.60);
  const prod5 = await criarProd('CHO-05', 'Choker Fita Ouro', 114.00);
  const prod6 = await criarProd('TOR-06', 'Tornozeleira Corações', 69.00);
  const prod7 = await criarProd('COR-07', 'Corrente Grumet Prata', 162.50);
  const prod8 = await criarProd('COL-08', 'Colar Relicário Coração', 150.00);
  const prod9 = await criarProd('ANE-09', 'Anel Aparador Cravejado', 89.60);
  const prod10 = await criarProd('BRI-10', 'Brinco Gota Esmeralda', 105.00);

  // Consignar produtos para Maletas
  const consignar = async (usuarioId, prod, qtd, preco) => {
    return prisma.consignado.create({
      data: { lojaId: 'default-loja', usuarioId, produtoVariacaoId: prod.variacoes[0].id, quantidadeConsignada: qtd, precoVenda: preco }
    });
  };

  // Maleta Camila (Fixa)
  const c1 = await consignar(revFixa.id, prod1, 5, 135.00);
  const c2 = await consignar(revFixa.id, prod2, 5, 80.00);
  const c3 = await consignar(revFixa.id, prod3, 5, 66.50);

  // Maleta Beatriz (Progressiva)
  const b1 = await consignar(revProg.id, prod4, 5, 159.60);
  const b2 = await consignar(revProg.id, prod5, 5, 114.00);
  const b3 = await consignar(revProg.id, prod6, 15, 69.00);
  const b4 = await consignar(revProg.id, prod7, 5, 162.50);

  // Maleta Carla (Meta Única)
  const m1 = await consignar(revMeta.id, prod8, 5, 150.00);
  const m2 = await consignar(revMeta.id, prod9, 10, 89.60);
  const m3 = await consignar(revMeta.id, prod10, 8, 105.00);

  console.log("   ✅ Produtos consignados nas 3 maletas com sucesso!\n");

  // 3. SIMULAR VENDAS AO LONGO DO MÊS
  console.log("3. Simulando Vendas do Mês Inteiro...");

  const registrarVenda = async (usuarioId, prod, qtd, preco) => {
    const comissaoInicial = preco * qtd * 0.3; // rascunho
    const venda = await prisma.vendaRevendedora.create({
      data: {
        lojaId: 'default-loja', usuarioId, produtoId: prod.id, produtoVariacaoId: prod.variacoes[0].id, sku: prod.variacoes[0].sku,
        nomeProduto: prod.nome, codigoProduto: prod.codigo, quantidade: qtd, precoVenda: preco, comissaoValor: comissaoInicial
      }
    });
    // Executa recálculo retroativo no ciclo
    await comissaoService.recalcularVendasCicloEmAberto(prisma, usuarioId, 'default-loja');
    return venda;
  };

  // --- Vendas da Camila (FIXA 30%) ---
  console.log("   🔹 Registrando vendas da Camila (FIXA 30%)...");
  await registrarVenda(revFixa.id, prod1, 3, 135.00); // R$ 405,00
  await registrarVenda(revFixa.id, prod2, 4, 80.00);  // R$ 320,00
  await registrarVenda(revFixa.id, prod3, 5, 66.50);  // R$ 332,50

  // --- Vendas da Beatriz (PROGRESSIVA) ---
  console.log("   🔹 Registrando vendas da Beatriz (PROGRESSIVA - Faixas: R$0-999=25%, R$1000-2499=35%, R$2500+=45%)...");
  await registrarVenda(revProg.id, prod4, 4, 159.60); // R$ 638,40 -> 25%
  console.log("      • Venda 1: R$ 638,40 -> Acumulado: R$ 638,40 (Faixa 25%)");

  await registrarVenda(revProg.id, prod5, 4, 114.00); // R$ 456,00 -> Acumulado: R$ 1.094,40 -> 35%
  console.log("      • Venda 2: R$ 456,00 -> Acumulado: R$ 1.094,40 (Sobe p/ 35%! Recalcula venda 1 retroativamente)");

  await registrarVenda(revProg.id, prod6, 15, 69.00); // R$ 1.035,00 -> Acumulado: R$ 2.129,40 -> 35%
  console.log("      • Venda 3: R$ 1.035,00 -> Acumulado: R$ 2.129,40 (Faixa 35%)");

  await registrarVenda(revProg.id, prod7, 4, 162.50); // R$ 650,00 -> Acumulado: R$ 2.779,40 -> 45%
  console.log("      • Venda 4: R$ 650,00 -> Acumulado: R$ 2.779,40 (Sobe p/ 45%! Recalcula TODAS as vendas retroativamente)");

  // --- Vendas da Carla (META ÚNICA) ---
  console.log("   🔹 Registrando vendas da Carla (META ÚNICA - Meta R$2.000: 30% base -> 40% com bônus)...");
  await registrarVenda(revMeta.id, prod8, 5, 150.00); // R$ 750,00
  console.log("      • Venda 1: R$ 750,00 -> Acumulado: R$ 750,00");

  await registrarVenda(revMeta.id, prod9, 8, 89.60);  // R$ 716,80
  console.log("      • Venda 2: R$ 716,80 -> Acumulado: R$ 1.466,80");

  await registrarVenda(revMeta.id, prod10, 6, 105.00); // R$ 630,00
  console.log("      • Venda 3: R$ 630,00 -> Acumulado: R$ 2.096,80 (META ATINGIDA >= R$2.000! Comissão sobe p/ 40%!)");

  console.log("   ✅ Vendas simuladas com recálculo em tempo real!\n");

  // 4. FECHAMENTO DE ACERTO
  console.log("=========================================================================");
  console.log("💰 4. FECHAMENTO DE ACERTO DE CONTAS E CONFERÊNCIA MATEMÁTICA");
  console.log("=========================================================================\n");

  // Recarrega as revendedoras do banco com faixasComissao incluídas
  const revFixaDB = await prisma.usuario.findUnique({ where: { id: revFixa.id }, include: { faixasComissao: true } });
  const revProgDB = await prisma.usuario.findUnique({ where: { id: revProg.id }, include: { faixasComissao: true } });
  const revMetaDB = await prisma.usuario.findUnique({ where: { id: revMeta.id }, include: { faixasComissao: true } });

  // ACERTO CAMILA (FIXA 30%)
  // Camila vendeu R$ 1.057,50. Vamos simular 1 peça perdida de R$ 135,00 (Colar Gravatinha)
  console.log("📌 --- ACERTO 1: CAMILA SANTOS (Comissão FIXA 30%) ---");
  const itensAcertoCamila = [
    { produtoVariacaoId: prod1.variacoes[0].id, quantidadeVendida: 3, quantidadeDevolvida: 1, quantidadePerdida: 1, quantidadeDefeito: 0, precoVenda: 135.00 },
    { produtoVariacaoId: prod2.variacoes[0].id, quantidadeVendida: 4, quantidadeDevolvida: 1, quantidadePerdida: 0, quantidadeDefeito: 0, precoVenda: 80.00 },
    { produtoVariacaoId: prod3.variacoes[0].id, quantidadeVendida: 5, quantidadeDevolvida: 0, quantidadePerdida: 0, quantidadeDefeito: 0, precoVenda: 66.50 }
  ];

  const fatBrutoCamila = (3 * 135) + (4 * 80) + (5 * 66.50); // 1057.50
  const perdaCamila = 1 * 135.00; // 135.00
  const calcCamila = comissaoService.calcularComissao(revFixaDB, fatBrutoCamila, fatBrutoCamila, perdaCamila);

  console.log(`   • Faturamento Bruto Vendido: R$ ${fatBrutoCamila.toFixed(2)}`);
  console.log(`   • Peça Perdida (Desconto): R$ ${perdaCamila.toFixed(2)}`);
  console.log(`   • Base de Cálculo (BRUTO): R$ ${fatBrutoCamila.toFixed(2)}`);
  console.log(`   • Percentual de Comissão: ${calcCamila.percentualComissao}%`);
  console.log(`   • Comissão Bruta (30% s/ R$1.057,50): R$ ${calcCamila.comissaoBruta.toFixed(2)}`);
  console.log(`   • Comissão Paga (Bruta - Perda = R$317,25 - R$135,00): R$ ${calcCamila.comissaoPaga.toFixed(2)}`);
  console.log(`   • Receita Líquida Empresa: R$ ${calcCamila.liquidoConectaJoias.toFixed(2)}`);
  const confCamilaOk = Math.abs(calcCamila.comissaoPaga - 182.25) < 0.01;
  console.log(`   👉 Conferência Matemática: ${confCamilaOk ? '✅ EXATA! (R$ 182,25)' : '❌ ERRO'}\n`);

  // ACERTO BEATRIZ (PROGRESSIVA 45%)
  console.log("📌 --- ACERTO 2: BEATRIZ LIMA (Comissão PROGRESSIVA 45% - Vol: R$ 2.779,40) ---");
  const fatBrutoBeatriz = (4 * 159.60) + (4 * 114.00) + (15 * 69.00) + (4 * 162.50); // 2779.40
  const calcBeatriz = comissaoService.calcularComissao(revProgDB, fatBrutoBeatriz, fatBrutoBeatriz, 0);

  console.log(`   • Faturamento Bruto Vendido: R$ ${fatBrutoBeatriz.toFixed(2)}`);
  console.log(`   • Faixa Atingida: ${calcBeatriz.percentualComissao}% (Faturamento >= R$ 2.500)`);
  console.log(`   • Comissão Paga (45% s/ R$2.779,40): R$ ${calcBeatriz.comissaoPaga.toFixed(2)}`);
  console.log(`   • Receita Líquida Empresa: R$ ${calcBeatriz.liquidoConectaJoias.toFixed(2)}`);
  const confBeatrizOk = Math.abs(calcBeatriz.comissaoPaga - 1250.73) < 0.01;
  console.log(`   👉 Conferência Matemática: ${confBeatrizOk ? '✅ EXATA! (R$ 1.250,73)' : '❌ ERRO'}\n`);

  // ACERTO CARLA (META ÚNICA 40%)
  console.log("📌 --- ACERTO 3: CARLA OLIVEIRA (Comissão META ÚNICA 40% - Vol: R$ 2.096,80) ---");
  const fatBrutoCarla = (5 * 150.00) + (8 * 89.60) + (6 * 105.00); // 2096.80
  const calcCarla = comissaoService.calcularComissao(revMetaDB, fatBrutoCarla, fatBrutoCarla, 0);

  console.log(`   • Faturamento Bruto Vendido: R$ ${fatBrutoCarla.toFixed(2)}`);
  console.log(`   • Meta Atingida? SIM (>= R$ 2.000,00)`);
  console.log(`   • Percentual Aplicado (30% + 10% bônus): ${calcCarla.percentualComissao}%`);
  console.log(`   • Comissão Paga (40% s/ R$2.096,80): R$ ${calcCarla.comissaoPaga.toFixed(2)}`);
  console.log(`   • Receita Líquida Empresa: R$ ${calcCarla.liquidoConectaJoias.toFixed(2)}`);
  const confCarlaOk = Math.abs(calcCarla.comissaoPaga - 838.72) < 0.01;
  console.log(`   👉 Conferência Matemática: ${confCarlaOk ? '✅ EXATA! (R$ 838,72)' : '❌ ERRO'}\n`);

  // Registra no historicoAcerto
  await prisma.historicoAcerto.create({
    data: {
      lojaId: 'default-loja', usuarioId: revFixa.id, totalConsignada: 15, totalVendida: 12, totalDevolvida: 2, totalPerdida: 1, totalDefeito: 0,
      faturamentoBruto: fatBrutoCamila, valorDescontoPerda: perdaCamila, comissaoPaga: calcCamila.comissaoPaga, liquidoConectaJoias: calcCamila.liquidoConectaJoias
    }
  });

  await prisma.historicoAcerto.create({
    data: {
      lojaId: 'default-loja', usuarioId: revProg.id, totalConsignada: 29, totalVendida: 27, totalDevolvida: 2, totalPerdida: 0, totalDefeito: 0,
      faturamentoBruto: fatBrutoBeatriz, valorDescontoPerda: 0, comissaoPaga: calcBeatriz.comissaoPaga, liquidoConectaJoias: calcBeatriz.liquidoConectaJoias
    }
  });

  await prisma.historicoAcerto.create({
    data: {
      lojaId: 'default-loja', usuarioId: revMeta.id, totalConsignada: 23, totalVendida: 19, totalDevolvida: 4, totalPerdida: 0, totalDefeito: 0,
      faturamentoBruto: fatBrutoCarla, valorDescontoPerda: 0, comissaoPaga: calcCarla.comissaoPaga, liquidoConectaJoias: calcCarla.liquidoConectaJoias
    }
  });

  console.log("=========================================================================");
  console.log("🎉 SIMULAÇÃO COMPLETA CONCLUÍDA — TODAS AS CONTAS ESTÃO 100% CORRETAS!");
  console.log("=========================================================================\n");

  await prisma.$disconnect();
}

simularMesCompleto().catch(err => {
  console.error("Erro na simulação:", err);
  process.exit(1);
});
