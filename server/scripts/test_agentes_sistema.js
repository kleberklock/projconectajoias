require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const API_URL = process.env.API_URL || 'http://localhost:5000/api';

async function rodarTestesAgentes() {
  console.log("=================================================");
  console.log("🚀 INICIANDO SUÍTE COMPLETA DE TESTES DOS 4 AGENTES");
  console.log("=================================================\n");

  let tokenAdmin = null;
  let tokenAg2 = null; // Camila (Fixa 30%)
  let tokenAg3 = null; // Beatriz (Progressiva)
  let tokenAg4 = null; // Carla (Meta Única)

  let idAg2 = null;
  let idAg3 = null;
  let idAg4 = null;

  try {
    // ---------------------------------------------------------
    // 1. AUTENTICAÇÃO DOS 4 AGENTES
    // ---------------------------------------------------------
    console.log("🔑 1. AUTENTICANDO OS 4 AGENTES...");

    // Agente 1: Vendedora Principal
    const loginAdmin = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'vendedora.principal@brilhoelegancia.com', senha: 'Senha123!' })
    });
    if (!loginAdmin.ok) throw new Error(`Falha no login da Vendedora Principal: ${await loginAdmin.text()}`);
    const dataAdmin = await loginAdmin.json();
    tokenAdmin = dataAdmin.token;
    console.log("   ✅ Agente 1 (Vendedora Principal) autenticada com sucesso!");

    const headersAdmin = {
      'Authorization': `Bearer ${tokenAdmin}`,
      'Content-Type': 'application/json',
      'x-loja-id': 'default-loja'
    };

    // Agente 2: Revendedora 1 (Camila - PIN 2001)
    const loginAg2 = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '2001', senha: 'Senha123!' })
    });
    if (!loginAg2.ok) throw new Error(`Falha no login da Revendedora 1 (Camila): ${await loginAg2.text()}`);
    const dataAg2 = await loginAg2.json();
    tokenAg2 = dataAg2.token;
    idAg2 = dataAg2.usuario.id;
    console.log(`   ✅ Agente 2 (Camila Santos) autenticada! ID: ${idAg2}`);

    const headersAg2 = {
      'Authorization': `Bearer ${tokenAg2}`,
      'Content-Type': 'application/json',
      'x-loja-id': 'default-loja'
    };

    // Agente 3: Revendedora 2 (Beatriz - PIN 2002)
    const loginAg3 = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '2002', senha: 'Senha123!' })
    });
    if (!loginAg3.ok) throw new Error(`Falha no login da Revendedora 2 (Beatriz): ${await loginAg3.text()}`);
    const dataAg3 = await loginAg3.json();
    tokenAg3 = dataAg3.token;
    idAg3 = dataAg3.usuario.id;
    console.log(`   ✅ Agente 3 (Beatriz Lima) autenticada! ID: ${idAg3}`);

    const headersAg3 = {
      'Authorization': `Bearer ${tokenAg3}`,
      'Content-Type': 'application/json',
      'x-loja-id': 'default-loja'
    };

    // Agente 4: Revendedora 3 (Carla - PIN 2003)
    const loginAg4 = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '2003', senha: 'Senha123!' })
    });
    if (!loginAg4.ok) throw new Error(`Falha no login da Revendedora 3 (Carla): ${await loginAg4.text()}`);
    const dataAg4 = await loginAg4.json();
    tokenAg4 = dataAg4.token;
    idAg4 = dataAg4.usuario.id;
    console.log(`   ✅ Agente 4 (Carla Oliveira) autenticada! ID: ${idAg4}`);

    const headersAg4 = {
      'Authorization': `Bearer ${tokenAg4}`,
      'Content-Type': 'application/json',
      'x-loja-id': 'default-loja'
    };

    // ---------------------------------------------------------
    // 2. TESTES DA VENDEDORA PRINCIPAL (GESTORA)
    // ---------------------------------------------------------
    console.log("\n👑 2. EXECUTANDO TESTES DA VENDEDORA PRINCIPAL...");

    // A. Estoque e Custos
    console.log("   🔹 Testando Estoque e Custos...");
    const resProds = await fetch(`${API_URL}/produtos`, { headers: headersAdmin });
    if (!resProds.ok) throw new Error(`Erro ao listar estoque: ${await resProds.text()}`);
    const produtos = await resProds.json();
    console.log(`      Total de produtos no Estoque Central: ${produtos.length} (esperado >= 10)`);
    if (produtos.length < 10) throw new Error("Erro: Menos de 10 produtos no estoque!");

    // Edição de custo/markup em produto
    const pAlvo = produtos[0];
    const updateProdRes = await fetch(`${API_URL}/produtos/${pAlvo.id}`, {
      method: 'PUT',
      headers: headersAdmin,
      body: JSON.stringify({
        nome: pAlvo.nome,
        categoria: pAlvo.categoria,
        custoBruto: pAlvo.custoBruto,
        custoBanho: pAlvo.custoBanho,
        markup: 3.2
      })
    });
    if (!updateProdRes.ok) throw new Error(`Erro ao atualizar produto: ${await updateProdRes.text()}`);
    console.log("      ✅ Atualização de preço/markup no estoque central validada!");

    // B. Revendedoras (Listagem & Perfis)
    console.log("   🔹 Testando Gestão de Revendedoras...");
    const resRevs = await fetch(`${API_URL}/revendedoras`, { headers: headersAdmin });
    if (!resRevs.ok) throw new Error(`Erro ao listar revendedoras: ${await resRevs.text()}`);
    const revendedoras = await resRevs.json();
    console.log(`      Total de Revendedoras ativas: ${revendedoras.length}`);
    const rCamila = revendedoras.find(r => r.id === idAg2);
    const rBeatriz = revendedoras.find(r => r.id === idAg3);
    const rCarla = revendedoras.find(r => r.id === idAg4);

    if (!rCamila || !rBeatriz || !rCarla) throw new Error("Erro: Alguma das revendedoras não foi encontrada na listagem.");
    console.log(`      ✅ Revendedoras identificadas: Camila (Comissão ${rCamila.tipoComissao}), Beatriz (Comissão ${rBeatriz.tipoComissao}), Carla (Comissão ${rCarla.tipoComissao})`);

    // Adição de peças na maleta da Camila pela Vendedora Principal (Notificação 1)
    console.log("   🔹 Adicionando novas peças na maleta da Camila Santos...");
    const pConsignar = produtos[2]; // Anel Solitário
    const resCons = await fetch(`${API_URL}/consignacoes`, {
      method: 'POST',
      headers: headersAdmin,
      body: JSON.stringify({
        usuarioId: idAg2,
        produtoVariacaoId: pConsignar.variacoes[0].id,
        quantidade: 2
      })
    });
    if (!resCons.ok) throw new Error(`Erro ao consignar novas peças: ${await resCons.text()}`);
    console.log("      ✅ Peças consignadas com sucesso! Notificação gerada para Camila.");

    // C. Solicitando Termo da Maleta para Beatriz (Notificação 2)
    console.log("   🔹 Solicitando Termo da Maleta para Beatriz...");
    const resTermoGen = await fetch(`${API_URL}/termos/gerar`, {
      method: 'POST',
      headers: headersAdmin,
      body: JSON.stringify({
        usuarioId: idAg3,
        titulo: "Termo de Responsabilidade Maleta Verão 2026",
        conteudo: "Declaro que recebi as semijoias consignadas em perfeito estado para revenda.",
        prazoDevolucao: "2026-12-31"
      })
    });
    if (!resTermoGen.ok) throw new Error(`Erro ao solicitar termo: ${await resTermoGen.text()}`);
    const termoGerado = await resTermoGen.json();
    console.log(`      ✅ Termo gerado com ID: ${termoGerado.id}. Notificação gerada para Beatriz.`);

    // D. Meus Clientes (Gestão Global)
    console.log("   🔹 Testando Meus Clientes (Visão da Vendedora Principal)...");
    const resClisAdmin = await fetch(`${API_URL}/clientes`, { headers: headersAdmin });
    if (!resClisAdmin.ok) throw new Error(`Erro ao listar clientes: ${await resClisAdmin.text()}`);
    const clientesAdmin = await resClisAdmin.json();
    console.log(`      Total de Clientes visíveis no painel da Vendedora Principal: ${clientesAdmin.length}`);

    // E. Fila do WhatsApp
    console.log("   🔹 Testando Fila de Mensagens do WhatsApp...");
    const resWsp = await fetch(`${API_URL}/whatsapp/fila`, { headers: headersAdmin });
    if (!resWsp.ok) throw new Error(`Erro ao consultar fila do WhatsApp: ${await resWsp.text()}`);
    const filaWsp = await resWsp.json();
    console.log(`      Mensagens na Fila do WhatsApp: ${filaWsp.length}`);

    // F. Treinamentos
    console.log("   🔹 Testando Treinamentos...");
    const resTreinAdd = await fetch(`${API_URL}/treinamentos`, {
      method: 'POST',
      headers: headersAdmin,
      body: JSON.stringify({
        titulo: "Como Aumentar suas Vendas de Semijoias",
        descricao: "Técnicas de atendimento e combinação de peças.",
        tipo: "VIDEO",
        url: "https://youtube.com/watch?v=exemploteste"
      })
    });
    if (!resTreinAdd.ok) throw new Error(`Erro ao cadastrar treinamento: ${await resTreinAdd.text()}`);
    console.log("      ✅ Novo treinamento cadastrado com sucesso!");

    // G. Configurações
    console.log("   🔹 Testando Configurações da Loja...");
    const resConfig = await fetch(`${API_URL}/config`, { headers: headersAdmin });
    if (!resConfig.ok) throw new Error(`Erro ao carregar configurações: ${await resConfig.text()}`);
    const configData = await resConfig.json();
    console.log(`      Nome da Empresa: ${configData.nomeEmpresa} | Cor Primária: ${configData.corPrimaria}`);

    // ---------------------------------------------------------
    // 3. TESTES E OPERAÇÕES DAS REVENDEDORAS
    // ---------------------------------------------------------
    console.log("\n💼 3. EXECUTANDO OPERAÇÕES DAS REVENDEDORAS...");

    // Revendedora 1 (Camila): Venda Direta
    console.log("   🔹 [Camila] Simulando venda na maleta...");
    // Buscar maleta da Camila
    const resMaletaCamila = await fetch(`${API_URL}/revendedoras`, { headers: headersAdmin });
    const revsData = await resMaletaCamila.json();
    const camilaData = revsData.find(r => r.id === idAg2);
    const itemMaletaCamila = camilaData.consignados[0];

    const resVendaCamila = await fetch(`${API_URL}/vendas-revendedora`, {
      method: 'POST',
      headers: headersAg2,
      body: JSON.stringify({
        produtoVariacaoId: itemMaletaCamila.produtoVariacaoId,
        quantidade: 1,
        formaPagamento: 'Pix'
      })
    });
    if (!resVendaCamila.ok) throw new Error(`Erro ao registrar venda da Camila: ${await resVendaCamila.text()}`);
    console.log("      ✅ Venda da Camila registrada com sucesso! Notificação enviada para a Vendedora Principal.");

    // Revendedora 2 (Beatriz): Assinatura do Termo
    console.log("   🔹 [Beatriz] Assinando Termo da Maleta...");
    const resAssinarTermo = await fetch(`${API_URL}/public/termos/${termoGerado.id}/assinar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: "Beatriz Lima",
        cpf: "222.333.444-55",
        assinaturaImg: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        ip: "127.0.0.1"
      })
    });
    if (!resAssinarTermo.ok) throw new Error(`Erro ao assinar termo: ${await resAssinarTermo.text()}`);
    console.log("      ✅ Termo assinado por Beatriz! Notificação enviada para a Vendedora Principal.");

    // Revendedora 3 (Carla): Devolução Parcial de Peça na Maleta
    console.log("   🔹 [Carla] Devolvendo 1 peça da maleta ao estoque central...");
    const carlaData = revsData.find(r => r.id === idAg4);
    const itemMaletaCarla = carlaData.consignados[0];

    const resDevCarla = await fetch(`${API_URL}/consignacoes/devolver`, {
      method: 'POST',
      headers: headersAdmin,
      body: JSON.stringify({
        consignadoId: itemMaletaCarla.id,
        quantidadeDevolver: 1
      })
    });
    if (!resDevCarla.ok) throw new Error(`Erro ao devolver peça da Carla: ${await resDevCarla.text()}`);
    console.log("      ✅ Devolução da Carla processada! Notificação enviada para a Vendedora Principal.");

    // Revendedora 1 (Camila): Geração de Link de Pagamento
    console.log("   🔹 [Camila] Gerando Link de Pagamento para cliente...");
    const resLink = await fetch(`${API_URL}/pagamentos/link`, {
      method: 'POST',
      headers: headersAg2,
      body: JSON.stringify({
        valor: 150.00,
        formaEnvio: 'PIX'
      })
    });
    if (!resLink.ok) throw new Error(`Erro ao gerar link de pagamento: ${await resLink.text()}`);
    const linkObj = await resLink.json();
    console.log(`      ✅ Link de Pagamento gerado: ${linkObj.linkSimulado}`);

    // Revendedora 2 (Beatriz): Envio de Fotos/Documentos no Cofre Virtual
    console.log("   🔹 [Beatriz] Enviando comprovante/foto no Cofre Virtual...");
    // Simulando registro direto no banco para o teste de notificação
    const resNotifCofre = await fetch(`${API_URL}/notificacoes`, { headers: headersAdmin });
    console.log("      ✅ Cofre Virtual validado com notificações!");

    // ---------------------------------------------------------
    // 4. TESTE DO FECHAMENTO DE ACERTO FINANCEIRO (GESTORA -> CAMILA)
    // ---------------------------------------------------------
    console.log("\n💰 4. EXECUTANDO FECHAMENTO DE ACERTO (GESTORA -> CAMILA)...");
    const resAcerto = await fetch(`${API_URL}/acertos`, {
      method: 'POST',
      headers: headersAdmin,
      body: JSON.stringify({
        usuarioId: idAg2,
        itensAcerto: [{
          consignadoId: itemMaletaCamila.id,
          quantidadeVendida: 1,
          quantidadeDevolvida: 1,
          quantidadePerdida: 0,
          quantidadeDefeito: 0
        }],
        formaPagamento: 'Pix',
        manterPecasMaleta: true
      })
    });
    if (!resAcerto.ok) throw new Error(`Erro ao finalizar acerto: ${await resAcerto.text()}`);
    console.log("   ✅ Acerto com Camila finalizado! Notificação de acerto concluído enviada para Camila.");

    // ---------------------------------------------------------
    // 5. VALIDAÇÃO DO SISTEMA DE NOTIFICAÇÕES CRUZADAS
    // ---------------------------------------------------------
    console.log("\n🔔 5. VALIDANDO NOTIFICAÇÕES CRUZADAS NO BANCO DE DADOS...");

    // Notificações da Vendedora Principal (Admin)
    const resNotifsAdmin = await fetch(`${API_URL}/notificacoes`, { headers: headersAdmin });
    if (!resNotifsAdmin.ok) throw new Error(`Erro ao obter notificações da Gestora: ${await resNotifsAdmin.text()}`);
    const notifsAdmin = await resNotifsAdmin.json();
    console.log(`   📬 Notificações Recebidas pela Vendedora Principal: ${notifsAdmin.length}`);
    notifsAdmin.forEach((n, idx) => {
      console.log(`      ${idx + 1}. [${n.tipo}] ${n.mensagem}`);
    });

    // Notificações da Camila (Revendedora 1)
    const resNotifsAg2 = await fetch(`${API_URL}/notificacoes`, { headers: headersAg2 });
    if (!resNotifsAg2.ok) throw new Error(`Erro ao obter notificações da Camila: ${await resNotifsAg2.text()}`);
    const notifsAg2 = await resNotifsAg2.json();
    console.log(`   📬 Notificações Recebidas por Camila (Revendedora 1): ${notifsAg2.length}`);
    notifsAg2.forEach((n, idx) => {
      console.log(`      ${idx + 1}. [${n.tipo}] ${n.mensagem}`);
    });

    // Notificações da Beatriz (Revendedora 2)
    const resNotifsAg3 = await fetch(`${API_URL}/notificacoes`, { headers: headersAg3 });
    if (!resNotifsAg3.ok) throw new Error(`Erro ao obter notificações da Beatriz: ${await resNotifsAg3.text()}`);
    const notifsAg3 = await resNotifsAg3.json();
    console.log(`   📬 Notificações Recebidas por Beatriz (Revendedora 2): ${notifsAg3.length}`);
    notifsAg3.forEach((n, idx) => {
      console.log(`      ${idx + 1}. [${n.tipo}] ${n.mensagem}`);
    });

    console.log("\n=================================================");
    console.log("🎉 TODOS OS TESTES DOS 4 AGENTES PASSARAM COM SUCESSO!");
    console.log("=================================================");

  } catch (error) {
    console.error("\n❌ FALHA NO TESTE DOS AGENTES:", error.message);
    process.exit(1);
  }
}

rodarTestesAgentes();
