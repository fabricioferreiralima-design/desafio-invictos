const mongoose = require("mongoose");

const ChallengeSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  tipo: {
    type: String,
    enum: ["turno", "returno"],
    required: true
  },
  temporada: { type: Number, required: true },

  rodadaInicial: { type: Number, required: true },
  rodadaFinal: { type: Number, required: true },
  rodadaAtual: { type: Number, required: true },

  status: {
    type: String,
    enum: ["iniciando", "ativo", "aguardando", "finalizado"],
    default: "iniciando"
  },

  visivel: { type: Boolean, default: true },

  dataInicio: Date,
  dataFim: Date,

    rodadasProcessadas: {
    type: [Number],
    default: []
  },

  createdAt: {
    type: Date,
    default: Date.now
  }

  
});

module.exports = mongoose.model("Challenge", ChallengeSchema);
