const crypto = require('crypto');

// Génère un token CSRF dans la session et l'expose aux templates
function generateToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

// Vérifie le token sur les requêtes POST
function verifyToken(req, res, next) {
  const token = req.body && req.body._csrf;
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).send('Token CSRF invalide.');
  }
  next();
}

module.exports = { generateToken, verifyToken };
