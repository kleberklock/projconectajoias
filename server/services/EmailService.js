/**
 * Conecta Joias - Serviço de E-mails Transacionais
 * Suporte a SMTP (Hostinger, SendGrid, Amazon SES, Resend, Gmail) e Modo Simulado
 */

const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.smtpHost = process.env.SMTP_HOST || '';
    this.smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    this.smtpUser = process.env.SMTP_USER || '';
    this.smtpPass = process.env.SMTP_PASS || '';
    this.smtpFrom = process.env.SMTP_FROM || '"Conecta Joias" <contato@conectajoias.com>';

    this.transporter = null;
    this.inicializarTransporter();
  }

  inicializarTransporter() {
    if (this.smtpHost && this.smtpUser && this.smtpPass) {
      try {
        this.transporter = nodemailer.createTransport({
          host: this.smtpHost,
          port: this.smtpPort,
          secure: this.smtpPort === 465,
          auth: {
            user: this.smtpUser,
            pass: this.smtpPass
          }
        });
        console.log('📧 [EmailService] SMTP configurado com sucesso em', this.smtpHost);
      } catch (err) {
        console.error('❌ [EmailService] Falha ao configurar transportador SMTP:', err.message);
        this.transporter = null;
      }
    }
  }

  /**
   * Envia um e-mail genérico
   */
  async enviarEmail({ para, assunto, html, texto }) {
    if (!para) {
      return { success: false, erro: 'Destinatário não informado.' };
    }

    // Modo Simulado se SMTP não estiver configurado
    if (!this.transporter) {
      console.log('\n📧 [E-MAIL SIMULADO]');
      console.log(`   Para     : ${para}`);
      console.log(`   Assunto  : ${assunto}`);
      console.log(`   Conteúdo : ${texto || '(HTML fornecido)'}`);
      console.log('   Status   : ✅ Registrado com sucesso (Configure SMTP_HOST no .env para envio real)\n');
      return { success: true, simulado: true, para };
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.smtpFrom,
        to: para,
        subject: assunto,
        text: texto,
        html: html
      });

      console.log(`✅ [EmailService] E-mail enviado para ${para} (MessageId: ${info.messageId})`);
      return { success: true, simulado: false, messageId: info.messageId };
    } catch (err) {
      console.error(`❌ [EmailService] Falha ao enviar e-mail para ${para}:`, err.message);
      return { success: false, erro: err.message };
    }
  }

  /**
   * Template: Código de Recuperação de Senha
   */
  async enviarCodigoRecuperacao({ para, nome, codigo }) {
    const assunto = 'Código de Recuperação de Senha - Conecta Joias';
    const texto = `Olá, ${nome || 'Usuário'}! Seu código de segurança para redefinição de senha é: ${codigo}. Ele expira em 15 minutos.`;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #050505; color: #f5f5f7; margin: 0; padding: 20px; }
        .card { max-width: 500px; margin: 0 auto; background: #121212; border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 16px; padding: 32px; text-align: center; }
        .logo { font-size: 24px; font-weight: bold; color: #d4af37; margin-bottom: 20px; letter-spacing: 2px; }
        h2 { color: #ffffff; font-size: 20px; margin-bottom: 12px; }
        p { color: #a1a1aa; font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
        .code-box { background: rgba(212, 175, 55, 0.1); border: 2px dashed #d4af37; border-radius: 12px; padding: 18px; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #fcf6ba; margin: 20px 0; }
        .footer { font-size: 11px; color: #71717a; margin-top: 30px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">💎 CONECTA JOIAS</div>
        <h2>Recuperação de Acesso</h2>
        <p>Olá, <strong>${nome || 'Usuário'}</strong>. Recebemos uma solicitação para redefinir sua senha de acesso. Utilize o código de segurança abaixo:</p>
        <div class="code-box">${codigo}</div>
        <p>Este código expira em <strong>15 minutos</strong>. Caso não tenha solicitado a redefinição, desconsidere esta mensagem com segurança.</p>
        <div class="footer">Este é um e-mail automático do ecossistema Conecta Joias. Por favor, não responda.</div>
      </div>
    </body>
    </html>
    `;

    return this.enviarEmail({ para, assunto, html, texto });
  }

  /**
   * Template: Termo de Consignação Assinado
   */
  async enviarNotificacaoTermoAssinado({ para, nomeGestora, nomeRevendedora, tituloTermo, dataAssinatura, linkPdf }) {
    const assunto = `Termo de Consignação Assinado: ${nomeRevendedora} - Conecta Joias`;
    const texto = `O Termo "${tituloTermo}" foi assinado por ${nomeRevendedora} em ${dataAssinatura}. Link do PDF: ${linkPdf}`;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #050505; color: #f5f5f7; margin: 0; padding: 20px; }
        .card { max-width: 520px; margin: 0 auto; background: #121212; border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 16px; padding: 32px; text-align: left; }
        .logo { font-size: 22px; font-weight: bold; color: #d4af37; margin-bottom: 20px; letter-spacing: 1px; text-align: center; }
        h2 { color: #ffffff; font-size: 18px; margin-bottom: 12px; }
        p { color: #a1a1aa; font-size: 14px; line-height: 1.6; }
        .btn { display: inline-block; background: linear-gradient(135deg, #bf953f 0%, #b38728 100%); color: #000; text-decoration: none; padding: 12px 24px; border-radius: 50px; font-weight: bold; font-size: 14px; margin-top: 15px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">💎 CONECTA JOIAS</div>
        <h2>Termo de Consignação Assinado Eletronicamente</h2>
        <p>Olá, <strong>${nomeGestora || 'Gestora'}</strong>!</p>
        <p>A revendedora <strong>${nomeRevendedora}</strong> concluiu com sucesso a assinatura eletrônica do lote consignado: <strong>${tituloTermo}</strong>.</p>
        <p>Data e Hora: <strong>${dataAssinatura}</strong></p>
        <div style="text-align: center; margin: 25px 0;">
          <a href="${linkPdf}" class="btn">Visualizar Documento PDF</a>
        </div>
      </div>
    </body>
    </html>
    `;

    return this.enviarEmail({ para, assunto, html, texto });
  }
}

module.exports = new EmailService();
