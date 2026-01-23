const jwt = require("jsonwebtoken");

function auth(req, res, next) {
  const authHeader = req.headers.authorization;

  // 1️⃣ Verifica se o header existe
  if (!authHeader) {
    return res.status(401).json({ error: "Token não fornecido" });
  }

  // 2️⃣ Verifica formato: "Bearer TOKEN"
  const parts = authHeader.split(" ");

  if (parts.length !== 2) {
    return res.status(401).json({ error: "Token mal formatado" });
  }

  const [scheme, token] = parts;

  if (!/^Bearer$/i.test(scheme)) {
    return res.status(401).json({ error: "Token mal formatado" });
  }

  // 3️⃣ Verifica e decodifica o token
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 4️⃣ Anexa dados do usuário na requisição
    req.userId = decoded.userId;
    req.username = decoded.username;

    // 5️⃣ Libera acesso
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

module.exports = auth;
