require("dotenv").config();
const mongoose = require("mongoose");
const Palpite = require("../models/palpite");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);

  const orfaos = await Palpite.find({
    $or: [
      { challengeId: null },
      { challengeId: { $exists: false } }
    ]
  });

  console.log("Palpites sem challenge:", orfaos.length);

  for (const p of orfaos) {
    console.log("Removendo:", p._id, p.time, p.rodada);
    await Palpite.deleteOne({ _id: p._id });
  }

  console.log("✅ Limpeza concluída");
  process.exit();
}

run();
