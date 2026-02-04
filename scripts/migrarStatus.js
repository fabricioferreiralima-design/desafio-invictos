require("dotenv").config();
const mongoose = require("mongoose");

const User = require("../models/user");
const Challenge = require("../models/Challenge");
const PlayerChallenge = require("../models/PlayerChallenge");

async function migrar() {

  await mongoose.connect(process.env.MONGODB_URI);

  const desafios = await Challenge.find();
  const usuarios = await User.find();

  for (const desafio of desafios) {
    for (const user of usuarios) {

      await PlayerChallenge.findOneAndUpdate(
        {
          userId: user._id,
          challengeId: desafio._id
        },
        {
          $setOnInsert: {
            status: user.status || "ativo",
            rodadaEliminacao: user.rodadaEliminacao || null
          }
        },
        { upsert: true }
      );

    }
  }

  console.log("✅ Migração concluída");
  process.exit();
}

migrar();
