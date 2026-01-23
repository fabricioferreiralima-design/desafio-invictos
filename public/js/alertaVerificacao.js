(async function () {
  const token = localStorage.getItem("authToken");
  if (!token) return;

  // cria a barra
  const barra = document.createElement("div");
  barra.id = "barraVerificacao";
  barra.innerHTML = `
    ⚠️ Sua conta ainda não foi verificada.
    <button id="btnReenviarVerificacao">Reenviar link</button>
  `;

  // injeta logo após o header/topo
  const topo = document.querySelector(".topo-palpitar");
  if (topo) {
    topo.insertAdjacentElement("afterend", barra);
  }

  // CSS inline (simples, direto e seguro)
  barra.style.background = "#FEF3C7";
  barra.style.color = "#92400E";
  barra.style.padding = "12px 20px";
  barra.style.fontWeight = "800";
  barra.style.display = "none";
  barra.style.alignItems = "center";
  barra.style.justifyContent = "center";
  barra.style.gap = "10px";
  barra.style.textAlign = "center";

  const btn = barra.querySelector("button");
  btn.style.marginLeft = "10px";
  btn.style.background = "#F59E0B";
  btn.style.border = "none";
  btn.style.borderRadius = "999px";
  btn.style.padding = "6px 12px";
  btn.style.cursor = "pointer";
  btn.style.fontWeight = "800";

  // ============================
  // checa status do usuário
  // ============================
  try {
  const res = await fetch("/api/status-jogador", {
  headers: { Authorization: `Bearer ${token}` }
});

    if (!res.ok) return;

    const user = await res.json();

    if (!user.emailConfirmado) {
      barra.style.display = "flex";
    }

    // reenviar email
 btn.onclick = async () => {
  btn.disabled = true;
  btn.textContent = "Enviando...";

  const resp = await fetch("/api/reenviar-verificacao", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  btn.textContent = resp.ok ? "Enviado!" : "Erro";

  setTimeout(() => {
    btn.textContent = "Reenviar link";
    btn.disabled = false;
  }, 3000);
};
  } catch (err) {
    console.error("Erro verificação:", err);
  }
})();
