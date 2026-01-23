async function initSeletorDesafio() {
  try {
    const res = await fetch("/api/challenges/ativos");
    const desafios = await res.json();

    if (!desafios || desafios.length <= 1) return;

 const selector = document.getElementById("seletorDesafioContainer");
const select = document.getElementById("selectDesafioGlobal");

    if (!selector || !select) return;

    selector.style.display = "block";
    select.innerHTML = "";

    const desafioSalvo = localStorage.getItem("challengeIdSelecionado");

    desafios.forEach(d => {
      const option = document.createElement("option");
      option.value = d._id;
      option.textContent = `${d.nome} (${d.tipo})`;

      if (d._id === desafioSalvo) {
        option.selected = true;
      }

      select.appendChild(option);
    });

    if (!desafioSalvo && desafios[0]) {
      localStorage.setItem("challengeIdSelecionado", desafios[0]._id);
    }

select.addEventListener("change", () => {
  const challengeId = select.value;

  localStorage.setItem("challengeIdSelecionado", challengeId);

  // 🔔 AVISA TODAS AS PÁGINAS
  document.dispatchEvent(new Event("desafioAlterado"));
});

  } catch (err) {
    console.error("Erro no seletor de desafio:", err);
  }
}

