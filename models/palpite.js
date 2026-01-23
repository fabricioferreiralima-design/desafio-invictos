const mongoose = require("mongoose");

const PalpiteSchema = new mongoose.Schema({
  rodada: { type: Number, required: true },
  time: { type: String, required: true },
   userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  createdAt: { type: Date, default: Date.now },
  challengeId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "Challenge",
  required: false // 👈 MUITO IMPORTANTE
}

});

module.exports = mongoose.model("Palpite", PalpiteSchema);
