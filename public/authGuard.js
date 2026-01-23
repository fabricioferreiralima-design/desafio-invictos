(function () {
  const token = localStorage.getItem("authToken");

  if (!token) {
    // guarda a página que o usuário tentou acessar
    const paginaAtual = window.location.pathname;
    localStorage.setItem("redirectAfterLogin", paginaAtual);

    // redireciona para login
    window.location.href = "/login.html";
  }
})();
