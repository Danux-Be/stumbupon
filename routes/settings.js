const express = require('express');
const bcrypt  = require('bcrypt');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const db      = require('../db/database');
const { requireLogin } = require('../middleware/auth');
const { verifyToken }  = require('../middleware/csrf');
const crypto           = require('crypto');
const { sendEmailChangeEmail } = require('../lib/mailer');
const { checkAndGrant, getUserAchievements } = require('../lib/achievements');

const router = express.Router();
const BCRYPT_ROUNDS = 12;

const AVATAR_DIR = path.join(__dirname, '../public/avatars');
const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXT_MAP = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const avatarStorage = multer.diskStorage({
  destination: AVATAR_DIR,
  filename: (req, file, cb) => {
    const ext = EXT_MAP[file.mimetype] || '.jpg';
    cb(null, `${req.session.userId}${ext}`);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: AVATAR_MAX_BYTES },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype)),
});

function getCategories(lang) {
  return db.prepare(`
    SELECT c.id, c.emoji, COALESCE(ct.name, c.name) AS localName
    FROM categories c
    LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
    ORDER BY localName
  `).all(lang);
}

const ALL_LANGS = ['fr', 'en', 'nl', 'de', 'es', 'it', 'pt', 'da', 'pl', 'ru', 'el', 'zh', 'ja', 'ar'];

router.get('/settings', requireLogin, (req, res) => {
  const lang = res.locals.currentLang;
  const categories = getCategories(lang);
  const selected = db.prepare(
    'SELECT category_id FROM user_interests WHERE user_id = ?'
  ).all(req.session.userId).map(r => r.category_id);

  const user = db.prepare('SELECT content_languages, email_digest, include_videos, avatar, username, username_changes_this_year, username_year, email, pending_email FROM users WHERE id = ?').get(req.session.userId);
  const rawLangs = user?.content_languages;
  const contentLangs = (!rawLangs || rawLangs === 'all')
    ? [...ALL_LANGS]
    : rawLangs.split(',').filter(Boolean);

  const currentYear = new Date().getFullYear();
  const usernameChangesLeft = (user?.username_year === currentYear)
    ? Math.max(0, 2 - (user?.username_changes_this_year || 0))
    : 2;

  res.render('settings', {
    title: req.t('settings_title'),
    categories,
    selected,
    contentLangs,
    allLangs: ALL_LANGS,
    emailDigest: user?.email_digest !== 0,
    includeVideos: user?.include_videos !== 0,
    currentUsername: user?.username || req.session.username,
    currentEmail: user?.email || '',
    pendingEmail: user?.pending_email || null,
    avatarUrl: user?.avatar ? `/avatars/${user.avatar}` : null,
    usernameChangesLeft,
    achievements: getUserAchievements(req.session.userId),
    success: req.query.success || null,
    error: req.query.error || null,
  });
});

router.post('/settings/interests', requireLogin, verifyToken, (req, res) => {
  let chosen = req.body.categories || [];
  if (!Array.isArray(chosen)) chosen = [chosen];
  chosen = chosen.map(Number).filter(Boolean);

  if (chosen.length < 3) return res.redirect('/settings?error=interests-min');

  const replace = db.transaction((userId, ids) => {
    db.prepare('DELETE FROM user_interests WHERE user_id = ?').run(userId);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO user_interests (user_id, category_id) VALUES (?, ?)'
    );
    for (const id of ids) insert.run(userId, id);
  });

  replace(req.session.userId, chosen);
  const newAch1 = checkAndGrant(req.session.userId);
  if (newAch1.length) req.session._achievements_flash = newAch1;
  res.redirect('/settings?success=interests');
});

router.post('/settings/content-languages', requireLogin, verifyToken, (req, res) => {
  let chosen = req.body.langs || [];
  if (!Array.isArray(chosen)) chosen = [chosen];
  chosen = chosen.filter(l => ALL_LANGS.includes(l));

  const value = chosen.length === 0 || chosen.length === ALL_LANGS.length ? 'all' : chosen.join(',');
  db.prepare('UPDATE users SET content_languages = ? WHERE id = ?').run(value, req.session.userId);
  res.redirect('/settings?success=content_langs');
});

router.post('/settings/digest', requireLogin, verifyToken, (req, res) => {
  const value = req.body.digest === '1' ? 1 : 0;
  db.prepare('UPDATE users SET email_digest = ? WHERE id = ?').run(value, req.session.userId);
  res.redirect('/settings?success=digest');
});

router.post('/settings/videos', requireLogin, verifyToken, (req, res) => {
  const value = req.body.videos === '1' ? 1 : 0;
  db.prepare('UPDATE users SET include_videos = ? WHERE id = ?').run(value, req.session.userId);
  res.redirect('/settings?success=videos');
});

router.post('/settings/password', requireLogin, verifyToken, async (req, res) => {
  const { current, newpass, confirm } = req.body;
  const t = req.t.bind(req);

  const fail = (key) => res.redirect(`/settings?error=${encodeURIComponent(t(key))}`);

  if (!current || !newpass || !confirm) return fail('error_password_fields');
  if (newpass.length < 8)              return fail('error_new_password_short');
  if (newpass !== confirm)             return fail('error_passwords_mismatch');

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
  const match = await bcrypt.compare(current, user.password_hash);
  if (!match) return fail('error_current_password_wrong');

  const hash = await bcrypt.hash(newpass, BCRYPT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);
  res.redirect('/settings?success=password');
});

// ── Avatar ────────────────────────────────────────────────────────────────────

router.post('/settings/avatar', requireLogin, avatarUpload.single('avatar'), verifyToken, (req, res) => {
  if (!req.file) return res.redirect('/settings?error=' + encodeURIComponent(req.t('error_avatar_invalid')));

  // Supprimer l'ancien avatar s'il diffère du nouveau
  const old = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.session.userId)?.avatar;
  if (old && old !== req.file.filename) {
    const oldPath = path.join(AVATAR_DIR, old);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(req.file.filename, req.session.userId);
  const newAch2 = checkAndGrant(req.session.userId);
  if (newAch2.length) req.session._achievements_flash = newAch2;
  res.redirect('/settings?success=avatar#compte');
});

router.post('/settings/avatar/delete', requireLogin, verifyToken, (req, res) => {
  const row = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.session.userId);
  if (row?.avatar) {
    const p = path.join(AVATAR_DIR, row.avatar);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(req.session.userId);
  }
  res.redirect('/settings?success=avatar#compte');
});

// ── Pseudo ────────────────────────────────────────────────────────────────────

router.post('/settings/username', requireLogin, verifyToken, (req, res) => {
  const newUsername = (req.body.username || '').trim();
  const t = req.t.bind(req);
  const fail = (key) => res.redirect(`/settings?error=${encodeURIComponent(t(key))}#compte`);

  if (!newUsername) return fail('error_username_empty');
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(newUsername)) return fail('error_username_invalid');

  const user = db.prepare('SELECT username, username_changes_this_year, username_year FROM users WHERE id = ?').get(req.session.userId);
  if (newUsername === user.username) return res.redirect('/settings?success=username#compte');

  const currentYear = new Date().getFullYear();
  const sameYear    = user.username_year === currentYear;
  const usedChanges = sameYear ? (user.username_changes_this_year || 0) : 0;
  if (usedChanges >= 2) return fail('error_username_limit');

  const taken = db.prepare('SELECT 1 FROM users WHERE username = ? AND id != ?').get(newUsername, req.session.userId);
  if (taken) return fail('error_user_exists');

  db.prepare('UPDATE users SET username = ?, username_changes_this_year = ?, username_year = ? WHERE id = ?')
    .run(newUsername, usedChanges + 1, currentYear, req.session.userId);

  req.session.username = newUsername;
  res.redirect('/settings?success=username#compte');
});

// ── Changement d'email ────────────────────────────────────────────────────────

router.post('/settings/email', requireLogin, verifyToken, async (req, res) => {
  const newEmail = (req.body.email || '').trim().toLowerCase();
  const t = req.t.bind(req);
  const fail = (key) => res.redirect(`/settings?error=${encodeURIComponent(t(key))}#compte`);

  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return fail('error_email_invalid');

  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
  if (newEmail === user.email) return res.redirect('/settings?error=' + encodeURIComponent(t('error_email_same')) + '#compte');

  const taken = db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(newEmail, req.session.userId);
  if (taken) return fail('error_email_taken');

  const token   = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h

  db.prepare('UPDATE users SET pending_email = ?, email_change_token = ?, email_change_expires = ? WHERE id = ?')
    .run(newEmail, token, expires, req.session.userId);

  const lang = res.locals.currentLang || 'fr';
  sendEmailChangeEmail(newEmail, req.session.username, token, lang).catch(err => {
    console.error('Email change mail error:', err);
  });

  res.redirect('/settings?success=email_pending#compte');
});

router.get('/verify-email-change/:token', requireLogin, (req, res) => {
  const { token } = req.params;
  const user = db.prepare(
    'SELECT id, pending_email, email_change_expires FROM users WHERE email_change_token = ? AND id = ?'
  ).get(token, req.session.userId);

  if (!user) return res.redirect('/settings?error=' + encodeURIComponent(req.t('error_token_invalid')) + '#compte');
  if (new Date(user.email_change_expires) < new Date()) {
    return res.redirect('/settings?error=' + encodeURIComponent(req.t('error_token_expired')) + '#compte');
  }

  db.prepare('UPDATE users SET email = ?, pending_email = NULL, email_change_token = NULL, email_change_expires = NULL WHERE id = ?')
    .run(user.pending_email, req.session.userId);

  res.redirect('/settings?success=email_changed#compte');
});

module.exports = router;
