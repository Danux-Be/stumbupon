const express = require('express');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const { verifyToken } = require('../middleware/csrf');

const router = express.Router();

const queryCatsForSites = db.prepare(`
  SELECT sc.site_id, c.emoji, COALESCE(ct.name, c.name) AS localName
  FROM site_categories sc
  JOIN categories c ON c.id = sc.category_id
  LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
  WHERE sc.site_id IN (SELECT value FROM json_each(?))
  ORDER BY localName
`);

router.get('/admin', requireAdmin, (req, res) => {
  const stats = {
    users:     db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    banned:    db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_banned = 1').get().n,
    sites:     db.prepare("SELECT COUNT(*) AS n FROM sites WHERE status='approved'").get().n,
    pending:   db.prepare("SELECT COUNT(*) AS n FROM sites WHERE status='pending'").get().n,
    votes:     db.prepare('SELECT COUNT(*) AS n FROM votes').get().n,
    reports:   db.prepare(
      "SELECT COUNT(DISTINCT site_id) AS n FROM reports WHERE resolved=0"
    ).get().n,
    quarantine: db.prepare("SELECT COUNT(*) AS n FROM sites WHERE status='quarantine'").get().n,
    optout: db.prepare("SELECT COUNT(*) AS n FROM optout_requests WHERE status='pending'").get().n,
  };
  res.render('admin/dashboard', {
    title: req.t('admin_title'),
    stats,
  });
});

router.get('/admin/pending', requireAdmin, (req, res) => {
  const lang = res.locals.currentLang;
  const sites = db.prepare(`
    SELECT s.*, u.username AS submitter
    FROM sites s
    LEFT JOIN users u ON u.id = s.submitted_by
    WHERE s.status = 'pending'
    ORDER BY s.created_at ASC
  `).all();

  let catsBySite = {};
  if (sites.length) {
    const ids = JSON.stringify(sites.map(s => s.id));
    const rows = queryCatsForSites.all(lang, ids);
    for (const row of rows) {
      if (!catsBySite[row.site_id]) catsBySite[row.site_id] = [];
      catsBySite[row.site_id].push({ emoji: row.emoji, localName: row.localName });
    }
  }

  res.render('admin/pending', {
    title: req.t('admin_pending_title'),
    sites,
    catsBySite,
  });
});

router.post('/admin/approve/:id', requireAdmin, verifyToken, (req, res) => {
  db.prepare(
    "UPDATE sites SET status='approved', approved_at=CURRENT_TIMESTAMP WHERE id=?"
  ).run(req.params.id);
  res.redirect('/admin/pending');
});

router.post('/admin/reject/:id', requireAdmin, verifyToken, (req, res) => {
  db.prepare("UPDATE sites SET status='rejected' WHERE id=?").run(req.params.id);
  res.redirect('/admin/pending');
});

router.get('/admin/reports', requireAdmin, (req, res) => {
  const lang = res.locals.currentLang;

  const sites = db.prepare(`
    SELECT s.*, u.username AS submitter,
           COUNT(r.id) AS report_count,
           MAX(r.created_at) AS last_report_at
    FROM reports r
    JOIN sites s ON s.id = r.site_id
    LEFT JOIN users u ON u.id = s.submitted_by
    WHERE r.resolved = 0
    GROUP BY s.id
    ORDER BY report_count DESC, last_report_at DESC
  `).all();

  const reportsBySite = {};
  if (sites.length) {
    const ids = JSON.stringify(sites.map(s => s.id));
    const rows = db.prepare(`
      SELECT r.site_id, r.reason, u.username AS reporter, r.created_at
      FROM reports r
      LEFT JOIN users u ON u.id = r.reported_by
      WHERE r.resolved = 0 AND r.site_id IN (SELECT value FROM json_each(?))
      ORDER BY r.created_at DESC
    `).all(ids);
    for (const row of rows) {
      if (!reportsBySite[row.site_id]) reportsBySite[row.site_id] = [];
      reportsBySite[row.site_id].push(row);
    }

    const catRows = queryCatsForSites.all(lang, ids);
    for (const row of catRows) {
      const site = sites.find(s => s.id === row.site_id);
      if (site) {
        if (!site.cats) site.cats = [];
        site.cats.push({ emoji: row.emoji, localName: row.localName });
      }
    }
  }

  res.render('admin/reports', {
    title: req.t('admin_reports_title'),
    sites,
    reportsBySite,
  });
});

router.post('/admin/resolve/:id', requireAdmin, verifyToken, (req, res) => {
  db.prepare('UPDATE reports SET resolved=1 WHERE site_id=?').run(req.params.id);
  db.prepare(
    "UPDATE sites SET status='approved' WHERE id=? AND status='quarantine'"
  ).run(req.params.id);
  res.redirect('/admin/reports');
});

router.post('/admin/dismiss/:id', requireAdmin, verifyToken, (req, res) => {
  db.prepare('UPDATE reports SET resolved=1 WHERE site_id=?').run(req.params.id);
  db.prepare("UPDATE sites SET status='rejected' WHERE id=?").run(req.params.id);
  res.redirect('/admin/reports');
});

router.get('/admin/bot', requireAdmin, (req, res) => {
  const sourceStats = db.prepare(`
    SELECT source,
           COUNT(*) AS total,
           SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved,
           SUM(CASE WHEN status='pending'  THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected,
           MAX(processed_at) AS last_run
    FROM bot_processed
    GROUP BY source
    ORDER BY last_run DESC
  `).all();

  const recent = db.prepare(`
    SELECT * FROM bot_processed
    ORDER BY processed_at DESC
    LIMIT 30
  `).all();

  res.render('admin/bot', {
    title: req.t('admin_bot_title'),
    sourceStats,
    recent,
  });
});

// ── Gestion utilisateurs ─────────────────────────────────────────────────────

router.get('/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.email, u.is_admin, u.is_banned,
           u.email_verified, u.created_at,
           COUNT(DISTINCT s.id)  AS site_count,
           COUNT(DISTINCT v.rowid) AS vote_count
    FROM users u
    LEFT JOIN sites s ON s.submitted_by = u.id
    LEFT JOIN votes v ON v.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();

  res.render('admin/users', {
    title: req.t('admin_users_title'),
    users,
    currentUserId: req.session.userId,
  });
});

router.post('/admin/users/:id/ban', requireAdmin, verifyToken, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.userId) return res.redirect('/admin/users');
  db.prepare('UPDATE users SET is_banned = 1 WHERE id = ?').run(id);
  // Invalide toutes les sessions actives de l'utilisateur banni
  db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(id);
  res.redirect('/admin/users');
});

router.post('/admin/users/:id/unban', requireAdmin, verifyToken, (req, res) => {
  db.prepare('UPDATE users SET is_banned = 0 WHERE id = ?').run(req.params.id);
  res.redirect('/admin/users');
});

router.post('/admin/users/:id/promote', requireAdmin, verifyToken, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.userId) return res.redirect('/admin/users');
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(id);
  res.redirect('/admin/users');
});

router.post('/admin/users/:id/demote', requireAdmin, verifyToken, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.userId) return res.redirect('/admin/users');
  db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(id);
  res.redirect('/admin/users');
});

router.get('/admin/optout', requireAdmin, (req, res) => {
  const requests = db.prepare(`
    SELECT * FROM optout_requests ORDER BY created_at DESC
  `).all();
  res.render('admin/optout', {
    title: req.t('admin_optout_title'),
    requests,
  });
});

router.post('/admin/optout/:id/approve', requireAdmin, verifyToken, (req, res) => {
  const row = db.prepare('SELECT url FROM optout_requests WHERE id = ?').get(req.params.id);
  if (row) {
    db.prepare("UPDATE sites SET status='rejected' WHERE url = ?").run(row.url);
    db.prepare("UPDATE optout_requests SET status='done' WHERE id = ?").run(req.params.id);
  }
  res.redirect('/admin/optout');
});

router.post('/admin/optout/:id/reject', requireAdmin, verifyToken, (req, res) => {
  db.prepare("UPDATE optout_requests SET status='rejected' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/optout');
});

module.exports = router;
