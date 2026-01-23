const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  nome: {
    type: String,
    required: true,
    minlength: 2,
    maxlength: 50
  },

  sobrenome: {
    type: String,
    required: true,
    minlength: 2,
    maxlength: 50
  },

  username: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    minlength: 6
  },

  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },

  senhaHash: {
    type: String,
    required: true
  },

  cpf: {
    type: String,
    required: true,
    unique: true,
    select: false
  },

  dataNascimento: {
    type: Date,
    required: true
  },

  timeCoracao: {
    type: String
  },

  genero: {
    type: String,
    enum: ["masculino", "feminino", "outro", "prefiro_nao_informar"]
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  emailConfirmado: {
  type: Boolean,
  default: false
},

emailToken: {
  type: String
},

emailTokenExpira: {
  type: Date
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

role: {
  type: String,
  enum: ["user", "admin"],
  default: "user"
}



});

module.exports = mongoose.model("User", UserSchema);
