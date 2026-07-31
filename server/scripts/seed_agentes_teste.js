const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function seedAgentesTeste() {
  console.log("=================================================");
  console.log("🚀 INICIANDO SEMEADURA DOS 4 AGENTES DE TESTE");
  console.log("=================================================\n");

  // 1. Criar ou Atualizar Loja Padrão
  console.log("1. Configurando Loja Fictícia 'Brilho & Elegância Joias'...");
  let loja = await prisma.loja.findUnique({ where: { id: 'default-loja' } });
  if (!loja) {
    loja = await prisma.loja.create({
      data: {
        id: 'default-loja',
        nome: 'Brilho & Elegância Joias',
        cnpj: '98.765.432/0001-10',
        plano: 'PLATINUM'
      }
    });
  } else {
    loja = await prisma.loja.update({
      where: { id: 'default-loja' },
      data: {
        nome: 'Brilho & Elegância Joias',
        plano: 'PLATINUM'
      }
    });
  }
  console.log(`   ✅ Loja pronta: ${loja.nome}`);

  // Configuração visual da loja
  await prisma.configuracao.upsert({
    where: { id: 'config-default-loja' },
    update: {
      nomeEmpresa: 'Brilho & Elegância Joias',
      corPrimaria: '#d4af37',
      corSecundaria: '#111111',
      bgPrimary: '#0a0a0a',
      bgCard: '#121212',
      whatsappAtendimento: '5511998877665',
      temaPref: 'ESCURO'
    },
    create: {
      id: 'config-default-loja',
      lojaId: 'default-loja',
      nomeEmpresa: 'Brilho & Elegância Joias',
      corPrimaria: '#d4af37',
      corSecundaria: '#111111',
      bgPrimary: '#0a0a0a',
      bgCard: '#121212',
      whatsappAtendimento: '5511998877665',
      temaPref: 'ESCURO'
    }
  });

  const senhaComum = await bcrypt.hash('Senha123!', 10);

  // 2. Agente 1: Vendedora Principal (Manager/Admin da Loja)
  console.log("\n2. Criando Agente 1: Vendedora Principal (Manager)...");
  const ag1Email = "vendedora.principal@brilhoelegancia.com";
  const ag1 = await prisma.usuario.upsert({
    where: { email: ag1Email },
    update: {
      nome: "Vendedora Principal",
      pin: "1000",
      senhaHash: senhaComum,
      role: "Manager",
      lojaId: "default-loja",
      whatsapp: "5511998877665"
    },
    create: {
      nome: "Vendedora Principal",
      email: ag1Email,
      pin: "1000",
      senhaHash: senhaComum,
      role: "Manager",
      lojaId: "default-loja",
      whatsapp: "5511998877665",
      comissao: 0.0
    }
  });
  console.log(`   ✅ Agente 1 Criado! Email: ${ag1.email} | PIN: ${ag1.pin}`);

  // 3. Agente 2: Revendedora 1 (Comissão Fixa 30%)
  console.log("\n3. Criando Agente 2: Revendedora 1 (Comissão Fixa 30%)...");
  const ag2Email = "camila.santos@brilhoelegancia.com";
  const ag2 = await prisma.usuario.upsert({
    where: { email: ag2Email },
    update: {
      nome: "Camila Santos",
      pin: "2001",
      senhaHash: senhaComum,
      role: "Consultant",
      lojaId: "default-loja",
      whatsapp: "5511911112222",
      tipoComissao: "FIXA",
      comissao: 30.0
    },
    create: {
      nome: "Camila Santos",
      email: ag2Email,
      pin: "2001",
      senhaHash: senhaComum,
      role: "Consultant",
      lojaId: "default-loja",
      whatsapp: "5511911112222",
      tipoComissao: "FIXA",
      comissao: 30.0
    }
  });
  console.log(`   ✅ Agente 2 Criado! Nome: ${ag2.nome} | PIN: ${ag2.pin} | Comissão: 30% Fixa`);

  // 4. Agente 3: Revendedora 2 (Comissão Progressiva por Faixas: 25%, 35%, 45%)
  console.log("\n4. Criando Agente 3: Revendedora 2 (Comissão Progressiva por Faixas)...");
  const ag3Email = "beatriz.lima@brilhoelegancia.com";
  
  // Limpar faixas de comissão antigas se houver
  const ag3Existente = await prisma.usuario.findUnique({ where: { email: ag3Email } });
  if (ag3Existente) {
    await prisma.faixaComissao.deleteMany({ where: { usuarioId: ag3Existente.id } });
  }

  const ag3 = await prisma.usuario.upsert({
    where: { email: ag3Email },
    update: {
      nome: "Beatriz Lima",
      pin: "2002",
      senhaHash: senhaComum,
      role: "Consultant",
      lojaId: "default-loja",
      whatsapp: "5511922223333",
      tipoComissao: "PROGRESSIVA",
      comissao: 25.0
    },
    create: {
      nome: "Beatriz Lima",
      email: ag3Email,
      pin: "2002",
      senhaHash: senhaComum,
      role: "Consultant",
      lojaId: "default-loja",
      whatsapp: "5511922223333",
      tipoComissao: "PROGRESSIVA",
      comissao: 25.0
    }
  });

  // Faixas da Beatriz
  await prisma.faixaComissao.createMany({
    data: [
      { usuarioId: ag3.id, lojaId: "default-loja", valorMin: 0, valorMax: 999.99, percentual: 25.0 },
      { usuarioId: ag3.id, lojaId: "default-loja", valorMin: 1000, valorMax: 2499.99, percentual: 35.0 },
      { usuarioId: ag3.id, lojaId: "default-loja", valorMin: 2500, valorMax: 999999, percentual: 45.0 }
    ]
  });
  console.log(`   ✅ Agente 3 Criado! Nome: ${ag3.nome} | PIN: ${ag3.pin} | Comissão: Progressiva (25%, 35%, 45%)`);

  // 5. Agente 4: Revendedora 3 (Comissão Meta Única: 30% base + 10% bônus acima de R$ 2.000)
  console.log("\n5. Criando Agente 4: Revendedora 3 (Comissão Meta Única com Bônus)...");
  const ag4Email = "carla.oliveira@brilhoelegancia.com";
  const ag4 = await prisma.usuario.upsert({
    where: { email: ag4Email },
    update: {
      nome: "Carla Oliveira",
      pin: "2003",
      senhaHash: senhaComum,
      role: "Consultant",
      lojaId: "default-loja",
      whatsapp: "5511933334444",
      tipoComissao: "META_UNICA",
      comissao: 30.0,
      metaUnicaValor: 2000.0,
      metaUnicaBonus: 10.0,
      metaUnicaTipoBonus: "PERCENTUAL"
    },
    create: {
      nome: "Carla Oliveira",
      email: ag4Email,
      pin: "2003",
      senhaHash: senhaComum,
      role: "Consultant",
      lojaId: "default-loja",
      whatsapp: "5511933334444",
      tipoComissao: "META_UNICA",
      comissao: 30.0,
      metaUnicaValor: 2000.0,
      metaUnicaBonus: 10.0,
      metaUnicaTipoBonus: "PERCENTUAL"
    }
  });
  console.log(`   ✅ Agente 4 Criado! Nome: ${ag4.nome} | PIN: ${ag4.pin} | Comissão: Meta R$ 2.000 -> +10% Bônus`);

  // 6. Cadastrar 10+ Produtos Fictícios com Variações de Estoque
  console.log("\n6. Cadastrando 10 Produtos Fictícios no Estoque Central...");

  const listaProdutos = [
    { codigo: "COL-GRAV-OU", nome: "Colar Gravatinha Zircônia", categoria: "Colares", custoBruto: 35.0, custoBanho: 10.0, markup: 3.0, banho: "OURO", qtd: 20 },
    { codigo: "BRI-ARG-ROD", nome: "Brinco Argola Cravejada", categoria: "Brincos", custoBruto: 20.0, custoBanho: 5.0, markup: 3.2, banho: "RODIO", qtd: 25 },
    { codigo: "ANE-SOL-PRA", nome: "Anel Solitário Ajustável", categoria: "Anéis", custoBruto: 15.0, custoBanho: 4.0, markup: 3.5, banho: "PRATA", qtd: 18 },
    { codigo: "PUL-ELO-OU", nome: "Pulseira Elos Portugueses", categoria: "Pulseiras", custoBruto: 45.0, custoBanho: 12.0, markup: 2.8, banho: "OURO", qtd: 15 },
    { codigo: "CHO-FIT-OU", nome: "Choker Fita Banhada a Ouro", categoria: "Colares", custoBruto: 30.0, custoBanho: 8.0, markup: 3.0, banho: "OURO", qtd: 12 },
    { codigo: "BRI-GOT-RN", nome: "Brinco Gota Esmeralda", categoria: "Brincos", custoBruto: 28.0, custoBanho: 7.0, markup: 3.0, banho: "RODIO_NEGRO", qtd: 14 },
    { codigo: "COR-GRU-PRA", nome: "Corrente Masculina Grumet", categoria: "Colares", custoBruto: 50.0, custoBanho: 15.0, markup: 2.5, banho: "PRATA", qtd: 10 },
    { codigo: "TOR-COR-OU", nome: "Tornozeleira Corações", categoria: "Tornozeleiras", custoBruto: 18.0, custoBanho: 5.0, markup: 3.0, banho: "OURO", qtd: 30 },
    { codigo: "ANE-APA-OU", nome: "Anel Aparador Cravejado", categoria: "Anéis", custoBruto: 22.0, custoBanho: 6.0, markup: 3.2, banho: "OURO", qtd: 22 },
    { codigo: "COL-REL-PRA", nome: "Colar Relicário Coração", categoria: "Colares", custoBruto: 40.0, custoBanho: 10.0, markup: 3.0, banho: "PRATA", qtd: 16 }
  ];

  const produtosCriados = [];

  for (const p of listaProdutos) {
    const custoLiquido = p.custoBruto + p.custoBanho;
    
    let prod = await prisma.produto.findFirst({
      where: { lojaId: "default-loja", codigo: p.codigo }
    });

    if (!prod) {
      prod = await prisma.produto.create({
        data: {
          lojaId: "default-loja",
          codigo: p.codigo,
          nome: p.nome,
          categoria: p.categoria,
          custoBruto: p.custoBruto,
          custoBanho: p.custoBanho,
          custoLiquido,
          markup: p.markup,
          variacoes: {
            create: {
              lojaId: "default-loja",
              sku: `${p.codigo}-VAR1`,
              banho: p.banho,
              quantidade: p.qtd
            }
          }
        },
        include: { variacoes: true }
      });
    } else {
      prod = await prisma.produto.update({
        where: { id: prod.id },
        data: {
          nome: p.nome,
          categoria: p.categoria,
          custoBruto: p.custoBruto,
          custoBanho: p.custoBanho,
          custoLiquido,
          markup: p.markup
        },
        include: { variacoes: true }
      });
    }

    produtosCriados.push(prod);
    console.log(`   📦 Produto: [${prod.codigo}] ${prod.nome} | Estoque Central: ${prod.variacoes[0].quantidade} un | Preço Calculado: R$ ${(prod.custoLiquido * prod.markup).toFixed(2)}`);
  }

  // 7. Consignar Peças para as Maletas das Revendedoras (Agentes 2, 3 e 4)
  console.log("\n7. Montando Maletas de Consignação das Revendedoras...");

  // Consignar para Agente 2 (Camila)
  const p1 = produtosCriados[0]; // COL-GRAV-OU
  const p2 = produtosCriados[1]; // BRI-ARG-ROD
  const p3 = produtosCriados[2]; // ANE-SOL-PRA

  await prisma.consignado.upsert({
    where: { usuarioId_produtoVariacaoId: { usuarioId: ag2.id, produtoVariacaoId: p1.variacoes[0].id } },
    update: { quantidadeConsignada: 4, precoVenda: p1.custoLiquido * p1.markup },
    create: { lojaId: "default-loja", usuarioId: ag2.id, produtoVariacaoId: p1.variacoes[0].id, quantidadeConsignada: 4, precoVenda: p1.custoLiquido * p1.markup }
  });

  await prisma.consignado.upsert({
    where: { usuarioId_produtoVariacaoId: { usuarioId: ag2.id, produtoVariacaoId: p2.variacoes[0].id } },
    update: { quantidadeConsignada: 5, precoVenda: p2.custoLiquido * p2.markup },
    create: { lojaId: "default-loja", usuarioId: ag2.id, produtoVariacaoId: p2.variacoes[0].id, quantidadeConsignada: 5, precoVenda: p2.custoLiquido * p2.markup }
  });
  console.log(`   💼 Maleta de Camila Santos pronta (9 peças consignadas)`);

  // Consignar para Agente 3 (Beatriz)
  const p4 = produtosCriados[3]; // PUL-ELO-OU
  const p5 = produtosCriados[4]; // CHO-FIT-OU
  const p6 = produtosCriados[5]; // BRI-GOT-RN

  await prisma.consignado.upsert({
    where: { usuarioId_produtoVariacaoId: { usuarioId: ag3.id, produtoVariacaoId: p4.variacoes[0].id } },
    update: { quantidadeConsignada: 6, precoVenda: p4.custoLiquido * p4.markup },
    create: { lojaId: "default-loja", usuarioId: ag3.id, produtoVariacaoId: p4.variacoes[0].id, quantidadeConsignada: 6, precoVenda: p4.custoLiquido * p4.markup }
  });

  await prisma.consignado.upsert({
    where: { usuarioId_produtoVariacaoId: { usuarioId: ag3.id, produtoVariacaoId: p5.variacoes[0].id } },
    update: { quantidadeConsignada: 4, precoVenda: p5.custoLiquido * p5.markup },
    create: { lojaId: "default-loja", usuarioId: ag3.id, produtoVariacaoId: p5.variacoes[0].id, quantidadeConsignada: 4, precoVenda: p5.custoLiquido * p5.markup }
  });
  console.log(`   💼 Maleta de Beatriz Lima pronta (10 peças consignadas)`);

  // Consignar para Agente 4 (Carla)
  const p7 = produtosCriados[6]; // COR-GRU-PRA
  const p8 = produtosCriados[7]; // TOR-COR-OU
  const p9 = produtosCriados[8]; // ANE-APA-OU

  await prisma.consignado.upsert({
    where: { usuarioId_produtoVariacaoId: { usuarioId: ag4.id, produtoVariacaoId: p7.variacoes[0].id } },
    update: { quantidadeConsignada: 3, precoVenda: p7.custoLiquido * p7.markup },
    create: { lojaId: "default-loja", usuarioId: ag4.id, produtoVariacaoId: p7.variacoes[0].id, quantidadeConsignada: 3, precoVenda: p7.custoLiquido * p7.markup }
  });

  await prisma.consignado.upsert({
    where: { usuarioId_produtoVariacaoId: { usuarioId: ag4.id, produtoVariacaoId: p8.variacoes[0].id } },
    update: { quantidadeConsignada: 8, precoVenda: p8.custoLiquido * p8.markup },
    create: { lojaId: "default-loja", usuarioId: ag4.id, produtoVariacaoId: p8.variacoes[0].id, quantidadeConsignada: 8, precoVenda: p8.custoLiquido * p8.markup }
  });
  console.log(`   💼 Maleta de Carla Oliveira pronta (11 peças consignadas)`);

  // 8. Cadastrar Carteira de Clientes
  console.log("\n8. Cadastrando Carteiras de Clientes...");

  // Cliente da Loja Principal
  await prisma.cliente.create({
    data: {
      lojaId: "default-loja",
      nome: "Fernanda Alencar (Cliente Loja)",
      whatsapp: "5511988881111",
      dataNascimento: "1990-05-15",
      observacoes: "Cliente VIP da loja física"
    }
  });

  // Cliente da Camila (Revendedora 1)
  await prisma.cliente.create({
    data: {
      lojaId: "default-loja",
      usuarioId: ag2.id,
      nome: "Juliana Mendes (Cliente Camila)",
      whatsapp: "5511977772222",
      dataNascimento: "1992-08-20",
      observacoes: "Gosta de colares delicados"
    }
  });

  // Cliente da Beatriz (Revendedora 2)
  await prisma.cliente.create({
    data: {
      lojaId: "default-loja",
      usuarioId: ag3.id,
      nome: "Mariana Costa (Cliente Beatriz)",
      whatsapp: "5511966663333",
      dataNascimento: "1988-12-10",
      observacoes: "Prefere joias em ródio negro"
    }
  });

  // Cliente da Carla (Revendedora 3)
  await prisma.cliente.create({
    data: {
      lojaId: "default-loja",
      usuarioId: ag4.id,
      nome: "Patricia Souza (Cliente Carla)",
      whatsapp: "5511955554444",
      dataNascimento: "1995-03-25",
      observacoes: "Compara sempre com promoções da coleção"
    }
  });

  console.log("   ✅ Clientes cadastrados para a Loja Principal e para cada Revendedora!");

  console.log("\n=================================================");
  console.log("🎉 SEMEADURA DOS 4 AGENTES CONCLUÍDA COM SUCESSO!");
  console.log("=================================================");
  console.log("Resumo das Credenciais:");
  console.log(`- Agente 1 (Vendedora Principal): ${ag1.email} | PIN: ${ag1.pin} | Senha: Senha123!`);
  console.log(`- Agente 2 (Revendedora 1 - Fixa 30%): ${ag2.email} | PIN: ${ag2.pin} | Senha: Senha123!`);
  console.log(`- Agente 3 (Revendedora 2 - Progressiva): ${ag3.email} | PIN: ${ag3.pin} | Senha: Senha123!`);
  console.log(`- Agente 4 (Revendedora 3 - Meta Única): ${ag4.email} | PIN: ${ag4.pin} | Senha: Senha123!`);
  console.log("=================================================\n");
}

seedAgentesTeste()
  .catch((e) => {
    console.error("❌ Erro ao semear agentes de teste:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
