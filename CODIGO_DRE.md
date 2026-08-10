# Código-Fonte do Módulo DRE (Demonstração do Resultado do Exercício)
Projeto: Conecta Joias

---

## 1. Schema do Banco de Dados (Prisma ORM - server/schema.prisma)
Modelos envolvidos na apuração financeira do DRE:

```prisma
model VendaDireta {
  id              String   @id @default(uuid())
  lojaId          String   @default("default-loja")
  loja            Loja     @relation(fields: [lojaId], references: [id], onDelete: Cascade)
  data            DateTime @default(now())
  codigo          String
  nome            String
  quantidade      Int      @default(1)
  preco           Float
  clienteId       String?
  cliente         Cliente? @relation(fields: [clienteId], references: [id])
  desconto        Float    @default(0.0)
  motivoDesconto  String?
  formaPagamento  String?  @default("Pix")

  @@index([lojaId])
  @@index([data])
}

model HistoricoAcerto {
  id                 String   @id @default(uuid())
  lojaId             String   @default("default-loja")
  usuarioId          String
  data               DateTime @default(now())
  totalDevolvida     Int
  totalPerdida       Int      @default(0)
  totalDefeito       Int      @default(0)
  faturamentoBruto   Float
  valorDescontoPerda Float    @default(0.0)
  comissaoPaga       Float
  liquidoConectaJoias Float
  formaPagamento     String?  @default("Pix")

  @@index([lojaId])
  @@index([usuarioId])
  @@index([data])
}

model VendaRevendedora {
  id              String   @id @default(uuid())
  lojaId          String   @default("default-loja")
  data            DateTime @default(now())
  usuarioId       String
  produtoId       String
  codigoProduto   String
  quantidade      Int
  precoVenda      Float
  comissaoValor   Float
  
  @@index([lojaId])
  @@index([data])
}

model Produto {
  id           String   @id @default(uuid())
  lojaId       String   @default("default-loja")
  codigo       String
  nome         String
  custoBruto   Float    @default(0.0)
  custoBanho   Float    @default(0.0)
  custoLiquido Float    @default(0.0)
  markup       Float    @default(3.0)
}
```

---

## 2. Backend Node.js / Express (server/server.js)
Rota GET `/api/relatorios/dre` responsável pelo cálculo do DRE:

```javascript
// Relatório DRE Simplificado (Admin)
app.get('/api/relatorios/dre', autenticarJWT, autorizarRole(['Manager', 'SuperAdmin']), identificarLoja, async (req, res) => {
  const { inicio, fim } = req.query;
  const cmvEstimado = parseFloat(req.query.cmvEstimado) || 33.0;

  try {
    let dataInicio = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    if (inicio && inicio !== 'undefined' && inicio !== 'null' && inicio.trim() !== '') {
      const parsedInicio = new Date(inicio);
      if (!isNaN(parsedInicio.getTime())) {
        dataInicio = parsedInicio;
      }
    }

    let dataFim = new Date();
    if (fim && fim !== 'undefined' && fim !== 'null' && fim.trim() !== '') {
      const parsedFim = new Date(fim);
      if (!isNaN(parsedFim.getTime())) {
        dataFim = parsedFim;
      }
    }
    dataFim.setHours(23, 59, 59, 999);

    const vendasDiretas = await prisma.vendaDireta.findMany({
      where: { lojaId: req.lojaId, data: { gte: dataInicio, lte: dataFim } }
    });

    const acertos = await prisma.historicoAcerto.findMany({
      where: { lojaId: req.lojaId, data: { gte: dataInicio, lte: dataFim } }
    });

    const vendasRevendedora = await prisma.vendaRevendedora.findMany({
      where: { lojaId: req.lojaId, data: { gte: dataInicio, lte: dataFim } }
    });

    const produtos = await prisma.produto.findMany({ where: { lojaId: req.lojaId } });
    const produtosMap = new Map(produtos.map(p => [p.codigo, p]));
    const produtosIdMap = new Map(produtos.map(p => [p.id, p]));

    let faturamentoVendasDiretas = 0;
    let custoVendasDiretas = 0;
    vendasDiretas.forEach(v => {
      faturamentoVendasDiretas += v.preco;
      const qtdItem = v.quantidade || 1;
      const prod = produtosMap.get(v.codigo);
      const custoReal = prod ? (prod.custoBruto + prod.custoBanho + prod.custoLiquido) : 0;
      custoVendasDiretas += (custoReal > 0) ? (custoReal * qtdItem) : (v.preco * (cmvEstimado / 100));
    });

    let faturamentoAcertos = 0;
    let comissoesPagas = 0;
    let descontoPerdas = 0;
    acertos.forEach(a => {
      faturamentoAcertos += a.faturamentoBruto;
      comissoesPagas += a.comissaoPaga;
      descontoPerdas += a.valorDescontoPerda;
    });

    let faturamentoVendasRevendedora = 0;
    let comissoesVendasRevendedora = 0;
    let custoVendasConsignado = 0;

    vendasRevendedora.forEach(vr => {
      const qtd = vr.quantidade || 1;
      faturamentoVendasRevendedora += (vr.precoVenda * qtd);
      comissoesVendasRevendedora += (vr.comissaoValor || 0);

      const prod = produtosIdMap.get(vr.produtoId) || produtosMap.get(vr.codigoProduto);
      const custoReal = prod ? (prod.custoBruto + prod.custoBanho + prod.custoLiquido) : 0;
      custoVendasConsignado += (custoReal > 0) ? (custoReal * qtd) : (vr.precoVenda * (cmvEstimado / 100) * qtd);
    });

    if (custoVendasConsignado === 0 && faturamentoAcertos > 0) {
      custoVendasConsignado = faturamentoAcertos * (cmvEstimado / 100);
    }

    const faturamentoBrutoTotal = faturamentoVendasDiretas + faturamentoAcertos + faturamentoVendasRevendedora;
    const comissoesTotais = comissoesPagas + comissoesVendasRevendedora;
    const custoTotalMercadorias = custoVendasDiretas + custoVendasConsignado;

    const lucroLiquidoEstimado = faturamentoBrutoTotal - comissoesTotais - custoTotalMercadorias + descontoPerdas;
    const markupMedioReal = custoTotalMercadorias > 0 ? (faturamentoBrutoTotal / custoTotalMercadorias) : 3.0;
    const margemLucroReal = faturamentoBrutoTotal > 0 ? ((lucroLiquidoEstimado / faturamentoBrutoTotal) * 100) : 0.0;

    res.json({
      periodo: { inicio: dataInicio, fim: dataFim },
      resumo: {
        faturamentoVendasDiretas,
        faturamentoAcertos,
        faturamentoVendasRevendedora,
        faturamentoBrutoTotal,
        comissoesPagas,
        comissoesVendasRevendedora,
        comissoesTotais,
        descontoPerdas,
        impostos: 0,
        custoVendasDiretas,
        custoVendasConsignado,
        custoTotalMercadorias,
        despesasFixas: 0,
        lucroLiquidoEstimado,
        markupMedioReal,
        margemLucroReal
      }
    });
  } catch (error) {
    console.error("Erro ao gerar DRE:", error);
    res.status(500).json({ error: 'Erro ao gerar o relatório DRE.' });
  }
});
```

---

## 3. Frontend JavaScript (frontend/js/app.js)

```javascript
  gerarDRELocal: function(inicio, fim) {
    this.renderizarDadosDRE({
      faturamentoVendasDiretas: 0,
      faturamentoAcertos: 0,
      faturamentoVendasRevendedora: 0,
      faturamentoBrutoTotal: 0,
      comissoesPagas: 0,
      comissoesVendasRevendedora: 0,
      comissoesTotais: 0,
      descontoPerdas: 0,
      impostos: 0,
      custoVendasDiretas: 0,
      custoVendasConsignado: 0,
      custoTotalMercadorias: 0,
      despesasFixas: 0,
      lucroLiquidoEstimado: 0
    });
  },

  renderizarDadosDRE: function(resumo) {
    const formatar = (val) => `R$ ${val.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    const fatBrutoEl = document.getElementById("dre-fat-bruto");
    const fatDiretasEl = document.getElementById("dre-fat-diretas");
    const fatConsignadoEl = document.getElementById("dre-fat-consignado");
    const fatRevendedorasEl = document.getElementById("dre-fat-revendedoras");

    const comissoesEl = document.getElementById("dre-comissoes");
    const comissoesAcertosEl = document.getElementById("dre-comissoes-acertos");
    const comissoesRevendedorasEl = document.getElementById("dre-comissoes-revendedoras");
    const perdasEl = document.getElementById("dre-perdas-ajuste");
    const impostosEl = document.getElementById("dre-impostos");

    const recLiquidaEl = document.getElementById("dre-receita-liquida");
    const cmvEl = document.getElementById("dre-cmv");
    const custoDiretasEl = document.getElementById("dre-custo-diretas");
    const custoConsignadoEl = document.getElementById("dre-custo-consignado");
    const despesasFixasEl = document.getElementById("dre-despesas-fixas");

    const fatDiretas = resumo.faturamentoVendasDiretas || 0;
    const fatAcertos = resumo.faturamentoAcertos || 0;
    const fatRevendedoras = resumo.faturamentoVendasRevendedora || 0;
    const fatBrutoTotal = resumo.faturamentoBrutoTotal || (fatDiretas + fatAcertos + fatRevendedoras);

    const comissoesAcertos = resumo.comissoesPagas || 0;
    const comissoesRevendedoras = resumo.comissoesVendasRevendedora || 0;
    const comissoesTotais = resumo.comissoesTotais || (comissoesAcertos + comissoesRevendedoras);

    const descontoPerdas = resumo.descontoPerdas || 0;
    const impostos = resumo.impostos || 0;
    const despesasFixas = resumo.despesasFixas || 0;

    const custoDiretas = resumo.custoVendasDiretas || 0;
    const custoConsignado = resumo.custoVendasConsignado || 0;
    const custoTotalMercadorias = resumo.custoTotalMercadorias || (custoDiretas + custoConsignado);

    if (fatBrutoEl) fatBrutoEl.innerText = formatar(fatBrutoTotal);
    if (fatDiretasEl) fatDiretasEl.innerText = formatar(fatDiretas);
    if (fatConsignadoEl) fatConsignadoEl.innerText = formatar(fatAcertos);
    if (fatRevendedorasEl) fatRevendedorasEl.innerText = formatar(fatRevendedoras);

    if (comissoesEl) comissoesEl.innerText = `(-) ${formatar(comissoesTotais)}`;
    if (comissoesAcertosEl) comissoesAcertosEl.innerText = formatar(comissoesAcertos);
    if (comissoesRevendedorasEl) comissoesRevendedorasEl.innerText = formatar(comissoesRevendedoras);
    if (perdasEl) perdasEl.innerText = `(+) ${formatar(descontoPerdas)}`;
    if (impostosEl) impostosEl.innerText = `(-) ${formatar(impostos)}`;

    const receitaLiquida = fatBrutoTotal - comissoesTotais + descontoPerdas - impostos;
    if (recLiquidaEl) recLiquidaEl.innerText = formatar(receitaLiquida);

    if (cmvEl) cmvEl.innerText = `(-) ${formatar(custoTotalMercadorias)}`;
    if (custoDiretasEl) custoDiretasEl.innerText = formatar(custoDiretas);
    if (custoConsignadoEl) custoConsignadoEl.innerText = formatar(custoConsignado);
    if (despesasFixasEl) despesasFixasEl.innerText = `(-) ${formatar(despesasFixas)}`;

    const lucro = resumo.lucroLiquidoEstimado !== undefined ? resumo.lucroLiquidoEstimado : (receitaLiquida - custoTotalMercadorias - despesasFixas);
    const lucroEl = document.getElementById("dre-lucro-liquido");
    const resultadoValorEl = document.getElementById("dre-resultado-valor");
    const resultadoStatusEl = document.getElementById("dre-resultado-status");
    const lucroRow = document.getElementById("dre-lucro-row");

    if (lucroEl) lucroEl.innerText = formatar(lucro);
    if (resultadoValorEl) resultadoValorEl.innerText = formatar(lucro);
  }
```
