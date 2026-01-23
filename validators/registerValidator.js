const Joi = require("joi");

const registerSchema = Joi.object({
  nome: Joi.string().min(2).max(50).required(),
  sobrenome: Joi.string().min(2).max(50).required(),

  username: Joi.string()
    .pattern(/^[a-z0-9_]{6,20}$/)
    .required(),

  email: Joi.string().email().required(),

  senha: Joi.string()
    .min(6)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
    .required(),

  cpf: Joi.string().length(11).required(),

  dataNascimento: Joi.date().required(),

  timeCoracao: Joi.string().optional(),

  genero: Joi.string()
    .valid("masculino", "feminino", "outro", "prefiro_nao_informar")
    .optional()
});

module.exports = registerSchema;
