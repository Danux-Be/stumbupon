const express = require('express');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');
const { verifyToken } = require('../middleware/csrf');
const { validateUrl } = require('../lib/validators');
const { enrichUrl } = require('../lib/enricher');
const { verifyTurnstile } = require('../lib/turnstile');

const router = express.Router();

function getCategories(lang) {
  return db.prepare(`
    SELECT c.id, c.emoji, COALESCE(ct.name, c.name) AS localName
    FROM categories c
    LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
    ORDER BY localName
  `).all(lang);
}

const insertSite = db.prepare(`
  INSERT INTO sites (url, title, description, status, language, risk_score, submitted_by)
  VALUES (@url, @title, @description, 'pending', @language, @risk_score, @submitted_by)
`);

const insertSiteCat = db.prepare(
  'INSERT OR IGNORE INTO site_categories (site_id, category_id) VALUES (?, ?)'
);

function checkSubmitLimits(userId) {
  const now = new Date();
  const dayAgo  = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  const daily = db.prepare(
    "SELECT COUNT(*) AS n FROM sites WHERE submitted_by=? AND created_at >= ?"
  ).get(userId, dayAgo).n;
  if (daily >= 3) return 'error_submit_daily_limit';

  const weekly = db.prepare(
    "SELECT COUNT(*) AS n FROM sites WHERE submitted_by=? AND created_at >= ?"
  ).get(userId, weekAgo).n;
  if (weekly >= 10) return 'error_submit_weekly_limit';

  // Nouveau compte (< 30 jours) : max 1 soumission en attente
  const user = db.prepare('SELECT created_at FROM users WHERE id=?').get(userId);
  if (user && user.created_at >= monthAgo) {
    const pending = db.prepare(
      "SELECT COUNT(*) AS n FROM sites WHERE submitted_by=? AND status='pending'"
    ).get(userId).n;
    if (pending >= 1) return 'error_submit_pending_limit';
  }

  return null;
}

router.get('/submit', requireLogin, (req, res) => {
  const lang = res.locals.currentLang;
  const user = db.prepare('SELECT email_verified FROM users WHERE id=?').get(req.session.userId);
  res.render('submit', {
    title: req.t('submit_title'),
    categories: getCategories(lang),
    error: req.query.error || null,
    success: req.query.success || null,
    prefill: {},
    emailVerified: !!user?.email_verified,
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null,
  });
});

router.post('/submit', requireLogin, verifyToken, async (req, res) => {
  const lang = res.locals.currentLang;
  const userId = req.session.userId;
  const { url, title, description } = req.body;
  let chosen = req.body.categories || [];
  if (!Array.isArray(chosen)) chosen = [chosen];
  chosen = chosen.map(Number).filter(Boolean);

  const categories = getCategories(lang);

  const fail = (key) => res.render('submit', {
    title: req.t('submit_title'),
    categories,
    error: req.t(key),
    success: null,
    prefill: { url, title, description, chosen },
    emailVerified: true,
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null,
  });

  // Email doit être vérifié
  const user = db.prepare('SELECT email_verified FROM users WHERE id=?').get(userId);
  if (!user?.email_verified) return fail('error_submit_unverified');

  // Captcha
  const turnstileOk = await verifyTurnstile(req.body['cf-turnstile-response']);
  if (!turnstileOk) return fail('error_captcha');

  if (!url) return fail('error_fields_required');

  const urlError = validateUrl(url.trim());
  if (urlError) return fail(urlError);

  if (chosen.length < 1) return fail('error_submit_categories');

  const limitError = checkSubmitLimits(userId);
  if (limitError) return fail(limitError);

  const { title: fetchedTitle, language: fetchedLang, riskScore } = await enrichUrl(url.trim());

  const finalTitle = (title && title.trim()) || fetchedTitle || url;
  const finalLang = fetchedLang || 'en';

  const info = insertSite.run({
    url: url.trim(),
    title: finalTitle.slice(0, 200),
    description: description ? description.trim().slice(0, 500) : null,
    language: finalLang,
    risk_score: riskScore,
    submitted_by: userId,
  });

  for (const catId of chosen) {
    insertSiteCat.run(info.lastInsertRowid, catId);
  }

  res.redirect('/submit?success=1');
});

module.exports = router;
