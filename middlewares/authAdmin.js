const User = require("../models/user");

module.exports = async function authAdmin(req, res, next) {
  try {
    const userId = req.userId;
    const user = await User.findById(userId);

    if (!user || user.role !== "admin") {
      return res.status(403).json({
        error: "Acesso restrito ao administrador"
      });
    }

    next();
  } catch (err) {
    return res.status(500).json({
      error: "Erro ao validar administrador"
    });
  }
};
