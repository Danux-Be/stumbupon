function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || !req.session.isAdmin) {
    return res.status(403).render('error', {
      title: 'Accès refusé',
      message: 'Cette page est réservée aux administrateurs.',
    });
  }
  next();
}

module.exports = { requireLogin, requireAdmin };
