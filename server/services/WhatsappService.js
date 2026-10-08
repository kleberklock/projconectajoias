/**
 * Conecta Joias - Serviço de Integração WhatsApp
 * Suporte a Z-API, Evolution API, Webhooks Genéricos e Modo Simulado
 */

class WhatsappService {
  constructor() {
    this.apiUrl = process.env.WHATSAPP_API_URL || '';
    this.apiKey = process.env.WHATSAPP_API_KEY || '';
  }

  /**
   * Normaliza o número de telefone para o padrão internacional (DDI 55 + DDD + Número)
   */
  formatarNumero(telefone) {
    if (!telefone) return null;
    let limpo = telefone.toString().replace(/\D/g, '');
    
    // Se não começar com o DDI do Brasil (55), adiciona
    if (limpo.length === 10 || limpo.length === 11) {
      limpo = '55' + limpo;
    }
    
    return limpo;
  }

  /**
   * Envia uma mensagem de texto simples
   */
  async enviarMensagem(telefone, texto) {
    const numeroFormatado = this.formatarNumero(telefone);
    if (!numeroFormatado) {
      console.warn('⚠️ [WhatsApp] Número de telefone inválido fornecido:', telefone);
      return { success: false, erro: 'Número de telefone inválido' };
    }

    // Modo Simulado se as chaves não estiverem preenchidas no .env
    if (!this.apiUrl || this.apiUrl.trim() === '' || !this.apiKey || this.apiKey.trim() === '') {
      console.log('\n📲 [WHATSAPP SIMULADO]');
      console.log(`   Destinatário : +${numeroFormatado}`);
      console.log(`   Mensagem     : \n${texto.split('\n').map(l => '      ' + l).join('\n')}`);
      console.log('   Status       : ✅ Registrado com sucesso (Configure WHATSAPP_API_URL no .env para envio real)\n');
      return { success: true, simulado: true, destinatario: numeroFormatado };
    }

    try {
      let endpoint = this.apiUrl.trim();
      let headers = {
        'Content-Type': 'application/json'
      };
      let body = {};

      const urlLower = endpoint.toLowerCase();

      if (urlLower.includes('z-api')) {
        // Padrão Z-API
        headers['Client-Token'] = this.apiKey.trim();
        body = {
          phone: numeroFormatado,
          message: texto
        };
      } else if (urlLower.includes('evolution')) {
        // Padrão Evolution API
        headers['apikey'] = this.apiKey.trim();
        body = {
          number: numeroFormatado,
          text: texto
        };
      } else {
        // Padrão Webhook Genérico (envia em ambos os formatos para compatibilidade)
        headers['Authorization'] = `Bearer ${this.apiKey.trim()}`;
        headers['apikey'] = this.apiKey.trim();
        body = {
          phone: numeroFormatado,
          number: numeroFormatado,
          message: texto,
          text: texto
        };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ [WhatsApp] Erro na API remota (${response.status}):`, errorText);
        return { success: false, status: response.status, erro: errorText };
      }

      const data = await response.json().catch(() => ({}));
      console.log(`✅ [WhatsApp] Mensagem enviada com sucesso para +${numeroFormatado}!`);
      return { success: true, simulado: false, data };

    } catch (err) {
      console.error('❌ [WhatsApp] Falha na comunicação com gateway de WhatsApp:', err.message);
      return { success: false, erro: err.message };
    }
  }

  /**
   * Template: Boas-vindas para nova revendedora cadastrada
   */
  async enviarBoasVindasRevendedora({ nome, telefone, pin, nomeLoja, urlAcesso }) {
    const loja = nomeLoja || 'Conecta Joias';
    const link = urlAcesso || 'https://conectajoias.vercel.app';
    const mensagem = 
`✨ *Olá, ${nome}!* Seja muito bem-vinda à equipe *${loja}*! 💎

Seu cadastro como revendedora parceira foi concluído com sucesso.

📱 *Seus dados de acesso:*
• Link do Portal: ${link}/pages/login.html
• Seu PIN de Acesso: *${pin}*

Acesse sua maleta virtual, registre suas vendas com facilidade e acompanhe suas comissões em tempo real!

Boas vendas e muito sucesso! ✨💎`;

    return this.enviarMensagem(telefone, mensagem);
  }

  /**
   * Template: Notificação de Novo Termo de Consignação para Assinatura
   */
  async enviarAvisoTermoConsignacao({ nome, telefone, nomeLoja, titulo, linkAssinatura, totalPecas, valorTotal }) {
    const loja = nomeLoja || 'Conecta Joias';
    const totalFormatado = (valorTotal || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const mensagem = 
`📄 *Termo de Consignação Disponível — ${loja}* 💎

Olá, *${nome}*! 
Um novo lote de semijoias foi consignado para você:

📦 *Resumo da Maleta:*
• Lote: *${titulo || 'Nova Consignação'}*
• Total de Peças: *${totalPecas || 0} itens*
• Valor Total Consignado: *${totalFormatado}*

✍️ Para validar sua maleta, faça a assinatura digital rápida clicando no link abaixo:
🔗 ${linkAssinatura}

_Sua assinatura garante a segurança e transparência da nossa parceria._`;

    return this.enviarMensagem(telefone, mensagem);
  }

  /**
   * Template: Notificação de Fechamento de Acerto de Comissão
   */
  async enviarAvisoAcerto({ nome, telefone, nomeLoja, faturamentoBruto, comissaoLiquida, totalDevolvida, linkRecibo }) {
    const loja = nomeLoja || 'Conecta Joias';
    const fatFormatado = (faturamentoBruto || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const comFormatada = (comissaoLiquida || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    let msg = 
`🎉 *Acerto de Comissão Realizado — ${loja}* 💎

Parabéns pelo ciclo de vendas, *${nome}*! 👏

📊 *Resumo do Fechamento:*
• Vendas Realizadas: *${fatFormatado}*
• Peças Devolvidas: *${totalDevolvida || 0} itens*
• Sua Comissão a Receber: *${comFormatada}* 💰`;

    if (linkRecibo) {
      msg += `\n\n🧾 Acesse o comprovante completo do seu acerto:\n🔗 ${linkRecibo}`;
    }

    msg += `\n\nObrigado pela dedicação e parceria contínua! ✨💎`;

    return this.enviarMensagem(telefone, msg);
  }

  /**
   * Template: Código de Recuperação de Senha / PIN
   */
  async enviarCodigoRecuperacao({ nome, telefone, codigo }) {
    const mensagem = 
`🔐 *Código de Segurança — Conecta Joias*

Olá, *${nome || 'Usuário'}*!
Recebemos uma solicitação para recuperação de acesso à sua conta.

Seu código de verificação é: *${codigo}*

⏱️ Este código expira em 15 minutos.
Se você não solicitou esta alteração, por favor ignore esta mensagem.`;

    return this.enviarMensagem(telefone, mensagem);
  }

  /**
   * Processador da Fila do Banco de Dados
   */
  async processarFila(prisma, lojaId = null) {
    try {
      const where = { status: 'PENDENTE' };
      if (lojaId) where.lojaId = lojaId;

      const pendentes = await prisma.mensagemWhatsapp.findMany({
        where,
        take: 20,
        orderBy: { createdAt: 'asc' }
      });

      if (pendentes.length === 0) return { processadas: 0 };

      console.log(`📨 [WhatsApp Fila] Processando ${pendentes.length} mensagens pendentes...`);
      let processadas = 0;

      for (const item of pendentes) {
        const resultado = await this.enviarMensagem(item.numero, item.mensagem);
        await prisma.mensagemWhatsapp.update({
          where: { id: item.id },
          data: {
            status: resultado.success ? 'ENVIADO' : 'ERRO'
          }
        });
        processadas++;
        // Pequena pausa para rate limiting
        await new Promise(r => setTimeout(r, 600));
      }

      return { processadas };
    } catch (err) {
      console.error('❌ [WhatsApp Fila] Erro ao processar fila:', err);
      return { erro: err.message };
    }
  }
}

module.exports = new WhatsappService();
