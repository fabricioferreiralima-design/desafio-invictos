  // 1️⃣ Carregar variáveis de ambiente logo no início
  require("dotenv").config();
  
  // 2️⃣ Logs iniciais para debug
  console.log("🚀 Iniciando server.js...");
  console.log("📁 Pasta atual:", __dirname);
  console.log("🔑 PORT =", process.env.PORT || "❌ não carregada");
  console.log("🔑 RAPIDAPI_KEY =", process.env.RAPIDAPI_KEY ? "✅ carregada" : "❌ não carregada");
  console.log("🔑 MONGODB_URI =", process.env.MONGODB_URI ? "✅ carregada" : "❌ não carregada");
  

  // 3️⃣ Imports
  const express = require("express");
  const axios = require("axios");
  const NodeCache = require("node-cache");
  const mongoose = require("mongoose");
  const cors = require("cors");
  const Palpite = require("./models/palpite");
  const bcrypt = require("bcrypt");
const User = require("./models/user");
const validarCPF = require("./utils/validarCPF");
const registerSchema = require("./validators/registerValidator");
  const jwt = require("jsonwebtoken");
  const auth = require("./middlewares/auth");
  const crypto = require("crypto");
  const transporter = require("./utils/email");
  const authAdmin = require("./middlewares/authAdmin");
  const Challenge = require("./models/Challenge");
  const path = require("path");

  const STATUS_RULES = {
  iniciando: {
    podePalpitar: true,
    podeSimular: true,
    podeBuscarResultados: false
  },
  ativo: {
    podePalpitar: true,
    podeSimular: true,
    podeBuscarResultados: false
  },
  aguardando: {
    podePalpitar: false,
    podeSimular: true,
    podeBuscarResultados: false
  },
  finalizado: {
    podePalpitar: false,
    podeSimular: false,
    podeBuscarResultados: false
  }
};

let rodadaAtual = 1;

async function obterDesafioAtual(user) {
  const desafios = await Challenge.find({
    visivel: true,
    status: { $in: ["iniciando", "ativo", "aguardando", "finalizado"] }
  }).sort({ dataInicio: 1 });

  if (!desafios.length) return null;

  // Apenas um desafio visível
  if (desafios.length === 1) return desafios[0];

  // Dois desafios (turno + returno)
  const turno = desafios.find(d => d.tipo === "turno");
  const returno = desafios.find(d => d.tipo === "returno");

  // Usuário ainda vivo → continua no turno
  if (user.status === "ativo" && turno) return turno;

  // Eliminado → vai pro returno
  if (returno) return returno;

  // Fallback de segurança
  return desafios[0];
}

async function resolverDesafio(req, user) {
  const challengeId = req.headers["x-challenge-id"];

  // Se o front mandou um desafio específico
  if (challengeId) {
    const desafio = await Challenge.findOne({
      _id: challengeId,
      visivel: true
    });

    if (desafio) return desafio;
  }

  // Caso contrário, usa a lógica automática
  return await obterDesafioAtual(user);
}



  // 4️⃣ Configuração do servidor
  const app = express();
  app.set("trust proxy", 1);
  const cache = new NodeCache({ stdTTL: 14400 }); // 4h cache

  // Middlewares
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  // 5️⃣ Conexão com MongoDB Atlas
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Conectado ao MongoDB Atlas"))
    .catch(err => console.error("❌ Erro ao conectar MongoDB:", err));

    app.get("/api/health", (req, res) => {
  res.json({ ok: true, status: "online" });
});

async function avaliarStatusDoJogador(userId) {
  const user = await User.findById(userId);
  if (!user || user.status === "eliminado") return user;

  const palpites = await Palpite.find({ userId });

  for (const palpite of palpites) {
    const rodada = palpite.rodada;

    const cacheKey = "jogos-brasileirao-2025";
let dados = cache.get(cacheKey);

if (!dados) {
  const response = await axios.get("https://api-football-v1.p.rapidapi.com/v3/fixtures", {
    params: { league: 71, season: 2026 },
    headers: {
      "X-RapidAPI-Key": process.env.RAPIDAPI_KEY,
      "X-RapidAPI-Host": "api-football-v1.p.rapidapi.com"
    }
  });

  dados = response.data;
  cache.set(cacheKey, dados);
}

    const jogosRodada = dados.response.filter(j =>
      j.league.round === `Regular Season - ${rodada}`
    );

    const jogo = jogosRodada.find(j =>
      j.teams.home.name === palpite.time ||
      j.teams.away.name === palpite.time
    );

    if (!jogo) continue;

    // Só avaliamos jogos finalizados
    if (jogo.fixture.status.short !== "FT") continue;

    const golsTime =
      jogo.teams.home.name === palpite.time
        ? jogo.goals.home
        : jogo.goals.away;

    const golsAdv =
      jogo.teams.home.name === palpite.time
        ? jogo.goals.away
        : jogo.goals.home;

    if (golsTime < golsAdv) {
      // ❌ PERDEU → eliminado
      user.status = "eliminado";
      user.rodadaEliminacao = rodada;
      await user.save();
      return user;
    }
  }

  return user;
}

function obterChallengeIdAdmin(req) {
  const challengeId = req.headers["x-challenge-id"];
  if (!challengeId) {
    throw new Error("X-CHALLENGE-ID não informado");
  }
  return new mongoose.Types.ObjectId(challengeId);
}


  // 6️⃣ Endpoint para buscar jogos da API-Football
  app.get("/api/jogos", async (req, res) => {
    const cacheKey = "jogos-brasileirao-2025";
    console.log("📌 Requisição recebida em /api/jogos");

    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      console.log("♻️ Retornando do cache");
      return res.json(cachedData);
    }

    try {
      console.log("🌐 Buscando dados na API-Football...");
      const response = await axios.get("https://api-football-v1.p.rapidapi.com/v3/fixtures", {
        params: { league: 71, season: 2026 },
        headers: {
          "X-RapidAPI-Key": process.env.RAPIDAPI_KEY,
          "X-RapidAPI-Host": "api-football-v1.p.rapidapi.com"
        },
        timeout: 10000
      });

      const dados = response.data;
      cache.set(cacheKey, dados);
      console.log("💾 Dados salvos no cache");

      res.json(dados);
    } catch (err) {
      console.error("❌ Erro na API-Football:", err.message);
      res.status(500).json({ error: "Erro ao buscar dados" });
    }
  });

  // 🔰 Buscar desafios ativos (visíveis)
app.get("/api/challenges/ativos", async (req, res) => {
  try {
    const challenges = await Challenge.find({
      status: { $in: ["iniciando", "ativo", "aguardando", "finalizado"] },
      visivel: true
    }).sort({ dataInicio: 1 });

    res.json(challenges);
  } catch (err) {
    console.error("Erro ao buscar desafios ativos:", err);
    res.status(500).json({ error: "Erro ao buscar desafios ativos" });
  }
});

// 🎯 Descobrir desafio atual do usuário
app.get("/api/challenges/atual", auth, async (req, res) => {
  try {
    const userId = req.userId;

    // 1️⃣ Buscar desafios ativos
    const desafios = await Challenge.find({
      status: { $in: ["ativo", "aguardando"] },
      visivel: true
    }).sort({ dataInicio: 1 });

    if (!desafios.length) {
      return res.status(404).json({ error: "Nenhum desafio ativo no momento" });
    }

    // Se só existir um desafio, retorna ele
    if (desafios.length === 1) {
      return res.json(desafios[0]);
    }

    // 2️⃣ Buscar status do usuário
    const user = await User.findById(userId);

    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    // 3️⃣ Lógica turno / returno
    const desafioTurno = desafios.find(d => d.tipo === "turno");
    const desafioReturno = desafios.find(d => d.tipo === "returno");

    // Se ainda está vivo no turno → continua nele
    if (
      desafioTurno &&
      user.status === "ativo"
    ) {
      return res.json(desafioTurno);
    }

    // Se eliminado → entra no returno
    if (desafioReturno) {
      return res.json(desafioReturno);
    }

    // fallback de segurança
    return res.json(desafios[0]);

  } catch (err) {
    console.error("Erro ao determinar desafio atual:", err);
    res.status(500).json({ error: "Erro ao determinar desafio atual" });
  }
});

// 🎮 CONTEXTO DO JOGO (fonte única para o frontend)
app.get("/api/jogo/contexto", auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    // 🔎 desafio atual (sua lógica turno/returno)
    const desafioAtual = await resolverDesafio(req, user);

    // 🔒 GARANTIA DE CONSISTÊNCIA DE RODADA
if (desafioAtual.rodadaAtual < desafioAtual.rodadaInicial) {
  desafioAtual.rodadaAtual = desafioAtual.rodadaInicial;
  await desafioAtual.save();
}


if (!desafioAtual) {
  return res.status(404).json({ error: "Nenhum desafio ativo" });
}

    // 🔎 já palpitou na rodada atual?
    const jaPalpitou = await Palpite.exists({
      userId: user._id,
      challengeId: desafioAtual._id,
      rodada: desafioAtual.rodadaAtual
    });

res.json({
desafio: {
  _id: desafioAtual._id,
  nome: desafioAtual.nome,
  tipo: desafioAtual.tipo,
  status: desafioAtual.status,

  rodadaAtual: desafioAtual.rodadaAtual,
  rodadaInicial: desafioAtual.rodadaInicial,
  rodadaFinal: desafioAtual.rodadaFinal,

  regras: STATUS_RULES[desafioAtual.status]
},
  usuario: {
    status: user.status,
    rodadaEliminacao: user.rodadaEliminacao,
    jaPalpitou
  }
});


  } catch (err) {
    console.error("Erro em /api/jogo/contexto:", err);
    res.status(500).json({ error: "Erro ao carregar contexto do jogo" });
  }
});




  // 7️⃣ Endpoints de palpites
 app.post("/api/palpite", auth, async (req, res) => {
  try {
    const { rodada, time } = req.body;
    const userId = req.userId;

    /* ===========================
       1️⃣ Usuário
    =========================== */
    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

   if (!user.emailConfirmado) {
  return res.status(403).json({
    error: "Você precisa confirmar seu e-mail antes de palpitar.",
    codigo: "EMAIL_NAO_VERIFICADO"
  });
}
    if (user.status === "eliminado") {
      return res.status(403).json({
        error: "Usuários eliminados não podem palpitar."
      });
    }

    /* ===========================
       2️⃣ Descobrir desafio atual
    =========================== */
   const desafioAtual = await resolverDesafio(req, user);

if (!desafioAtual) {
  return res.status(404).json({ error: "Nenhum desafio ativo" });
}

    /* ===========================
       3️⃣ Validar status do desafio
    =========================== */
    if (!["iniciando", "ativo"].includes(desafioAtual.status)) {
      return res.status(403).json({
        error: `Palpites bloqueados. Status atual: ${desafioAtual.status}`
      });
    }

    /* ===========================
       4️⃣ Validar rodada
    =========================== */
    const rodadaNum = Number(rodada);
    if (rodadaNum !== desafioAtual.rodadaAtual) {
      return res.status(400).json({
        error: `Você só pode palpitar a rodada ${desafioAtual.rodadaAtual}.`
      });
    }

    if (!time) {
      return res.status(400).json({ error: "Time é obrigatório." });
    }

    /* ===========================
       5️⃣ Buscar jogos (cache)
    =========================== */
    const cacheKey = "jogos-brasileirao-2025";
    let dados = cache.get(cacheKey);

    if (!dados) {
      const response = await axios.get(
        "https://api-football-v1.p.rapidapi.com/v3/fixtures",
        {
          params: { league: 71, season: 2026 },
          headers: {
            "X-RapidAPI-Key": process.env.RAPIDAPI_KEY,
            "X-RapidAPI-Host": "api-football-v1.p.rapidapi.com"
          }
        }
      );
      dados = response.data;
      cache.set(cacheKey, dados);
    }

    const jogos = dados.response || [];

    const jogosRodada = jogos.filter(j =>
      j.league?.round === `Regular Season - ${rodadaNum}`
    );

    const jogo = jogosRodada.find(j =>
      j.teams.home.name === time || j.teams.away.name === time
    );

    if (!jogo) {
      return res.status(400).json({
        error: `O time ${time} não joga na rodada ${rodadaNum}.`
      });
    }

    /* ===========================
       6️⃣ Prazo
    =========================== */
    if (new Date() >= new Date(jogo.fixture.date)) {
      return res.status(400).json({
        error: "Prazo para palpitar nessa partida já acabou."
      });
    }

    /* ===========================
       7️⃣ Regras de repetição
    =========================== */
    const palpitesUser = await Palpite.find({
      userId,
      challengeId: desafioAtual._id
    });

    const palpitesOutros = palpitesUser.filter(
      p => p.rodada !== rodadaNum
    );

    // ❌ repetir time
    if (palpitesOutros.some(p => p.time === time)) {
      return res.status(400).json({
        error: `Você já usou o time ${time} em outra rodada.`
      });
    }

    // ❌ enfrentar adversário > 3x
    const contadorAdversarios = {};

    for (const p of palpitesOutros) {
      const jogoAntigo = jogos.find(j =>
        j.league?.round === `Regular Season - ${p.rodada}` &&
        (j.teams.home.name === p.time || j.teams.away.name === p.time)
      );

      if (!jogoAntigo) continue;

      const adversario =
        jogoAntigo.teams.home.name === p.time
          ? jogoAntigo.teams.away.name
          : jogoAntigo.teams.home.name;

      contadorAdversarios[adversario] =
        (contadorAdversarios[adversario] || 0) + 1;
    }

    const adversarioAtual =
      jogo.teams.home.name === time
        ? jogo.teams.away.name
        : jogo.teams.home.name;

    if ((contadorAdversarios[adversarioAtual] || 0) >= 3) {
      return res.status(400).json({
        error: `Você já enfrentou ${adversarioAtual} 3 vezes.`
      });
    }

    /* ===========================
       8️⃣ Salvar palpite
    =========================== */
    const palpite = await Palpite.findOneAndUpdate(
      {
        userId,
        challengeId: desafioAtual._id,
        rodada: rodadaNum
      },
      {
        time,
        challengeId: desafioAtual._id,
        createdAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.json({
      message: "✅ Palpite salvo com sucesso!",
      palpite
    });

  } catch (err) {
    console.error("Erro /api/palpite:", err);
    res.status(500).json({ error: "Erro interno ao salvar palpite." });
  }
});


app.get("/api/palpites", auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    // 🔑 RESOLVE O DESAFIO ATUAL (usa X-CHALLENGE-ID se existir)
    const desafioAtual = await resolverDesafio(req, user);

    if (!desafioAtual) {
      return res.json([]);
    }

    // ✅ BUSCA APENAS OS PALPITES DESSE DESAFIO
    const palpites = await Palpite.find({
      userId: user._id,
      challengeId: desafioAtual._id
    });

    res.json(palpites);

  } catch (err) {
    console.error("Erro ao buscar palpites:", err);
    res.status(500).json({ error: "Erro ao buscar palpites" });
  }
});

app.get("/api/linha-do-tempo", auth, async (req, res) => {
  try {
    const userId = req.userId;

    // 🔑 resolver desafio corretamente
    const user = await User.findById(userId);
    const desafioAtual = await resolverDesafio(req, user);

    if (!desafioAtual) {
      return res.json([]);
    }

    // ✅ FILTRO CORRETO
    const palpites = await Palpite.find({
      userId,
      challengeId: desafioAtual._id
    }).sort({ rodada: 1 });

    if (!palpites.length) {
      return res.json([]);
    }

      // 3️⃣ Buscar jogos do cache (ou API se necessário)
    const cacheKey = "jogos-brasileirao-2025";
    let dados = cache.get(cacheKey);

    if (!dados) {
      const response = await axios.get(
        "https://api-football-v1.p.rapidapi.com/v3/fixtures",
        {
          params: { league: 71, season: 2026 },
          headers: {
            "X-RapidAPI-Key": process.env.RAPIDAPI_KEY,
            "X-RapidAPI-Host": "api-football-v1.p.rapidapi.com"
          }
        }
      );

      dados = response.data;
      cache.set(cacheKey, dados);
    }

    const jogos = dados.response || [];

    // 4️⃣ Montar a linha do tempo processada
    const linhaDoTempo = palpites.map(p => {
      const rodada = Number(p.rodada);
      const timeEscolhido = p.time;

      // acha os jogos da rodada
      const jogosRodada = jogos.filter(j =>
        j.league &&
        j.league.round === `Regular Season - ${rodada}`
      );

      // acha o jogo do time escolhido
      const jogo = jogosRodada.find(j =>
        j.teams.home.name === timeEscolhido ||
        j.teams.away.name === timeEscolhido
      );

      // se não achou jogo (raro, mas possível)
      if (!jogo) {
        return {
          rodada,
          time: timeEscolhido,
          placar: "Jogo não encontrado",
          status: "erro"
        };
      }

      const home = jogo.teams.home.name;
      const away = jogo.teams.away.name;
      const golsHome = jogo.goals.home;
      const golsAway = jogo.goals.away;

      let status = "aguardando";
      let placar = "Aguardando jogo...";

      // jogo já aconteceu?
      if (golsHome !== null && golsAway !== null) {
        placar = `${home} ${golsHome} x ${golsAway} ${away}`;

        const golsTime =
          timeEscolhido === home ? golsHome : golsAway;
        const golsAdv =
          timeEscolhido === home ? golsAway : golsHome;

        if (golsTime > golsAdv) {
          status = "sobreviveu";
        } else if (golsTime < golsAdv) {
          status = "eliminado";
        } else {
          status = "sobreviveu"; // empate
        }
      }

      return {
        rodada,
        time: timeEscolhido,
        placar,
        status
      };
    });

    // 5️⃣ Retorna tudo pronto
    res.json(linhaDoTempo);

  } catch (err) {
    console.error("Erro na linha do tempo:", err);
    res.status(500).json({ error: "Erro ao gerar linha do tempo" });
  }
});



  // ✅ Novo endpoint: resultados reais de uma rodada (usando cache já existente)
  app.get("/api/resultados/:rodada", async (req, res) => {
    const rodada = Number(req.params.rodada);
    const cacheKey = "jogos-brasileirao-2025";
    console.log(`📅 Requisição de resultados para a rodada ${rodada}`);

    try {
      let dados = cache.get(cacheKey);
      if (!dados) {
        console.log("⚠️ Dados não encontrados no cache — buscando na API...");
        const response = await axios.get("https://api-football-v1.p.rapidapi.com/v3/fixtures", {
          params: { league: 71, season: 2026 },
          headers: {
            "X-RapidAPI-Key": process.env.RAPIDAPI_KEY,
            "X-RapidAPI-Host": "api-football-v1.p.rapidapi.com"
          },
          timeout: 10000
        });
        dados = response.data;
        cache.set(cacheKey, dados);
      }

      const jogosRodada = dados.response.filter(jogo =>
        jogo.league.round === `Regular Season - ${rodada}`
      );

      if (!jogosRodada.length) {
        return res.json({ mensagem: `Nenhum jogo encontrado para a rodada ${rodada}` });
      }

      const resultados = jogosRodada.map(j => ({
        time_home: j.teams.home.name,
        time_away: j.teams.away.name,
        gols_home: j.goals.home,
        gols_away: j.goals.away,
        vencedor:
          j.fixture.status.short !== "FT"
            ? "Aguardando"
            : j.goals.home > j.goals.away
            ? j.teams.home.name
            : j.goals.home < j.goals.away
            ? j.teams.away.name
            : "Empate"
      }));

      res.json(resultados);
    } catch (err) {
      console.error("❌ Erro ao gerar resultados da rodada:", err.message);
      res.status(500).json({ error: "Erro ao buscar resultados da rodada" });
    }
  });




  // ✅ Novo bloco: controle manual de rodada atual
  app.get("/api/rodada-atual", (req, res) => {
    res.json({ rodadaAtual });
  });

  app.post("/api/rodada-atual", (req, res) => {
    const { novaRodada } = req.body;
    if (!novaRodada || isNaN(novaRodada)) {
      return res.status(400).json({ error: "Valor inválido para novaRodada" });
    }

    rodadaAtual = Number(novaRodada);
    console.log(`🔁 Rodada atual alterada manualmente para: ${rodadaAtual}`);
    res.json({ message: "Rodada atual atualizada com sucesso!", rodadaAtual });
  });

  app.post("/api/register", async (req, res) => {
  try {
    // 1️⃣ Validar dados com Joi
    const { error } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: error.details[0].message
      });
    }

    const {
      nome,
      sobrenome,
      username,
      email,
      senha,
      cpf,
      dataNascimento,
      timeCoracao,
      genero
    } = req.body;

    // 2️⃣ Validar CPF
    if (!validarCPF(cpf)) {
      return res.status(400).json({ error: "CPF inválido" });
    }

    // 3️⃣ Verificar duplicidade
    const usuarioExiste = await User.findOne({
      $or: [
        { username: username.toLowerCase() },
        { email: email.toLowerCase() },
        { cpf }
      ]
    });

    if (usuarioExiste) {
      return res.status(400).json({
        error: "Usuário já cadastrado (username, email ou CPF)"
      });
    }

    // 4️⃣ Criptografar senha
    const senhaHash = await bcrypt.hash(senha, 12);


    const emailToken = crypto.randomBytes(32).toString("hex");
    const emailTokenExpira = Date.now() + 1000 * 60 * 60 * 24; // 24 horas
    // 5️⃣ Criar usuário
    const user = await User.create({
      nome,
      sobrenome,
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      senhaHash,
      cpf,
      dataNascimento,
      timeCoracao,
      genero,
        emailConfirmado: false,
      emailToken,
  emailTokenExpira
    });

    res.status(201).json({
  ok: true,
  message: "Cadastro realizado com sucesso! Verifique seu e-mail."
});


    const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const linkVerificacao = `${BASE_URL}/api/verify-email?token=${emailToken}`;


transporter.sendMail({
  from: `"Campeonato" <${process.env.EMAIL_USER}>`,
  to: user.email,
  subject: "Confirme seu e-mail",
  html: `
    <h2>Bem-vindo!</h2>
    <p>Confirme seu e-mail clicando abaixo:</p>
    <a href="${linkVerificacao}">Confirmar e-mail</a>
  `
}).catch(err => {
  console.error("❌ Erro ao enviar e-mail:", err.message);
});


    // 6️⃣ Resposta segura (NUNCA retornar senha ou CPF)
    res.status(201).json({
  message: "Cadastro realizado com sucesso! Verifique seu e-mail para ativar a conta."
});

  } catch (err) {
    console.error("❌ Erro no cadastro:", err);
    res.status(500).json({
      error: "Erro interno no servidor"
    });
  }
});

app.get("/api/verify-email", async (req, res) => {
  try {
    const { token } = req.query;

    // 1️⃣ Verificar se o token foi enviado
    if (!token) {
      return res.status(400).send("❌ Token de verificação não informado.");
    }

    // 2️⃣ Buscar usuário pelo token e validar expiração
    const user = await User.findOne({
      emailToken: token,
      emailTokenExpira: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).send("❌ Token inválido ou expirado.");
    }

    // 3️⃣ Confirmar e-mail
    user.emailConfirmado = true;
    user.emailToken = undefined;
    user.emailTokenExpira = undefined;

    await user.save();

    // 4️⃣ Resposta visual simples
    res.send(`
      <h2 style="color: green;">✅ E-mail confirmado com sucesso!</h2>
      <p>Sua conta foi ativada.</p>
      <p>Agora você já pode voltar ao site e fazer login.</p>
    `);

  } catch (err) {
    console.error("Erro na verificação de e-mail:", err);
    res.status(500).send("❌ Erro interno ao confirmar e-mail.");
  }
});

async function resolverDesafioAdmin(req) {
  const challengeId = req.headers["x-challenge-id"];

  if (!challengeId) {
    throw new Error("X-CHALLENGE-ID não informado");
  }

  const desafio = await Challenge.findById(challengeId);

  if (!desafio) {
    throw new Error("Desafio não encontrado");
  }

  return desafio;
}

app.post("/api/login", async (req, res) => {
  try {
    const { login, senha } = req.body;

    if (!login || !senha) {
      return res.status(400).json({ error: "Login e senha são obrigatórios" });
    }

    // login pode ser username OU email
    const user = await User.findOne({
      $or: [
        { username: login.toLowerCase() },
        { email: login.toLowerCase() }
      ]
    }).select("+senhaHash");

    if (!user) {
      return res.status(401).json({ error: "Usuário ou senha inválidos" });
    }

    const senhaOk = await bcrypt.compare(senha, user.senhaHash);
    if (!senhaOk) {
      return res.status(401).json({ error: "Usuário ou senha inválidos" });
    }

    // Gerar token JWT
    const token = jwt.sign(
      {
        userId: user._id,
        username: user.username
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login realizado com sucesso",
      token,
      email: user.email, // 👈 ADICIONE
    });

  } catch (err) {
    console.error("Erro no login:", err);
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

app.get("/api/teste-email", async (req, res) => {
  try {
    await transporter.sendMail({
      from: `"Teste" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: "Teste de e-mail",
      text: "Se você recebeu isso, o Nodemailer está funcionando!"
    });

    res.send("E-mail enviado com sucesso!");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao enviar e-mail");
  }
});

app.get("/api/status-jogador", auth, async (req, res) => {
  const user = await User.findById(req.userId);

  res.json({
    status: user.status || "ativo",
    rodadaEliminacao: user.rodadaEliminacao || null,
    emailConfirmado: user.emailConfirmado // 👈 LINHA QUE FALTAVA
  });
});

app.get("/admin/teste", auth, authAdmin, (req, res) => {
  res.json({ message: "Admin OK" });
});

app.post("/api/reenviar-verificacao", auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    if (user.emailConfirmado) {
      return res.status(400).json({ error: "Conta já verificada" });
    }

    const emailToken = crypto.randomBytes(32).toString("hex");
    const emailTokenExpira = Date.now() + 1000 * 60 * 60 * 24;

    user.emailToken = emailToken;
    user.emailTokenExpira = emailTokenExpira;
    await user.save();

    const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const linkVerificacao = `${BASE_URL}/api/verify-email?token=${emailToken}`;


    await transporter.sendMail({
      from: `"Campeonato" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: "Confirme seu e-mail",
      html: `
        <h2>Confirme seu e-mail</h2>
        <p><a href="${linkVerificacao}">Confirmar e-mail</a></p>
      `
    });

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao reenviar e-mail" });
  }
});




// 📋 Listar todos os desafios (admin)
// ADMIN — listar TODOS os desafios
app.get("/admin/challenges", auth, authAdmin, async (req, res) => {
  try {
    const challenges = await Challenge.find()
      .sort({ temporada: -1, tipo: 1 });

    res.json(challenges);
  } catch (err) {
    console.error("Erro ao listar desafios:", err);
    res.status(500).json({ error: "Erro ao listar desafios" });
  }
});


// ➕ Criar novo desafio (admin)
app.post("/admin/challenges", auth, authAdmin, async (req, res) => {
  try {
    const {
      nome,
      tipo,
      temporada,
      rodadaInicial,
      rodadaFinal,
      dataInicio,
      dataFim
    } = req.body;

    if (!nome || !tipo || !temporada) {
      return res.status(400).json({
        error: "Campos obrigatórios: nome, tipo, temporada"
      });
    }

    const challenge = await Challenge.create({
      nome,
      tipo, // "turno" | "returno"
      temporada,

      rodadaInicial,
      rodadaFinal,
      rodadaAtual: rodadaInicial,

      status: "iniciando", // aguardando | ativo | iniciando | encerrado
      visivel: false,

      dataInicio,
      dataFim
    });

    res.status(201).json(challenge);
  } catch (err) {
    console.error("Erro ao criar desafio:", err);
    res.status(500).json({ error: "Erro ao criar desafio" });
  }
});

// ✏️ Atualizar desafio (admin manda em tudo)
app.put("/admin/challenges/:id", auth, authAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const update = req.body;

    const challenge = await Challenge.findByIdAndUpdate(
      id,
      update,
      { new: true }
    );

    if (!challenge) {
      return res.status(404).json({ error: "Desafio não encontrado" });
    }

    res.json(challenge);
  } catch (err) {
    console.error("Erro ao atualizar desafio:", err);
    res.status(500).json({ error: "Erro ao atualizar desafio" });
  }
});

app.get("/admin/dashboard", auth, authAdmin, async (req, res) => {
  try {
    const desafio = await resolverDesafioAdmin(req);

    // ==========================
    // 1️⃣ Jogadores que iniciaram
    // ==========================
    const iniciaram = await Palpite.distinct("userId", {
      challengeId: desafio._id,
      rodada: desafio.rodadaInicial
    });

    const totalIniciaram = iniciaram.length;

    // ==========================
    // 2️⃣ Eliminados (desafio)
    // ==========================
    const eliminados = await User.countDocuments({
      status: "eliminado",
      rodadaEliminacao: { $ne: null }
    });

    // ==========================
    // 3️⃣ Vivos
    // ==========================
    const vivos = Math.max(totalIniciaram - eliminados, 0);

    // ==========================
    // 4️⃣ Usuários cadastrados (global)
    // ==========================
    const totalUsuarios = await User.countDocuments();

    // ==========================
    // 5️⃣ Palpites (do desafio)
    // ==========================
    const totalPalpites = await Palpite.countDocuments({
      challengeId: desafio._id
    });

    res.json({
      usuarios: {
        total: totalUsuarios,
        iniciaram: totalIniciaram,
        vivos,
        eliminados
      },
      palpites: {
        total: totalPalpites
      },
      campeonato: {
        nome: desafio.nome,
        tipo: desafio.tipo,
        rodadaAtual: desafio.rodadaAtual,
        status: desafio.status
      }
    });

  } catch (err) {
    console.error("Erro /admin/dashboard:", err.message);
    res.status(400).json({ error: err.message });
  }
});


app.get("/admin/times-mais-palpites", auth, authAdmin, async (req, res) => {
  try {
    const desafio = await resolverDesafioAdmin(req);

    const resultado = await Palpite.aggregate([
      {
        $match: {
          challengeId: desafio._id
        }
      },
      {
        $group: {
          _id: "$time",
          total: { $sum: 1 }
        }
      },
      {
        $sort: {
          total: -1
        }
      }
    ]);

    res.json(resultado);

  } catch (err) {
    console.error("Erro /admin/times-mais-palpites:", err.message);
    res.status(400).json({ error: err.message });
  }
});

app.get("/admin/paths", auth, authAdmin, async (req, res) => {
  try {
    const desafio = await resolverDesafioAdmin(req);

    // 1️⃣ Palpites SOMENTE do desafio
    const palpites = await Palpite.find({
      challengeId: desafio._id
    }).sort({ rodada: 1 });

    // 2️⃣ Agrupar por usuário
    const pathsPorUsuario = {};

    for (const p of palpites) {
      if (!pathsPorUsuario[p.userId]) {
        pathsPorUsuario[p.userId] = [];
      }

      pathsPorUsuario[p.userId].push({
        rodada: p.rodada,
        time: p.time
      });
    }

    // 3️⃣ Agrupar paths idênticos
    const mapaPaths = {};

    for (const [userId, path] of Object.entries(pathsPorUsuario)) {
      const chave = path.map(p => `${p.rodada}-${p.time}`).join("|");

      if (!mapaPaths[chave]) {
        mapaPaths[chave] = {
          path,
          usuarios: []
        };
      }

      mapaPaths[chave].usuarios.push(userId);
    }

    // 4️⃣ Resolver usuários
    const resultado = [];

    for (const grupo of Object.values(mapaPaths)) {
      const usuarios = await User.find(
        { _id: { $in: grupo.usuarios } },
        "username status rodadaEliminacao"
      );

      resultado.push({
        quantidade: usuarios.length,
        path: grupo.path,
        usuarios
      });
    }

    // 5️⃣ Ordenar por risco
    resultado.sort((a, b) => b.quantidade - a.quantidade);

    res.json(resultado);

  } catch (err) {
    console.error("Erro /admin/paths:", err.message);
    res.status(400).json({ error: err.message });
  }
});

app.get("/admin/palpites", auth, authAdmin, async (req, res) => {
  try {
    const desafio = await resolverDesafioAdmin(req);

    const palpites = await Palpite.aggregate([
      {
        $match: {
          challengeId: desafio._id
        }
      },
      {
        $lookup: {
          from: User.collection.name,
          localField: "userId",
          foreignField: "_id",
          as: "usuario"
        }
      },
      {
        $unwind: {
          path: "$usuario",
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          rodada: 1,
          time: 1,
          createdAt: 1,
          username: "$usuario.username",
          status: "$usuario.status"
        }
      },
      {
        $sort: {
          rodada: 1,
          createdAt: 1
        }
      }
    ]);

    res.json(palpites);

  } catch (err) {
    console.error("Erro /admin/palpites:", err.message);
    res.status(400).json({ error: err.message });
  }
});

app.get("/admin/insights", auth, authAdmin, async (req, res) => {
  try {
    // 🔹 Times mais escolhidos
    const timesMaisPalpites = await Palpite.aggregate([
      { $group: { _id: "$time", total: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 3 }
    ]);

    // 🔹 Paths por usuário
    const paths = await Palpite.aggregate([
      { $sort: { rodada: 1 } },
      {
        $group: {
          _id: "$userId",
          path: { $push: "$time" }
        }
      }
    ]);

    // 🔹 Agrupar paths iguais
    const contadorPaths = {};
    paths.forEach(p => {
      const chave = p.path.join(" > ");
      contadorPaths[chave] = (contadorPaths[chave] || 0) + 1;
    });

    const pathsIdenticos = Object.entries(contadorPaths)
      .map(([path, total]) => ({ path, total }))
      .sort((a, b) => b.total - a.total);

    // 🔹 Heurística simples de risco
    let risco = "baixo";
    if (pathsIdenticos[0]?.total >= 5) risco = "alto";
    else if (pathsIdenticos[0]?.total >= 3) risco = "medio";

    res.json({
      timesMaisPalpites,
      pathsIdenticos: pathsIdenticos.slice(0, 3),
      risco
    });

  } catch (err) {
    console.error("Erro insights admin:", err);
    res.status(500).json({ error: "Erro ao gerar insights" });
  }
});

app.get("/admin/usuarios", auth, authAdmin, async (req, res) => {
  try {
    const challengeId = req.headers["x-challenge-id"];
    if (!challengeId) {
      return res.status(400).json({ error: "X-CHALLENGE-ID não informado" });
    }

    const challengeObjectId = new mongoose.Types.ObjectId(challengeId);

    const usuarios = await User.aggregate([
      {
        $lookup: {
          from: "palpites",
          let: { userId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$userId", "$$userId"] },
                    { $eq: ["$challengeId", challengeObjectId] }
                  ]
                }
              }
            }
          ],
          as: "palpites"
        }
      },
      {
        $addFields: {
          totalPalpites: { $size: "$palpites" }
        }
      },
      {
        $project: {
          nome: 1,
          sobrenome: 1,
          username: 1,
          email: 1,
          dataNascimento: 1,
          timeCoracao: 1,
          status: 1,
          rodadaEliminacao: 1,
          role: 1,
          createdAt: 1,
          totalPalpites: 1
        }
      },
      { $sort: { createdAt: 1 } }
    ]);

    res.json(usuarios);

  } catch (err) {
    console.error("Erro ao buscar usuários admin:", err);
    res.status(500).json({ error: "Erro ao buscar usuários" });
  }
});

app.get("/api/index/estatisticas", auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const desafio = await resolverDesafio(req, user);

    if (!desafio) {
      return res.status(404).json({ error: "Desafio não encontrado" });
    }

    // =====================
    // JOGADORES
    // =====================
    const usuarios = await User.aggregate([
      {
        $lookup: {
          from: "palpites",
          let: { userId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$userId", "$$userId"] },
                    { $eq: ["$challengeId", desafio._id] }
                  ]
                }
              }
            }
          ],
          as: "palpites"
        }
      }
    ]);

    const iniciaram = usuarios.filter(u =>
      u.palpites.some(p => p.rodada === desafio.rodadaInicial)
    ).length;

    const eliminados = usuarios.filter(u => u.status === "eliminado").length;
    const vivos = iniciaram - eliminados;

    const percentualVivos =
      iniciaram > 0 ? Math.round((vivos / iniciaram) * 100) : 0;

    // =====================
    // ÚLTIMA RODADA FINALIZADA
    // =====================
    const rodada = desafio.rodadaAtual - 1;

    const palpitesRodada = await Palpite.find({
      challengeId: desafio._id,
      rodada
    });

    // eliminações na rodada
    const eliminadosRodada = await User.countDocuments({
      status: "eliminado",
      rodadaEliminacao: rodada
    });

    // times mais escolhidos
    const topTimes = await Palpite.aggregate([
      {
        $match: {
          challengeId: desafio._id,
          rodada
        }
      },
      {
        $group: {
          _id: "$time",
          total: { $sum: 1 }
        }
      },
      { $sort: { total: -1 } },
      { $limit: 3 }
    ]);

    // time mais mortal
    const mortosPorTime = {};
    const usuariosEliminados = await User.find({
      status: "eliminado",
      rodadaEliminacao: rodada
    });

    usuariosEliminados.forEach(u => {
      const palpite = palpitesRodada.find(
        p => p.userId.toString() === u._id.toString()
      );
      if (palpite) {
        mortosPorTime[palpite.time] =
          (mortosPorTime[palpite.time] || 0) + 1;
      }
    });

    const timeMortal = Object.entries(mortosPorTime)
      .sort((a, b) => b[1] - a[1])[0];

    res.json({
      desafio: {
            rodadaAtual: desafio.rodadaAtual,
    rodadaInicial: desafio.rodadaInicial,
    rodadaResumo: rodada
      },
      jogadores: {
        iniciaram,
        vivos,
        eliminados,
        percentualVivos
      },
      rodada: {
        eliminados: eliminadosRodada,
        topTimes,
        timeMortal: timeMortal
          ? `${timeMortal[0]} causou ${timeMortal[1]} eliminações`
          : "—"
      }
    });

  } catch (err) {
    console.error("Erro index estatísticas:", err);
    res.status(500).json({ error: "Erro ao carregar estatísticas" });
  }
});

// 🔁 fallback para frontend (Render / produção)
app.get("/*", (req, res) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/admin")) {
    return res.status(404).json({ error: "Rota não encontrada" });
  }

  res.sendFile(path.join(__dirname, "public", "index.html"));
});



  // 8️⃣ Iniciar servidor
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  });

  