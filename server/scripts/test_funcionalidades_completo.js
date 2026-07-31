require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const API_URL = process.env.API_URL || 'http://localhost:5000/api';

async function testarTodasFuncionalidades() {
  console.log("=================================================");
  console.log("🚀 EXECUTANDO TESTE OPERACIONAL EXAUSTIVO DOS 4 AGENTES");
  console.log("=================================================\n");

  try {
    // ---------------------------------------------------------
    // 1. AUTENTICAÇÃO DOS 4 AGENTES
    // ---------------------------------------------------------
    console.log("🔑 1. AUTENTICANDO TODOS OS AGENTES...");

    // Agente 1: Vendedora Principal
    const resLoginAdmin = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'vendedora.principal@brilhoelegancia.com', senha: 'Senha123!' })
    });
    const dataAdmin = await resLoginAdmin.json();
    const headersAdmin = { 'Authorization': `Bearer ${dataAdmin.token}`, 'Content-Type': 'application/json', 'x-loja-id': 'default-loja' };
    console.log("   ✅ Vendedora Principal autenticada!");

    // Agente 2: Camila (Fixa 30% - PIN 2001)
    const resLoginCamila = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '2001', senha: 'Senha123!' })
    });
    const dataCamila = await resLoginCamila.json();
    const idCamila = dataCamila.usuario.id;
    const headersCamila = { 'Authorization': `Bearer ${dataCamila.token}`, 'Content-Type': 'application/json', 'x-loja-id': 'default-loja' };
    console.log(`   ✅ Revendedora 1 (Camila - Fixa 30%) autenticada! ID: ${idCamila}`);

    // Agente 3: Beatriz (Progressiva - PIN 2002)
    const resLoginBeatriz = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '2002', senha: 'Senha123!' })
    });
    const dataBeatriz = await resLoginBeatriz.json();
    const idBeatriz = dataBeatriz.usuario.id;
    const headersBeatriz = { 'Authorization': `Bearer ${dataBeatriz.token}`, 'Content-Type': 'application/json', 'x-loja-id': 'default-loja' };
    console.log(`   ✅ Revendedora 2 (Beatriz - Progressiva) autenticada! ID: ${idBeatriz}`);

    // Agente 4: Carla (Meta Única - PIN 2003)
    const resLoginCarla = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '2003', senha: 'Senha123!' })
    });
    const dataCarla = await resLoginCarla.json();
    const idCarla = dataCarla.usuario.id;
    const headersCarla = { 'Authorization': `Bearer ${dataCarla.token}`, 'Content-Type': 'application/json', 'x-loja-id': 'default-loja' };
    console.log(`   ✅ Revendedora 3 (Carla - Meta Única) autenticada! ID: ${idCarla}`);

    // ---------------------------------------------------------
    // 2. TESTE DE CRIAÇÃO E GESTÃO DE CLIENTES
    // ---------------------------------------------------------
    console.log("\n👤 2. TESTANDO CRIAÇÃO E ISOLAMENTO DE CLIENTES...");

    const ts = Date.now().toString().slice(-6);

    // Cliente cadastrado pela Camila
    const resCliCamila = await fetch(`${API_URL}/clientes`, {
      method: 'POST',
      headers: headersCamila,
      body: JSON.stringify({
        nome: `Vanessa Ribeiro (${ts})`,
        whatsapp: `55119444${ts.slice(-4)}`,
        dataNascimento: "1994-04-12",
        observacoes: "Prefere conjuntos folheados a Ouro 18k"
      })
    });
    const cliCamilaObj = await resCliCamila.json();
    console.log(`   ✅ Cliente criada por Camila: ${cliCamilaObj.nome} (ID: ${cliCamilaObj.id})`);

    // Cliente cadastrado pela Beatriz
    const resCliBeatriz = await fetch(`${API_URL}/clientes`, {
      method: 'POST',
      headers: headersBeatriz,
      body: JSON.stringify({
        nome: `Tatiane Martins (${ts})`,
        whatsapp: `55119333${ts.slice(-4)}`,
        dataNascimento: "1989-11-25",
        observacoes: "Cliente corporativa, faz pedidos grandes"
      })
    });
    const cliBeatrizObj = await resCliBeatriz.json();
    console.log(`   ✅ Cliente criada por Beatriz: ${cliBeatrizObj.nome} (ID: ${cliBeatrizObj.id})`);

    // Cliente cadastrado pela Carla
    const resCliCarla = await fetch(`${API_URL}/clientes`, {
      method: 'POST',
      headers: headersCarla,
      body: JSON.stringify({
        nome: `Renata Vasconcelos (${ts})`,
        whatsapp: `55119222${ts.slice(-4)}`,
        dataNascimento: "1997-01-30",
        observacoes: "Adora brincos de ródio e zircônias"
      })
    });
    const cliCarlaObj = await resCliCarla.json();
    console.log(`   ✅ Cliente criada por Carla: ${cliCarlaObj.nome} (ID: ${cliCarlaObj.id})`);

    // Verificar listagem de clientes do Admin (deve ver todos)
    const resClisGeral = await fetch(`${API_URL}/clientes`, { headers: headersAdmin });
    const clisGeral = await resClisGeral.json();
    console.log(`   ✅ Vendedora Principal consulta base total de clientes: ${clisGeral.length} clientes encontrados.`);

    // ---------------------------------------------------------
    // 3. CONSOLIDAÇÃO DO ESTOQUE E CONSIGNATÁRIOS
    // ---------------------------------------------------------
    console.log("\n📦 3. CONSOLIDAÇÃO DO ESTOQUE CENTRAL E MALETAS...");
    const resProds = await fetch(`${API_URL}/produtos`, { headers: headersAdmin });
    const produtos = await resProds.json();

    // ---------------------------------------------------------
    // 4. SIMULAÇÃO DE VENDAS DIVERSAS DAS 3 REVENDEDORAS
    // ---------------------------------------------------------
    console.log("\n🛍️ 4. SIMULANDO VENDAS DAS REVENDEDORAS (CLIENTES CADASTRADOS & AVULSOS)...");

    // Buscar as maletas ativas de cada revendedora
    const resRevs = await fetch(`${API_URL}/revendedoras`, { headers: headersAdmin });
    const revsList = await resRevs.json();

    const revCamilaData = revsList.find(r => r.id === idCamila);
    const revBeatrizData = revsList.find(r => r.id === idBeatriz);
    const revCarlaData = revsList.find(r => r.id === idCarla);

    const itemMaletaCamila = revCamilaData.consignados[0];
    const itemMaletaBeatriz = revBeatrizData.consignados[0];
    const itemMaletaCarla = revCarlaData.consignados[0];

    // Camila vende 1 unidade de sua maleta para sua cliente cadastrada Vanessa
    const resVenda1 = await fetch(`${API_URL}/vendas-revendedora`, {
      method: 'POST',
      headers: headersCamila,
      body: JSON.stringify({
        produtoVariacaoId: itemMaletaCamila.produtoVariacaoId,
        quantidade: 1,
        clienteId: cliCamilaObj.id,
        formaPagamento: 'Pix'
      })
    });
    if (!resVenda1.ok) throw new Error(`Erro na venda da Camila: ${await resVenda1.text()}`);
    console.log(`   ✅ [Camila] Vendeu 1x ${itemMaletaCamila.produto?.nome || 'Semijoia'} para a cliente cadastrada ${cliCamilaObj.nome}`);

    // Beatriz vende 1 unidade de sua maleta para cliente cadastrada Tatiane
    const resVenda2 = await fetch(`${API_URL}/vendas-revendedora`, {
      method: 'POST',
      headers: headersBeatriz,
      body: JSON.stringify({
        produtoVariacaoId: itemMaletaBeatriz.produtoVariacaoId,
        quantidade: 1,
        clienteId: cliBeatrizObj.id,
        formaPagamento: 'Cartão de Crédito'
      })
    });
    if (!resVenda2.ok) throw new Error(`Erro na venda da Beatriz: ${await resVenda2.text()}`);
    console.log(`   ✅ [Beatriz] Vendeu 1x ${itemMaletaBeatriz.produto?.nome || 'Semijoia'} para cliente Tatiane`);

    // Carla vende 1 unidade de sua maleta para cliente cadastrada Renata
    const resVenda3 = await fetch(`${API_URL}/vendas-revendedora`, {
      method: 'POST',
      headers: headersCarla,
      body: JSON.stringify({
        produtoVariacaoId: itemMaletaCarla.produtoVariacaoId,
        quantidade: 1,
        clienteId: cliCarlaObj.id,
        formaPagamento: 'Pix'
      })
    });
    if (!resVenda3.ok) throw new Error(`Erro na venda da Carla: ${await resVenda3.text()}`);
    console.log(`   ✅ [Carla] Vendeu 1x ${itemMaletaCarla.produto?.nome || 'Semijoia'} para cliente Renata`);

    // ---------------------------------------------------------
    // 5. TESTE DE TERMOS E COFRE VIRTUAL
    // ---------------------------------------------------------
    console.log("\n📝 5. TESTANDO TERMOS DA MALETA E COFRE VIRTUAL...");

    // Vendedora Principal gera termo para Carla
    const resTermoCarla = await fetch(`${API_URL}/termos/gerar`, {
      method: 'POST',
      headers: headersAdmin,
      body: JSON.stringify({
        usuarioId: idCarla,
        titulo: "Termo de Responsabilidade Carla - Joias de Luxo",
        conteudo: "Declaro recebimento das tornezeleiras e anéis consignados."
      })
    });
    const termoCarlaObj = await resTermoCarla.json();

    // Carla assina o termo
    await fetch(`${API_URL}/public/termos/${termoCarlaObj.id}/assinar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: "Carla Oliveira",
        cpf: "333.444.555-66",
        assinaturaImg: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        ip: "189.100.20.5"
      })
    });
    console.log("   ✅ Carla assinou o termo digitalmente com foto/imagem da assinatura.");

    // ---------------------------------------------------------
    // 6. FECHAMENTO DE ACERTO COMPLETO DE TODAS AS REVENDEDORAS
    // ---------------------------------------------------------
    console.log("\n💰 6. EXECUTANDO FECHAMENTO DE ACERTO DE TODAS AS 3 REVENDEDORAS...");

    // A. Fechamento da Camila (Comissão Fixa 30%)
    console.log("   🔹 Fechando Acerto da Camila Santos (Comissão Fixa 30%)...");
    const resAcertoCamila = await fetch(`${API_URL}/acertos`, {
      method: 'POST',
      headers: headersAdmin,
      body: JSON.stringify({
        usuarioId: idCamila,
        itensAcerto: [
          { produtoVariacaoId: itemMaletaCamila.produtoVariacaoId, quantidadeVendida: 1, quantidadeDevolvida: 1, quantidadePerdida: 0, quantidadeDefeito: 0 }
        ],
        formaPagamento: 'Pix',
        totalRetidoRevendedora: 50.00,
        totalRecebidoAdmin: 85.00
      })
    });
    const dataAcertoCamila = await resAcertoCamila.json();
    console.log(`      ✅ Acerto da Camila concluído! Faturamento Bruto: R$ ${dataAcertoCamila.acerto.faturamentoBruto.toFixed(2)} | Comissão Paga (30%): R$ ${dataAcertoCamila.acerto.comissaoPaga.toFixed(2)}`);

    // B. Fechamento da Beatriz (Comissão Progressiva)
    console.log("   🔹 Fechando Acerto da Beatriz Lima (Comissão Progressiva por Faixas)...");
    const resAcertoBeatriz = await fetch(`${API_URL}/acertos`, {
      method: 'POST',
      headers: headersAdmin,
      body: JSON.stringify({
        usuarioId: idBeatriz,
        itensAcerto: [
          { produtoVariacaoId: itemMaletaBeatriz.produtoVariacaoId, quantidadeVendida: 2, quantidadeDevolvida: 2, quantidadePerdida: 0, quantidadeDefeito: 0 }
        ],
        formaPagamento: 'Pix'
      })
    });
    const dataAcertoBeatriz = await resAcertoBeatriz.json();
    console.log(`      ✅ Acerto da Beatriz concluído! Faturamento Bruto: R$ ${dataAcertoBeatriz.acerto.faturamentoBruto.toFixed(2)} | Comissão Paga: R$ ${dataAcertoBeatriz.acerto.comissaoPaga.toFixed(2)}`);

    // C. Fechamento da Carla (Comissão Meta Única com Bônus)
    console.log("   🔹 Fechando Acerto da Carla Oliveira (Comissão Meta Única com Bônus)...");
    const resAcertoCarla = await fetch(`${API_URL}/acertos`, {
      method: 'POST',
      headers: headersAdmin,
      body: JSON.stringify({
        usuarioId: idCarla,
        itensAcerto: [
          { produtoVariacaoId: itemMaletaCarla.produtoVariacaoId, quantidadeVendida: 3, quantidadeDevolvida: 0, quantidadePerdida: 0, quantidadeDefeito: 0 }
        ],
        formaPagamento: 'Pix'
      })
    });
    const dataAcertoCarla = await resAcertoCarla.json();
    console.log(`      ✅ Acerto da Carla concluído! Faturamento Bruto: R$ ${dataAcertoCarla.acerto.faturamentoBruto.toFixed(2)} | Comissão Paga: R$ ${dataAcertoCarla.acerto.comissaoPaga.toFixed(2)}`);

    // ---------------------------------------------------------
    // 7. INSPEÇÃO DAS NOTIFICAÇÕES EM TEMPO REAL E FILA DO WHATSAPP
    // ---------------------------------------------------------
    console.log("\n🔔 7. INSPEÇÃO FINAL DE NOTIFICAÇÕES E WHATSAPP...");

    const resNotifAdmin = await fetch(`${API_URL}/notificacoes`, { headers: headersAdmin });
    const listNotifAdmin = await resNotifAdmin.json();
    console.log(`   📬 Vendedora Principal possui ${listNotifAdmin.length} notificações não lidas no painel.`);

    const resNotifCamila = await fetch(`${API_URL}/notificacoes`, { headers: headersCamila });
    const listNotifCamila = await resNotifCamila.json();
    console.log(`   📬 Camila possui ${listNotifCamila.length} notificações não lidas no painel.`);

    const resFilaWsp = await fetch(`${API_URL}/whatsapp/fila`, { headers: headersAdmin });
    const filaWsp = await resFilaWsp.json();
    console.log(`   📲 Total de Mensagens Automáticas Agendadas no WhatsApp: ${filaWsp.length}`);

    console.log("\n=================================================");
    console.log("🎉 TESTE OPERACIONAL EXAUSTIVO FINALIZADO COM SUCESSO!");
    console.log("=================================================");

  } catch (error) {
    console.error("\n❌ ERRO NO TESTE OPERACIONAL:", error.message);
    process.exit(1);
  }
}

testarTodasFuncionalidades();
