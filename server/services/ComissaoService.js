// server/services/ComissaoService.js

class ComissaoService {
  /**
   * Calcula a comissão final paga à revendedora
   * @param {Object} revendedora - Instância do usuário revendedora
   * @param {number} faturamentoBruto - Faturamento bruto das vendas do acerto
   * @param {number} faturamentoVolumeAcumulado - Faturamento do mês (para progressiva/metas)
   * @param {number} valorDescontoPerda - Total descontado por perdas de peças
   * @param {number} custoTotalPecasVendidas - Custo total das peças vendidas (custoBruto + custoBanho + custoLiquido)
   * @returns {Object} { percentualComissao, comissaoBruta, comissaoPaga, liquidoConectaJoias }
   */
  calcularComissao(revendedora, faturamentoBruto, faturamentoVolumeAcumulado, valorDescontoPerda, custoTotalPecasVendidas = 0) {
    // Se a base for LÍQUIDO, a comissão incide sobre a Margem Líquida Real (Faturamento - Custo das Peças - Perdas)
    const valorBaseComissao = (revendedora.baseCalculo === 'LIQUIDO')
      ? Math.max(0, faturamentoBruto - custoTotalPecasVendidas - valorDescontoPerda)
      : faturamentoBruto;

    let percentualComissao = revendedora.comissao;
    let comissaoBruta = 0;
    // O bônus fixo (META_UNICA com FIXO) é separado da comissaoBruta para que
    // nunca seja engolido pelo max(0,...) que clipa as perdas no modo BRUTO.
    // Ele é somado DEPOIS da clipagem, garantindo que seja sempre pago se a meta foi atingida.
    let bonusFixo = 0;

    if (revendedora.tipoComissao === 'PROGRESSIVA') {
      const faixas = (revendedora.faixasComissao && revendedora.faixasComissao.length > 0)
        ? revendedora.faixasComissao
        : (revendedora.loja && revendedora.loja.faixasComissao ? revendedora.loja.faixasComissao : []);

      const faixasOrdenadas = faixas && faixas.length > 0 ? [...faixas].sort((a, b) => a.valorMin - b.valorMin) : [];
      const faixa = this.encontrarFaixaComissao(faturamentoVolumeAcumulado, faixasOrdenadas);
      if (faixasOrdenadas.length > 0) {
        percentualComissao = faixa ? faixa.percentual : (faturamentoVolumeAcumulado >= faixasOrdenadas[0].valorMin ? faixasOrdenadas[0].percentual : 0);
      } else {
        percentualComissao = revendedora.comissao || 30;
      }
      comissaoBruta = valorBaseComissao * (percentualComissao / 100);

    } else if (revendedora.tipoComissao === 'META_UNICA') {
      const atingiuMeta = faturamentoVolumeAcumulado >= (revendedora.metaUnicaValor || 0);
      if (atingiuMeta) {
        if (revendedora.metaUnicaTipoBonus === 'PERCENTUAL') {
          // Bônus percentual: soma ao percentual base, incide sobre toda a base
          percentualComissao = revendedora.comissao + (revendedora.metaUnicaBonus || 0);
          comissaoBruta = valorBaseComissao * (percentualComissao / 100);
        } else {
          // Bônus fixo em dinheiro: mantido separado para não ser clipado pelas perdas
          percentualComissao = revendedora.comissao;
          comissaoBruta = valorBaseComissao * (percentualComissao / 100);
          bonusFixo = revendedora.metaUnicaBonus || 0;
        }
      } else {
        percentualComissao = revendedora.comissao;
        comissaoBruta = valorBaseComissao * (percentualComissao / 100);
      }
    } else { // FIXA
      percentualComissao = revendedora.comissao;
      comissaoBruta = valorBaseComissao * (percentualComissao / 100);
    }

    // No modo BRUTO: desconta a perda da comissão percentual, depois soma o bônus fixo.
    // No modo LIQUIDO: a perda já foi subtraída da base de cálculo; apenas clipa em zero e soma o bônus.
    // O bonusFixo é sempre somado APÓS o max(0,...) para não ser engolido por perdas grandes.
    const comissaoPercentualLiquida = (revendedora.baseCalculo === 'LIQUIDO')
      ? Math.max(0, comissaoBruta)
      : Math.max(0, comissaoBruta - valorDescontoPerda);
    const comissaoPaga = comissaoPercentualLiquida + bonusFixo;
    const liquidoConectaJoias = faturamentoBruto - comissaoPaga;

    return {
      percentualComissao,
      comissaoBruta,
      comissaoPaga,
      liquidoConectaJoias
    };
  }

  encontrarFaixaComissao(faturamentoBruto, faixas) {
    if (!faixas || faixas.length === 0) return null;
    // Ordena faixas por valor mínimo para garantir a verificação correta
    const faixasOrdenadas = [...faixas].sort((a, b) => a.valorMin - b.valorMin);
    
    let faixaSelecionada = null;
    for (const f of faixasOrdenadas) {
      if (faturamentoBruto >= f.valorMin) {
        faixaSelecionada = f;
      }
    }
    return faixaSelecionada;
  }

  /**
   * Recalcula retroativamente a comissão de todas as vendas do ciclo em aberto de uma revendedora
   * @param {Object} prismaClient - Cliente do Prisma ou transação
   * @param {string} usuarioId - ID da revendedora
   * @param {string} lojaId - ID da loja
   * @returns {Promise<Object>} { percentualAplicado, totalVendasRecalculadas, faturamentoTotalCiclo }
   */
  async recalcularVendasCicloEmAberto(prismaClient, usuarioId, lojaId) {
    try {
      const revendedora = await prismaClient.usuario.findFirst({
        where: { id: usuarioId, lojaId },
        include: { faixasComissao: true, loja: { include: { faixasComissao: true } } }
      });
      if (!revendedora) return { percentualAplicado: 0, totalVendasRecalculadas: 0, faturamentoTotalCiclo: 0 };

      const ultimoAcerto = await prismaClient.historicoAcerto.findFirst({
        where: { usuarioId, lojaId },
        orderBy: { data: 'desc' }
      });
      const dataInicioCiclo = ultimoAcerto ? new Date(ultimoAcerto.data) : new Date(0);

      const vendasCiclo = await prismaClient.vendaRevendedora.findMany({
        where: {
          usuarioId,
          lojaId,
          data: { gt: dataInicioCiclo }
        }
      });

      const faturamentoTotalCiclo = vendasCiclo.reduce((sum, v) => sum + (Number(v.precoVenda || 0) * Number(v.quantidade || 0)), 0);

      // Determina o volume de faturamento para enquadramento em faixa/meta,
      // respeitando o periodoAcumulo — idêntico ao que o acerto final já faz.
      let faturamentoVolumeParaFaixa = faturamentoTotalCiclo;
      if (revendedora.periodoAcumulo === 'MENSAL') {
        const agora = new Date();
        const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0, 0);
        const vendasMes = await prismaClient.vendaRevendedora.findMany({
          where: {
            usuarioId,
            lojaId,
            data: { gte: inicioMes }
          }
        });
        const faturamentoMes = vendasMes.reduce((sum, v) => sum + (Number(v.precoVenda || 0) * Number(v.quantidade || 0)), 0);
        // Usa o maior entre o volume do mês e o do ciclo para não sub-enquadrar
        if (faturamentoMes > faturamentoVolumeParaFaixa) {
          faturamentoVolumeParaFaixa = faturamentoMes;
        }
      }

      // Busca os produtos das vendas para somar o Custo Total das peças vendidas no ciclo
      const produtosLoja = await prismaClient.produto.findMany({ where: { lojaId } });
      const produtosMap = new Map(produtosLoja.map(p => [p.id, p]));

      let custoTotalPecasCiclo = 0;
      for (const v of vendasCiclo) {
        const p = produtosMap.get(v.produtoId);
        const custoUnitario = p ? ((p.custoBruto || 0) + (p.custoBanho || 0) + (p.custoLiquido || 0)) : 0;
        custoTotalPecasCiclo += custoUnitario * Number(v.quantidade || 0);
      }

      const calc = this.calcularComissao(revendedora, faturamentoTotalCiclo, faturamentoVolumeParaFaixa, 0, custoTotalPecasCiclo);
      const percentualAplicado = calc.percentualComissao;

      // Atualiza retroativamente todas as vendas do ciclo em aberto
      for (const venda of vendasCiclo) {
        const valorTotalVenda = Number(venda.precoVenda || 0) * Number(venda.quantidade || 0);
        const novaComissao = valorTotalVenda * (percentualAplicado / 100);

        if (Math.abs(venda.comissaoValor - novaComissao) > 0.001) {
          await prismaClient.vendaRevendedora.update({
            where: { id: venda.id },
            data: { comissaoValor: novaComissao }
          });
        }
      }

      return {
        percentualAplicado,
        totalVendasRecalculadas: vendasCiclo.length,
        faturamentoTotalCiclo
      };
    } catch (err) {
      console.error("Erro ao recalcular vendas do ciclo em aberto:", err);
      return { percentualAplicado: 0, totalVendasRecalculadas: 0, faturamentoTotalCiclo: 0 };
    }
  }
}

module.exports = new ComissaoService();

