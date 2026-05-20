const express = require('express');
const db = require('../db/database');
const { verifyToken } = require('../middleware/csrf');
const { sendAdminAlert } = require('../lib/mailer');

const router = express.Router();

const insertOptout = db.prepare(`
  INSERT INTO optout_requests (url, name, email, reason) VALUES (?, ?, ?, ?)
`);
const checkOptout = db.prepare(
  "SELECT id FROM optout_requests WHERE url = ? AND status = 'pending'"
);

const _strip = s => s.replace(/<[^>]*>/g, '');

router.get('/about', (req, res) => {
  res.render('about', {
    title: req.t('about_title'),
    ogDescription: _strip(req.t('about_s1_body')),
  });
});

router.get('/legal', (req, res) => {
  res.render('legal', {
    title: req.t('legal_title'),
    ogDescription: _strip(req.t('legal_s1_body')),
  });
});

router.get('/privacy', (req, res) => {
  res.render('privacy', {
    title: req.t('privacy_title'),
    ogDescription: _strip(req.t('privacy_s1_body')),
  });
});

router.get('/optout', (req, res) => {
  res.render('optout', {
    title: req.t('optout_title'),
    ogDescription: _strip(req.t('optout_desc')),
    success: req.query.success === '1',
    error: req.query.error || null,
  });
});

router.post('/optout', verifyToken, (req, res) => {
  const { url, name, email, reason } = req.body;

  if (!url || !email) return res.redirect('/optout?error=fields');

  try {
    new URL(url);
  } catch {
    return res.redirect('/optout?error=url');
  }

  if (checkOptout.get(url)) return res.redirect('/optout?error=already');

  insertOptout.run(url.trim(), name?.trim() || null, email.trim(), reason?.trim() || null);

  sendAdminAlert(
    `Nouvelle demande de retrait`,
    `URL : ${url.trim()}\nDe : ${name?.trim() || '—'} <${email.trim()}>\nRaison : ${reason?.trim() || '—'}\n\nTraiter : /admin/optout`
  ).catch(() => {});

  res.redirect('/optout?success=1');
});

module.exports = router;
