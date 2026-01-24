const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

async function enviarEmailConfirmacao(email, nome, token) {
  const link = `${process.env.APP_URL}/confirmar-email?token=${token}`;

  try {
    await resend.emails.send({
      from: "Desafio Invictos <onboarding@resend.dev>",
      to: email,
      subject: "Confirme sua conta no Desafio Invictos",
      html: `
        <h2>Olá, ${nome}!</h2>
        <p>Clique no botão abaixo para confirmar sua conta:</p>
        <a href="${link}" style="
          display:inline-block;
          padding:12px 20px;
          background:#22c55e;
          color:white;
          text-decoration:none;
          border-radius:6px;
          font-weight:bold;
        ">Confirmar conta</a>
        <p>Se você não criou essa conta, ignore este email.</p>
      `
    });
  } catch (err) {
    console.error("Erro ao enviar email:", err);
    throw err;
  }
}

module.exports = { enviarEmailConfirmacao };
