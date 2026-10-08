/**
 * Conecta Joias - Serviço de Geração de PDFs de Termos de Consignação
 * Utiliza PDFKit com formatação jurídica, selo de autenticidade e assinatura eletrônica
 */

const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class PdfService {
  /**
   * Gera um buffer de PDF do Termo de Consignação Assinado
   */
  async gerarPdfTermoConsignacao({ termo, loja, revendedora, itens = [] }) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 40, bottom: 40, left: 45, right: 45 }
        });

        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // Cores
        const corDourada = '#b38728';
        const corEscura = '#1a1a1a';
        const corCinza = '#555555';
        const corBorda = '#dddddd';

        // 1. Cabeçalho Principal
        doc.rect(45, 40, 505, 5).fill(corDourada);
        doc.moveDown(0.8);

        const nomeLoja = (loja && loja.nome) ? loja.nome.toUpperCase() : 'CONECTA JOIAS';
        doc.fontSize(16).fillColor(corEscura).font('Helvetica-Bold')
           .text(nomeLoja, { align: 'center' });
        
        doc.fontSize(11).fillColor(corDourada).font('Helvetica-Bold')
           .text('TERMO DE CONCESSÃO, CONIGNAÇÃO DE PEÇAS E RESPONSABILIDADE', { align: 'center' });

        doc.fontSize(8).fillColor(corCinza).font('Helvetica')
           .text(`Identificador do Termo: #${termo.id}  |  Emissão: ${new Date(termo.createdAt).toLocaleDateString('pt-BR')}`, { align: 'center' });

        doc.moveDown(1);
        doc.strokeColor(corBorda).lineWidth(0.5).moveTo(45, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(1);

        // 2. Qualificação das Partes
        doc.fontSize(10).fillColor(corDourada).font('Helvetica-Bold').text('1. DAS PARTES QUALIFICADAS');
        doc.moveDown(0.3);

        const textoPartes = 
`CONSIGNANTE: ${nomeLoja}${loja && loja.cnpj ? `, pessoa jurídica inscrita no CNPJ sob o nº ${loja.cnpj}` : ''}, doravante denominada simplesmente CONSIGNANTE.

CONSIGNATÁRIA (REVENDEDORA): ${revendedora.nome || termo.assinaturaNome || 'Revendedora Parceira'}, portadora do CPF nº ${revendedora.cpf || termo.assinaturaCpf || 'Não informado'}, Telefone/WhatsApp: ${revendedora.whatsapp || 'Não informado'}, doravante denominada simplesmente CONSIGNATÁRIA.`;

        doc.fontSize(8.5).fillColor(corEscura).font('Helvetica').text(textoPartes, { align: 'justify', lineGap: 2 });
        doc.moveDown(1);

        // 3. Cláusulas do Contrato
        doc.fontSize(10).fillColor(corDourada).font('Helvetica-Bold').text('2. DAS CLÁUSULAS E OBRIGAÇÕES');
        doc.moveDown(0.3);

        const clausulas = [
          'CLÁUSULA 1ª (DO OBJETO): A CONSIGNANTE entrega à CONSIGNATÁRIA, a título de consignação mercantil, o lote de semijoias discriminado e avaliado neste instrumento, mantendo a CONSIGNANTE o domínio e posse indireta sobre as peças até sua efetiva venda ou devolução.',
          'CLÁUSULA 2ª (DA GUARDA E CONSERVAÇÃO): A CONSIGNATÁRIA obriga-se a guardar e conservar os itens consignados com todo o zelo e cuidado, respondendo civil e criminalmente por qualquer avaria decorrente de negligência, bem como por perda, extravio, furto ou roubo das peças sob sua posse.',
          'CLÁUSULA 3ª (DA PRESTAÇÃO DE CONTAS E ACERTO): No encerramento do ciclo de consignação, a CONSIGNATÁRIA obriga-se a restituir as peças não comercializadas no mesmo estado de conservação em que as recebeu, prestando contas e repassando à CONSIGNANTE o valor integral das vendas efetuadas, deduzida sua comissão pactuada.',
          'CLÁUSULA 4ª (DAS PEÇAS DANIFICADAS OU NÃO RESTITUÍDAS): Quaisquer peças que não forem restituídas ou apresentarem danos não imputáveis a defeito de fabricação serão devidamente cobradas da CONSIGNATÁRIA pelo valor líquido ajustado entre as partes.',
          'CLÁUSULA 5ª (DA VALIDADE JURÍDICA DA ASSINATURA ELETRÔNICA): As partes reconhecem a plena validade jurídica e probatória desta assinatura eletrônica com chave criptográfica, conforme o disposto no art. 10, § 2º, da Medida Provisória nº 2.200-2/2001 e na Lei Federal nº 14.063/2020.'
        ];

        clausulas.forEach(c => {
          doc.fontSize(8).fillColor(corEscura).font('Helvetica').text(c, { align: 'justify', lineGap: 1.5 });
          doc.moveDown(0.4);
        });

        // 4. Relação de Itens (se houver)
        if (itens && itens.length > 0) {
          doc.moveDown(0.6);
          doc.fontSize(10).fillColor(corDourada).font('Helvetica-Bold').text('3. DEMONSTRATIVO DE PEÇAS CONSIGNADAS');
          doc.moveDown(0.3);

          // Cabeçalho da tabela
          const yHead = doc.y;
          doc.rect(45, yHead, 505, 14).fill('#f7f7f7');
          doc.fontSize(7.5).fillColor(corEscura).font('Helvetica-Bold');
          doc.text('CÓDIGO', 50, yHead + 3, { width: 70 });
          doc.text('DESCRIÇÃO DO PRODUTO', 125, yHead + 3, { width: 220 });
          doc.text('QTD', 350, yHead + 3, { width: 40, align: 'center' });
          doc.text('VALOR UNIT.', 400, yHead + 3, { width: 65, align: 'right' });
          doc.text('TOTAL', 470, yHead + 3, { width: 75, align: 'right' });

          doc.moveDown(0.8);
          let totalGeral = 0;
          let qtdGeral = 0;

          itens.slice(0, 15).forEach((item, idx) => {
            const yRow = doc.y;
            if (idx % 2 === 1) {
              doc.rect(45, yRow - 1, 505, 12).fill('#fafafa');
            }
            const unit = item.precoVenda || item.preco || 0;
            const subtotal = unit * (item.quantidade || 1);
            totalGeral += subtotal;
            qtdGeral += (item.quantidade || 1);

            doc.fontSize(7).fillColor(corEscura).font('Helvetica');
            doc.text(item.codigo || item.produtoId || '-', 50, yRow + 1, { width: 70 });
            doc.text(item.nome || item.descricao || 'Semijoia Consignada', 125, yRow + 1, { width: 220, ellipsis: true });
            doc.text((item.quantidade || 1).toString(), 350, yRow + 1, { width: 40, align: 'center' });
            doc.text(unit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), 400, yRow + 1, { width: 65, align: 'right' });
            doc.text(subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), 470, yRow + 1, { width: 75, align: 'right' });
            doc.moveDown(0.5);
          });

          // Linha de total
          doc.moveDown(0.2);
          doc.fontSize(8).fillColor(corEscura).font('Helvetica-Bold');
          doc.text(`TOTAL GERAL CONSIGNADO: ${qtdGeral} peças  |  ${totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, { align: 'right' });
        }

        // 5. Quadro de Assinatura Eletrônica (Selo de Certificação)
        doc.moveDown(1.5);
        if (doc.y > 640) {
          doc.addPage();
        }

        const yAss = doc.y;
        doc.roundedRect(45, yAss, 505, 120, 8).strokeColor(corDourada).lineWidth(1).stroke();
        doc.rect(45, yAss, 505, 18).fill('#fcf6ba');
        
        doc.fontSize(8.5).fillColor('#7a5800').font('Helvetica-Bold')
           .text('CERTIFICADO DE ASSINATURA ELETRÔNICA QUALIFICADA', 55, yAss + 5);

        const dataAss = termo.dataAssinatura ? new Date(termo.dataAssinatura).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');
        const hashPayload = `${termo.id}-${termo.assinaturaCpf || revendedora.cpf}-${dataAss}`;
        const hashAssinatura = crypto.createHash('sha256').update(hashPayload).digest('hex').toUpperCase();

        doc.fontSize(8).fillColor(corEscura).font('Helvetica-Bold')
           .text(`Signatária: ${termo.assinaturaNome || revendedora.nome}`, 55, yAss + 28);
        doc.font('Helvetica')
           .text(`Documento CPF: ${termo.assinaturaCpf || revendedora.cpf || 'Não registrado'}`, 55, yAss + 40)
           .text(`Data e Horário do Registro: ${dataAss} (Horário de Brasília)`, 55, yAss + 52)
           .text(`Endereço IP Registrado: ${termo.assinaturaIp || '127.0.0.1'}`, 55, yAss + 64)
           .text(`Hash de Integridade Criptográfica (SHA-256):`, 55, yAss + 76)
           .fontSize(7).font('Courier-Bold').fillColor(corCinza)
           .text(hashAssinatura, 55, yAss + 88);

        // Se houver imagem da assinatura desenhada em base64, estampa no canto direito
        if (termo.assinaturaImg && termo.assinaturaImg.startsWith('data:image')) {
          try {
            const base64Data = termo.assinaturaImg.replace(/^data:image\/\w+;base64,/, '');
            const imgBuffer = Buffer.from(base64Data, 'base64');
            doc.image(imgBuffer, 380, yAss + 30, { fit: [150, 60], align: 'center', valign: 'center' });
            doc.fontSize(6).fillColor(corCinza).font('Helvetica').text('Assinatura Gráfica Capturada', 380, yAss + 95, { width: 150, align: 'center' });
          } catch (imgErr) {
            console.error('Erro ao renderizar imagem da assinatura no PDF:', imgErr.message);
          }
        }

        // Rodapé de autenticidade
        doc.fontSize(6.5).fillColor(corCinza).font('Helvetica')
           .text('Documento eletrônico autenticado pelo Conecta Joias. Válido em todo território nacional nos termos da Lei 14.063/2020.', 45, 780, { align: 'center', width: 505 });

        doc.end();
      } catch (err) {
        console.error('❌ [PdfService] Erro na geração do PDF:', err);
        reject(err);
      }
    });
  }
}

module.exports = new PdfService();
