const mongoose = require("mongoose");

const PlayerChallengeSchema = new mongoose.Schema({

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  challengeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Challenge",
    required: true
  },

  status: {
    type: String,
    enum: ["ativo", "eliminado"],
    default: "ativo"
  },

  rodadaEliminacao: {
    type: Number,
    default: null
  },

  iniciou: {
    type: Boolean,
    default: false
  },

  createdAt: {
    type: Date,
    default: Date.now
  }

});

// 🔐 garante 1 registro por usuário + desafio
PlayerChallengeSchema.index(
  { userId: 1, challengeId: 1 },
  { unique: true }
);

module.exports = mongoose.model("PlayerChallenge", PlayerChallengeSchema);
