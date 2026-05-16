function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  if (!req.session.isAdmin) return res.status(403).redirect('/');
  next();
}

function requireCurator(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  if (!req.session.isCurator && !req.session.isAdmin) return res.status(403).redirect('/');
  next();
}

module.exports = { requireLogin, requireAdmin, requireCurator };
