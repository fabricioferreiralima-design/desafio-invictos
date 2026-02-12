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
  const { enviarEmailConfirmacao } = require("./utils/email");
  const authAdmin = require("./middlewares/authAdmin");
  const Challenge = require("./models/Challenge");
  const PlayerChallenge = require("./models/PlayerChallenge");
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

  // Se só existe 1, acabou
  if (desafios.length === 1) return desafios[0];

  const turno = desafios.find(d => d.tipo === "turno");
  const returno = desafios.find(d => d.tipo === "returno");

  // 🔥 NOVA LÓGICA BASEADA NO PLAYER CHALLENGE
  if (turno) {
    const pcTurno = await PlayerChallenge.findOne({
      userId: user._id,
      challengeId: turno._id
    });

    // Se nunca jogou turno OU ainda está ativo nele → fica no turno
    if (!pcTurno || pcTurno.status === "ativo") {
      return turno;
    }
  }

  // Se chegou aqui → está eliminado no turno → vai pro returno
  if (returno) {
    return returno;
  }

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


async function obterPlayerChallenge(userId, challengeId) {
  let pc = await PlayerChallenge.findOne({ userId, challengeId });

  if (!pc) {
    pc = await PlayerChallenge.create({
      userId,
      challengeId,
      status: "ativo"
    });
  }

  return pc;
}

async function avaliarStatusDoJogador(userId, challengeId) {

  const palpites = await Palpite.find({ userId, challengeId });

  for (const palpite of palpites) {

    const pc = await obterPlayerChallenge(
      userId,
      palpite.challengeId
    );

    // 🔐 Se já está eliminado NESSE desafio, ignora
    if (pc.status === "eliminado") continue;

    const rodada = palpite.rodada;

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

    const jogosRodada = dados.response.filter(j =>
      j.league.round === `Regular Season - ${rodada}`
    );

    const jogo = jogosRodada.find(j =>
      j.teams.home.name === palpite.time ||
      j.teams.away.name === palpite.time
    );

    if (!jogo) continue;

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

      pc.status = "eliminado";
      pc.rodadaEliminacao = rodada;

      await pc.save();

      // ❌ REMOVIDO O RETURN AQUI
    }
  }

  return true;
}

function obterChallengeIdAdmin(req) {
  const challengeId = req.headers["x-challenge-id"];
  if (!challengeId) {
    throw new Error("X-CHALLENGE-ID não informado");
  }
  return new mongoose.Types.ObjectId(challengeId);
}

function interpretarStatus(pc) {
  if (!pc) return "nao_inscrito";
  return pc.status;
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

    const desafios = await Challenge.find({
      status: { $in: ["ativo", "aguardando"] },
      visivel: true
    }).sort({ dataInicio: 1 });

    if (!desafios.length) {
      return res.status(404).json({ error: "Nenhum desafio ativo no momento" });
    }

    if (desafios.length === 1) {
      return res.json(desafios[0]);
    }

    const turno = desafios.find(d => d.tipo === "turno");
    const returno = desafios.find(d => d.tipo === "returno");

    // 🔥 AQUI ESTÁ A CHAVE
    if (turno) {
      const pcTurno = await PlayerChallenge.findOne({
        userId,
        challengeId: turno._id
      });

      // Se nunca jogou turno OU está ativo nele
   if (pcTurno && pcTurno.status === "ativo") {
  return res.json(turno);
}
    }

    // Se chegou aqui → eliminado no turno → vai pro returno
    if (returno) {
      return res.json(returno);
    }

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

// 👇 NOVO: status por desafio
const playerChallenge = await PlayerChallenge.findOne({
  userId: user._id,
  challengeId: desafioAtual._id
});

const statusJogador = interpretarStatus(playerChallenge);
const rodadaKill = playerChallenge?.rodadaEliminacao || null;

// ================================
// 🔎 DETECTAR PENDÊNCIA DO USUÁRIO
// ================================
let pendencia = null;

if (statusJogador === "ativo") {

  const cacheKey = "jogos-brasileirao-2025";
  const dados = cache.get(cacheKey);

  if (dados) {

    const palpitesUser = await Palpite.find({
      userId: user._id,
      challengeId: desafioAtual._id
    });

    for (const p of palpitesUser) {

      const jogo = dados.response.find(j =>
        j.league.round === `Regular Season - ${p.rodada}` &&
        (
          j.teams.home.name === p.time ||
          j.teams.away.name === p.time
        )
      );

      if (!jogo) continue;

      // 👉 SE O JOGO NÃO ESTÁ FINALIZADO
      if (jogo.fixture.status.short !== "FT") {
        pendencia = {
          rodada: p.rodada
        };
        break;
      }
    }
  }
}

// ================================
// 🔁 RETORNO ORIGINAL + PENDÊNCIA
// ================================
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
    status: statusJogador,
    rodadaEliminacao: rodadaKill,
    jaPalpitou,

    // 👉 NOVO CAMPO
    pendencia
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

/* ===========================
   2️⃣ Descobrir desafio atual PRIMEIRO
=========================== */
const desafioAtual = await resolverDesafio(req, user);

if (!desafioAtual) {
  return res.status(404).json({ error: "Nenhum desafio ativo" });
}

/* ===========================
   3️⃣ AGORA sim validar PlayerChallenge
=========================== */
const pc = await obterPlayerChallenge(userId, desafioAtual._id);

if (pc.status === "eliminado") {
  return res.status(403).json({
    error: "Você foi eliminado neste desafio e não pode mais palpitar."
  });
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

    // ================================
    // 1️⃣ BUSCAR PALPITES DO DESAFIO
    // ================================
    const palpites = await Palpite.find({
      userId,
      challengeId: desafioAtual._id
    }).sort({ rodada: 1 });

    // ================================
    // 2️⃣ BUSCAR STATUS NO PLAYER CHALLENGE
    // ================================
    const pc = await PlayerChallenge.findOne({
      userId,
      challengeId: desafioAtual._id
    });

    // ================================
    // 3️⃣ BUSCAR JOGOS (CACHE OU API)
    // ================================
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

    // ================================
    // 4️⃣ MONTAR LINHA NORMAL DOS PALPITES
    // ================================
    let linhaDoTempo = palpites.map(p => {
      const rodada = Number(p.rodada);
      const timeEscolhido = p.time;

      const jogosRodada = jogos.filter(j =>
        j.league &&
        j.league.round === `Regular Season - ${rodada}`
      );

      const jogo = jogosRodada.find(j =>
        j.teams.home.name === timeEscolhido ||
        j.teams.away.name === timeEscolhido
      );

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
      let placar = "⏳ Aguardando jogo...";

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
          status = "sobreviveu"; // empate = sobrevive
        }
      }

      return {
        rodada,
        time: timeEscolhido,
        placar,
        status
      };
    });

    // =====================================================
    // 5️⃣ 🔥 PARTE PRINCIPAL — ADICIONAR LINHA DE WO
    // =====================================================

if (
  pc?.status === "eliminado" &&
  pc?.rodadaEliminacao
) {
      const jaExiste = linhaDoTempo.some(
  item => Number(item.rodada) === Number(pc.rodadaEliminacao)
);

if (!jaExiste) {

  const foiPorWO = pc.motivo === "nao_palpitou";

  linhaDoTempo.push({
    rodada: pc.rodadaEliminacao,
    time: "—",

    placar: foiPorWO
      ? "Você não realizou palpite nesta rodada"
      : "Você não palpitou.",

    status: "eliminado",

    tipo: foiPorWO
      ? "nao_palpitou"
      : "resultado"
  });
}
    }

    // ================================
    // 6️⃣ ORDENAR NOVAMENTE
    // ================================
    linhaDoTempo.sort((a, b) => a.rodada - b.rodada);

    // ================================
    // 7️⃣ RETORNO FINAL
    // ================================
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

    try {
  await enviarEmailConfirmacao(
    user.email,
    user.nome,
    emailToken
  );
} catch (err) {
  console.error("⚠️ Email não enviado:", err.message);
}

res.status(201).json({
  ok: true,
  message: "Cadastro realizado com sucesso! Verifique seu e-mail."
});


  } catch (err) {
    console.error("❌ Erro no cadastro:", err);
    res.status(500).json({
      error: "Erro interno no servidor"
    });
  }
});

app.get("/api/verify-email", async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send("Token inválido");
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Confirmar e-mail</title>
      <meta charset="utf-8" />
      <style>
        body {
          font-family: Arial;
          background: #0f172a;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
        }
        .box {
          background: #020617;
          padding: 40px;
          border-radius: 12px;
          text-align: center;
          max-width: 400px;
        }
        button {
          background: #22c55e;
          border: none;
          padding: 12px 20px;
          font-size: 16px;
          border-radius: 6px;
          cursor: pointer;
          color: white;
        }
      </style>
    </head>
    <body>
      <div class="box">
        <h2>Confirmação de e-mail</h2>
        <p>Clique no botão abaixo para ativar sua conta.</p>

        <form method="POST" action="/api/verify-email">
          <input type="hidden" name="token" value="${token}" />
          <button type="submit">Confirmar e-mail</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post(
  "/api/verify-email",
  express.urlencoded({ extended: true }),
  async (req, res) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).send("Token não enviado");
      }

      const user = await User.findOne({
        emailToken: token,
        emailTokenExpira: { $gt: Date.now() }
      });

      if (!user) {
        return res.status(400).send("Token inválido ou expirado");
      }

      user.emailConfirmado = true;
      user.emailToken = undefined;
      user.emailTokenExpira = undefined;
      await user.save();

      res.send(`
        <h2 style="color:green">✅ E-mail confirmado com sucesso!</h2>
        <p>Agora você pode voltar ao site e fazer login.</p>
      `);
    } catch (err) {
      console.error(err);
      res.status(500).send("Erro interno ao confirmar e-mail");
    }
  }
);



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

async function fecharRodada(desafio) {
  const rodada = desafio.rodadaAtual-1;

  console.log("🔒 Fechando rodada", rodada);

  // 🔒 TRAVA DE SEGURANÇA
  if (desafio.rodadasProcessadas?.includes(rodada)) {
    console.log("⚠️ Rodada já processada, ignorando");
    return;
  }

  desafio.rodadasProcessadas.push(rodada);
  await desafio.save();

  // ============================================
  // 1️⃣ QUEM PALPITOU → regra normal
  // ============================================

  const palpites = await Palpite.find({
    challengeId: desafio._id,
    rodada
  });

  const userIds = [...new Set(palpites.map(p => p.userId.toString()))];

  for (const userId of userIds) {
    await avaliarStatusDoJogador(userId, desafio._id);
  }

  // ============================================
  // 2️⃣ 🔥 PARTE NOVA — QUEM NÃO PALPITOU
  // ============================================

  const ativos = await PlayerChallenge.find({
    challengeId: desafio._id,
    status: "ativo"
  });

  for (const pc of ativos) {

    const temPalpite = await Palpite.exists({
      userId: pc.userId,
      challengeId: desafio._id,
      rodada
    });

    if (!temPalpite) {

      pc.status = "eliminado";
      pc.rodadaEliminacao = rodada;
      pc.motivo = "nao_palpitou";

      await pc.save();

      console.log(
        `❌ Usuário ${pc.userId} eliminado por NÃO palpitar na rodada ${rodada}`
      );
    }
  }

  console.log("✅ Rodada avaliada com sucesso");
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


app.get("/api/status-jogador", auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    const desafioAtual = await resolverDesafio(req, user);

    if (!desafioAtual) {
      return res.json({
        status: "ativo",
        rodadaEliminacao: null,
        emailConfirmado: user.emailConfirmado
      });
    }

    const pc = await PlayerChallenge.findOne({
      userId: user._id,
      challengeId: desafioAtual._id
    });

res.json({
  status: interpretarStatus(pc),
  rodadaEliminacao: pc?.rodadaEliminacao || null,
  emailConfirmado: user.emailConfirmado
});

  } catch (err) {
    console.error("Erro em /api/status-jogador:", err);
    res.status(500).json({ error: "Erro ao buscar status do jogador" });
  }
});


app.get("/admin/teste", auth, authAdmin, (req, res) => {
  res.json({ message: "Admin OK" });
});

app.post("/admin/migrar-status", auth, authAdmin, async (req, res) => {
  try {
    console.log("🚧 INICIANDO MIGRAÇÃO USER → PLAYER CHALLENGE");

    const desafios = await Challenge.find();
    const usuarios = await User.find();

    let criados = 0;
    let atualizados = 0;
    let ignorados = 0;

    for (const user of usuarios) {

      // 1️⃣ Buscar palpites do usuário
      const palpites = await Palpite.find({ userId: user._id });

      if (!palpites.length) {
        ignorados++;
        continue;
      }

      // 2️⃣ Agrupar por desafio
      const desafiosDoUser = [...new Set(
        palpites.map(p => p.challengeId.toString())
      )];

      for (const challengeId of desafiosDoUser) {

        const desafio = desafios.find(
          d => d._id.toString() === challengeId
        );

        if (!desafio) continue;

        // 3️⃣ Já existe PlayerChallenge?
        let pc = await PlayerChallenge.findOne({
          userId: user._id,
          challengeId
        });

        if (!pc) {
          pc = new PlayerChallenge({
            userId: user._id,
            challengeId,
            status: "ativo"
          });
          criados++;
        } else {
          atualizados++;
        }

        // 4️⃣ Se usuário está eliminado GLOBAL,
        // precisamos decidir SE foi nesse desafio
        if (
          user.status === "eliminado" &&
          user.rodadaEliminacao
        ) {

          // verificar se ele tinha palpite nessa rodada dentro desse desafio
          const palpiteKill = palpites.find(p =>
            p.challengeId.toString() === challengeId &&
            p.rodada === user.rodadaEliminacao
          );

          if (palpiteKill) {
            pc.status = "eliminado";
            pc.rodadaEliminacao = user.rodadaEliminacao;
          }
        }

        await pc.save();
      }
    }

    res.json({
      ok: true,
      resumo: {
        criados,
        atualizados,
        ignorados
      }
    });

  } catch (err) {
    console.error("❌ ERRO MIGRAÇÃO:", err);
    res.status(500).json({ error: err.message });
  }
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


 try {
  await enviarEmailConfirmacao(
    user.email,
    user.nome,
    emailToken
  );
} catch (err) {
  console.error("⚠️ Erro ao reenviar email:", err.message);
}


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

    const desafioAntes = await Challenge.findById(id);

const challenge = await Challenge.findByIdAndUpdate(
  id,
  update,
  { new: true }
);

// 🔥 transição aguardando → ativo OU → finalizado
if (
  desafioAntes.status === "aguardando" &&
  ["ativo", "finalizado"].includes(challenge.status)
) {
  await fecharRodada(challenge);
}


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

   // 2️⃣ Eliminados NO DESAFIO (PlayerChallenge)
const eliminados = await PlayerChallenge.countDocuments({
  challengeId: desafio._id,
  status: "eliminado"
});


   // 3️⃣ Vivos (REGRA CORRETA)
const vivos = await PlayerChallenge.countDocuments({
  challengeId: desafio._id,
  status: "ativo"
});
    // ==========================
// 3.1️⃣ Cálculo de PENDENTES (regra oficial)
// ==========================
let pendentes = 0;

if (desafio.status !== "finalizado") {

  // 🔹 todos os jogadores ativos do desafio
  const ativosPC = await PlayerChallenge.find({
    challengeId: desafio._id,
    status: "ativo"
  });

  const cacheKey = "jogos-brasileirao-2025";
  const dados = cache.get(cacheKey);

  if (dados) {

    for (const pc of ativosPC) {

      // TODOS os palpites do jogador nesse desafio
      const palpitesUser = await Palpite.find({
        userId: pc.userId,
        challengeId: desafio._id
      });

      let temJogoAberto = false;

      for (const p of palpitesUser) {

  // 🚨 REGRA PRINCIPAL:
  // IGNORA PALPITES DA RODADA ATUAL OU FUTURA
  if (p.rodada >= desafio.rodadaAtual) {
    continue;
  }

  const jogo = dados.response.find(j =>
    j.league.round === `Regular Season - ${p.rodada}` &&
    (
      j.teams.home.name === p.time ||
      j.teams.away.name === p.time
    )
  );

  if (!jogo) continue;

  // ✅ AGORA SIM: pendência = jogo antigo NÃO FINALIZADO
  if (jogo.fixture.status.short !== "FT") {
    temJogoAberto = true;
    break;
  }
}


      if (temJogoAberto) {
        pendentes++;
      }
    }
  }
}

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
        eliminados,
        pendentes
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
      const usuarios = await PlayerChallenge.aggregate([
  {
    $match: {
      challengeId: desafio._id,
      userId: { $in: grupo.usuarios.map(id => new mongoose.Types.ObjectId(id)) }
    }
  },
  {
    $lookup: {
      from: "users",
      localField: "userId",
      foreignField: "_id",
      as: "u"
    }
  },
  { $unwind: "$u" },
  {
    $project: {
      username: "$u.username",
      status: "$status",
      rodadaEliminacao: "$rodadaEliminacao"
    }
  }
]);


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

  // 1️⃣ Somente do desafio atual
  {
    $match: {
      challengeId: desafio._id
    }
  },

  // 2️⃣ Join com USER (para username)
  {
    $lookup: {
      from: "users",
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

  // 3️⃣ Join com PLAYER CHALLENGE (NOVO!)
  {
    $lookup: {
      from: "playerchallenges",
      let: { uid: "$userId" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$userId", "$$uid"] },
                { $eq: ["$challengeId", desafio._id] }
              ]
            }
          }
        }
      ],
      as: "pc"
    }
  },

  {
    $unwind: {
      path: "$pc",
      preserveNullAndEmptyArrays: true
    }
  },

  // 4️⃣ PROJEÇÃO FINAL (preservando tudo que você já usava)
  {
    $project: {
      rodada: 1,
      time: 1,
      createdAt: 1,

      username: "$usuario.username",

      // 🔥 AGORA CORRETO POR DESAFIO
      status: "$pc.status"
    }
  },

  // 5️⃣ Ordenação original preservada
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
  $lookup: {
    from: "playerchallenges",
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
    as: "pc"
  }
},
{ $unwind: { path: "$pc", preserveNullAndEmptyArrays: true } },

      {
        $project: {
  nome: 1,
  sobrenome: 1,
  username: 1,
  email: 1,
  dataNascimento: 1,
  timeCoracao: 1,

  status: {
    $ifNull: ["$pc.status", "nao_inscrito"]
  },

  rodadaEliminacao: "$pc.rodadaEliminacao",

  // 🔥 NOVO CAMPO
  wo: {
    $cond: [
      {
        $and: [
          { $eq: ["$pc.status", "eliminado"] },
          { $eq: ["$pc.motivo", "nao_palpitou"] }
        ]
      },
      true,
      false
    ]
  },

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

app.post("/admin/reprocessar-pendentes", auth, authAdmin, async (req, res) => {
  try {

    const desafio = await resolverDesafioAdmin(req);

    const cacheKey = "jogos-brasileirao-2025";
    const dados = cache.get(cacheKey);

    if (!dados) {
      return res.status(400).json({
        error: "Cache de jogos não carregado"
      });
    }

    const palpites = await Palpite.find({
      challengeId: desafio._id
    });

    const rodadasComPendencia = new Set();

    for (const p of palpites) {

      const jogo = dados.response.find(j =>
        j.league.round === `Regular Season - ${p.rodada}` &&
        (
          j.teams.home.name === p.time ||
          j.teams.away.name === p.time
        )
      );

      if (!jogo) continue;

      // 👉 Se jogo já virou FT → pode reprocessar essa rodada
      if (jogo.fixture.status.short === "FT") {
        rodadasComPendencia.add(p.rodada);
      }
    }

    const processadas = [];

    for (const rodada of rodadasComPendencia) {

      // evita duplo processamento
      if (desafio.rodadasProcessadas?.includes(rodada)) {
        continue;
      }

      desafio.rodadaAtual = rodada + 1;
      await fecharRodada(desafio);

      processadas.push(rodada);
    }

    res.json({
      ok: true,
      rodadasProcessadas: processadas
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


app.get("/admin/pendentes/detalhe", auth, authAdmin, async (req, res) => {
  try {
    const desafio = await resolverDesafioAdmin(req);

    const ativos = await PlayerChallenge.find({
      challengeId: desafio._id,
      status: "ativo"
    });

    const cacheKey = "jogos-brasileirao-2025";
    const dados = cache.get(cacheKey);

    const resultado = [];

    for (const pc of ativos) {

      const user = await User.findById(pc.userId);

      const palpites = await Palpite.find({
        userId: pc.userId,
        challengeId: desafio._id
      });

      for (const p of palpites) {

          // 🔥 REGRA OFICIAL IGUAL AO DASHBOARD
  if (p.rodada >= desafio.rodadaAtual) {
    continue;
  }

        const jogo = dados?.response.find(j =>
          j.league.round === `Regular Season - ${p.rodada}` &&
          (
            j.teams.home.name === p.time ||
            j.teams.away.name === p.time
          )
        );

        if (!jogo) continue;

        if (jogo.fixture.status.short !== "FT") {

          resultado.push({
            usuario: user.username,
            rodada: p.rodada,
            time: p.time,

            jogo: `${jogo.teams.home.name} x ${jogo.teams.away.name}`,

            statusJogo: jogo.fixture.status.long || "Aguardando",

            data: jogo.fixture.date
          });
        }
      }
    }

    res.json(resultado);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
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
const iniciaramIds = await Palpite.distinct("userId", {
  challengeId: desafio._id,
  rodada: desafio.rodadaInicial
});

const iniciaram = iniciaramIds.length;


    // 🔁 eliminados DO DESAFIO
    const eliminados = await PlayerChallenge.countDocuments({
      challengeId: desafio._id,
      status: "eliminado"
    });

    const vivos = await PlayerChallenge.countDocuments({
  challengeId: desafio._id,
  status: "ativo"
});

    const percentualVivos =
      iniciaram > 0 ? Math.round((vivos / iniciaram) * 100) : 0;

    // ======================================================
    // 🔥 CÁLCULO DOS PENDENTES (PARTE NOVA DE VERDADE)
    // ======================================================

    let pendentes = 0;

    const ativos = await PlayerChallenge.find({
      challengeId: desafio._id,
      status: "ativo"
    });

    for (const pc of ativos) {

      const palpitesUser = await Palpite.find({
        userId: pc.userId,
        challengeId: desafio._id
      });

      let temPendencia = false;

      for (const p of palpitesUser) {

  if (p.rodada >= desafio.rodadaAtual) continue;

  const cacheKey = "jogos-brasileirao-2025";
  const dados = cache.get(cacheKey);

  if (!dados) continue;

  const jogo = dados.response.find(j =>
    j.league.round === `Regular Season - ${p.rodada}` &&
    (
      j.teams.home.name === p.time ||
      j.teams.away.name === p.time
    )
  );

  if (jogo && jogo.fixture.status.short !== "FT") {
    temPendencia = true;
    break;
  }
}


      if (temPendencia) pendentes++;
    }

    // =====================
    // ÚLTIMA RODADA FINALIZADA
    // =====================
    const rodada = desafio.rodadaAtual - 1;

    const palpitesRodada = await Palpite.find({
      challengeId: desafio._id,
      rodada
    });

    const eliminadosRodada = await PlayerChallenge.countDocuments({
      challengeId: desafio._id,
      status: "eliminado",
      rodadaEliminacao: rodada
    });

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

    const mortosPorTime = {};
    const pcsEliminados = await PlayerChallenge.find({
      challengeId: desafio._id,
      status: "eliminado",
      rodadaEliminacao: rodada
    });

    pcsEliminados.forEach(pc => {
      const palpite = palpitesRodada.find(
        p => p.userId.toString() === pc.userId.toString()
      );

      if (palpite) {
        mortosPorTime[palpite.time] =
          (mortosPorTime[palpite.time] || 0) + 1;
      }
    });

    const timeMortal = Object.entries(mortosPorTime)
      .sort((a, b) => b[1] - a[1])[0];

    // =====================
    // ✅ RESPOSTA FINAL
    // =====================
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
        pendentes,          // ✅ agora existe de verdade
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

app.get("/admin/rodada/:rodada/pendencias", auth, authAdmin, async (req, res) => {
  try {
    const rodada = Number(req.params.rodada);
    const desafio = await resolverDesafioAdmin(req);

    const palpites = await Palpite.find({
      challengeId: desafio._id,
      rodada
    });

    const cacheKey = "jogos-brasileirao-2025";
    let dados = cache.get(cacheKey);

    const jogosRodada = dados.response.filter(j =>
      j.league.round === `Regular Season - ${rodada}`
    );

    let pendentes = 0;
    let resolvidos = 0;

    for (const p of palpites) {
      const jogo = jogosRodada.find(j =>
        j.teams.home.name === p.time ||
        j.teams.away.name === p.time
      );

      if (!jogo) continue;

      if (jogo.fixture.status.short === "FT") {
        resolvidos++;
      } else {
        pendentes++;
      }
    }

    res.json({
      rodada,
      total: palpites.length,
      resolvidos,
      pendentes
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

  // 8️⃣ Iniciar servidor
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  });
