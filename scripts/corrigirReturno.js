require("dotenv").config();
const mongoose = require("mongoose");
const PlayerChallenge = require("../models/PlayerChallenge");
const Challenge = require("../models/Challenge");
const Palpite = require("../models/palpite");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);

  const returno = await Challenge.findOne({ tipo: "returno" });

  if (!returno) {
    console.log("❌ Returno não encontrado");
    process.exit();
  }

  const pcs = await PlayerChallenge.find({
    challengeId: returno._id,
    status: "eliminado"
  });

  let corrigidos = 0;

  for (const pc of pcs) {

    // Ver se o usuário REALMENTE perdeu no returno
    const palpites = await Palpite.find({
      userId: pc.userId,
      challengeId: returno._id
    });

    // Se não tem palpites no returno → NÃO pode estar eliminado
    if (palpites.length === 0) {
      pc.status = "ativo";
      pc.rodadaEliminacao = null;
      await pc.save();
      corrigidos++;
      continue;
    }

    // Se tem palpites, vamos deixar a avaliação decidir depois
    pc.status = "ativo";
    pc.rodadaEliminacao = null;
    await pc.save();
    corrigidos++;
  }

  console.log("✅ Corrigidos:", corrigidos);
  process.exit();
}

run();
