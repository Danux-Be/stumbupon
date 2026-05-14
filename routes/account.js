const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');
const { verifyToken } = require('../middleware/csrf');

const router = express.Router();

const getUser = db.prepare(
  'SELECT id, username, email, language, created_at, password_hash FROM users WHERE id = ?'
);
const getInterests = db.prepare(`
  SELECT c.slug, c.name, COALESCE(ui.weight, 1.0) AS weight
  FROM user_interests ui
  JOIN categories c ON c.id = ui.category_id
  WHERE ui.user_id = ?
  ORDER BY c.name
`);
const getVotes = db.prepare(`
  SELECT s.url, s.title, v.direction, v.created_at
  FROM votes v
  JOIN sites s ON s.id = v.site_id
  WHERE v.user_id = ?
  ORDER BY v.created_at DESC
`);
const getSubmissions = db.prepare(`
  SELECT url, title, status, created_at
  FROM sites WHERE submitted_by = ?
  ORDER BY created_at DESC
`);
const deleteUser = db.prepare('DELETE FROM users WHERE id = ?');
const deleteUserSessions = db.prepare(
  "DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?"
);

router.get('/account/export', requireLogin, (req, res) => {
  const userId = req.session.userId;
  const user = getUser.get(userId);
  if (!user) return res.redirect('/');

  const payload = {
    exported_at: new Date().toISOString(),
    user: {
      username: user.username,
      email: user.email,
      language: user.language,
      created_at: user.created_at,
    },
    interests: getInterests.all(userId),
    votes: getVotes.all(userId),
    submitted_sites: getSubmissions.all(userId),
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="stumbleclone-${user.username}-${Date.now()}.json"`
  );
  res.send(JSON.stringify(payload, null, 2));
});

router.post('/account/delete', requireLogin, verifyToken, async (req, res) => {
  const userId = req.session.userId;
  const { password } = req.body;

  if (!password) return res.redirect('/settings?error=fields');

  const user = getUser.get(userId);
  if (!user) return res.redirect('/settings');

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.redirect('/settings?error=delete_password_wrong');

  // Supprimer les sessions en DB puis détruire la session courante
  deleteUserSessions.run(userId);
  deleteUser.run(userId);

  req.session.destroy(() => {
    res.redirect('/?deleted=1');
  });
});

module.exports = router;
