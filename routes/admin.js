const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const { verifyToken } = require('../middleware/csrf');
const { enrichUrl } = require('../lib/enricher');
const siteConfig   = require('../lib/config');

const BOT_DIR  = path.join(__dirname, '..');
const LOG_FILE = path.join(BOT_DIR, 'logs/bot.log');
const PID_FILE = path.join(BOT_DIR, 'logs/bot.pid');

const VALID_SOURCES = new Set(['all','hn','wiby','lobsters','reddit','marginalia','github','neocities','pinboard','metafilter','tildes','kbclub','searchmysite','crawler']);

function isBotRunning() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLastLogLines(n = 60) {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    return lines.slice(-n);
  } catch {
    return [];
  }
}

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
    optout:   db.prepare("SELECT COUNT(*) AS n FROM optout_requests WHERE status='pending'").get().n,
    flagged:  db.prepare("SELECT COUNT(*) AS n FROM sites WHERE status='flagged'").get().n,
    referers: db.prepare("SELECT COUNT(*) AS n FROM referer_queue WHERE status='pending'").get().n,
    comments: db.prepare('SELECT COUNT(*) AS n FROM comments').get().n,
    noEmbed:  db.prepare("SELECT COUNT(*) AS n FROM sites WHERE can_embed=0 AND status='approved'").get().n,
  };
  res.render('admin/dashboard', {
    title: req.t('admin_title'),
    stats,
  });
});

const PENDING_PAGE_SIZE = 20;

router.get('/admin/pending', requireAdmin, (req, res) => {
  const lang  = res.locals.currentLang;
  const page  = Math.max(1, parseInt(req.query.page || '1', 10));

  const total = db.prepare("SELECT COUNT(*) AS n FROM sites WHERE status='pending'").get().n;
  const totalPages = Math.ceil(total / PENDING_PAGE_SIZE);
  const offset = (page - 1) * PENDING_PAGE_SIZE;

  const lowRiskCount = db.prepare(
    "SELECT COUNT(*) AS n FROM sites WHERE status='pending' AND (risk_score IS NULL OR risk_score <= 30)"
  ).get().n;

  const sites = db.prepare(`
    SELECT s.*, u.username AS submitter
    FROM sites s
    LEFT JOIN users u ON u.id = s.submitted_by
    WHERE s.status = 'pending'
    ORDER BY s.created_at ASC
    LIMIT ? OFFSET ?
  `).all(PENDING_PAGE_SIZE, offset);

  const allCategories = db.prepare('SELECT id, slug, name, emoji FROM categories ORDER BY name').all();

  let catsBySite = {};
  let catIdsBySite = {};
  if (sites.length) {
    const ids = JSON.stringify(sites.map(s => s.id));
    const rows = queryCatsForSites.all(lang, ids);
    const idRows = db.prepare(
      'SELECT site_id, category_id FROM site_categories WHERE site_id IN (SELECT value FROM json_each(?))'
    ).all(ids);
    for (const row of rows) {
      if (!catsBySite[row.site_id]) catsBySite[row.site_id] = [];
      catsBySite[row.site_id].push({ emoji: row.emoji, localName: row.localName });
    }
    for (const row of idRows) {
      if (!catIdsBySite[row.site_id]) catIdsBySite[row.site_id] = [];
      catIdsBySite[row.site_id].push(row.category_id);
    }
  }

  res.render('admin/pending', {
    title: req.t('admin_pending_title'),
    sites,
    catsBySite,
    catIdsBySite,
    allCategories,
    total,
    page,
    totalPages,
    lowRiskCount,
  });
});

router.post('/admin/pending/bulk-approve', requireAdmin, verifyToken, (req, res) => {
  db.prepare(`
    UPDATE sites SET status='approved', approved_at=CURRENT_TIMESTAMP
    WHERE status='pending' AND (risk_score IS NULL OR risk_score <= 30)
  `).run();
  res.redirect('/admin/pending');
});

router.post('/admin/pending/bulk-delete', requireAdmin, verifyToken, (req, res) => {
  db.prepare("DELETE FROM sites WHERE status='pending'").run();
  res.redirect('/admin/pending');
});

router.post('/admin/sites/delete-no-embed', requireAdmin, verifyToken, (req, res) => {
  db.prepare("DELETE FROM sites WHERE can_embed = 0").run();
  res.redirect('/admin');
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
    botRunning: isBotRunning(),
    logLines: readLastLogLines(60),
    launched: req.query.launched === '1',
    alreadyRunning: req.query.busy === '1',
  });
});

router.post('/admin/bot/run', requireAdmin, verifyToken, (req, res) => {
  if (isBotRunning()) return res.redirect('/admin/bot?busy=1');

  const source = VALID_SOURCES.has(req.body.source) ? req.body.source : 'all';
  const limit  = Math.min(Math.max(parseInt(req.body.limit || '20', 10), 1), 200);
  const seeds  = Math.min(Math.max(parseInt(req.body.seeds || '5', 10), 1), 20);

  const args = ['bot/index.js', `--source=${source}`, `--limit=${limit}`, `--seeds=${seeds}`];

  try {
    fs.mkdirSync(path.join(BOT_DIR, 'logs'), { recursive: true });
    const logFd = fs.openSync(LOG_FILE, 'a');
    const child = spawn(process.execPath, args, {
      cwd: BOT_DIR,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env },
    });
    fs.closeSync(logFd);
    fs.writeFileSync(PID_FILE, String(child.pid));
    child.unref();
  } catch (err) {
    console.error('Erreur lancement bot:', err);
  }

  res.redirect('/admin/bot?launched=1');
});

// ── Rejet rapide depuis la barre Stumble ──────────────────────────────────────

router.post('/admin/site/:id/reject', requireAdmin, verifyToken, (req, res) => {
  db.prepare("UPDATE sites SET status='rejected' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

router.post('/admin/site/:id/delete', requireAdmin, verifyToken, (req, res) => {
  db.prepare('DELETE FROM sites WHERE id=?').run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

// ── Correction de la langue détectée ─────────────────────────────────────────

router.post('/admin/site/:id/language', requireAdmin, verifyToken, (req, res) => {
  const lang = req.body.language || null;
  db.prepare('UPDATE sites SET language = ? WHERE id = ?').run(lang, req.params.id);
  const allowed = ['/admin/reports', '/admin/flagged', '/admin/pending'];
  const back = allowed.includes(req.body._redirect) ? req.body._redirect : '/admin/reports';
  res.redirect(back);
});

// ── Mise à jour langue + catégories (page pending) ────────────────────────────

router.post('/admin/site/:id/update', requireAdmin, verifyToken, (req, res) => {
  const id   = parseInt(req.params.id, 10);
  const lang = req.body.language || null;
  const cats = [].concat(req.body.categories || []).map(Number).filter(Boolean);

  db.prepare('UPDATE sites SET language = ? WHERE id = ?').run(lang, id);
  db.prepare('DELETE FROM site_categories WHERE site_id = ?').run(id);
  const ins = db.prepare('INSERT OR IGNORE INTO site_categories (site_id, category_id) VALUES (?, ?)');
  const tx  = db.transaction((ids) => { for (const cid of ids) ins.run(id, cid); });
  tx(cats);

  const allowed = ['/admin/reports', '/admin/flagged', '/admin/pending'];
  const back = allowed.includes(req.body._redirect) ? req.body._redirect : '/admin/pending';
  res.redirect(back);
});

// ── Sites flaggés (re-check morts/redirects) ──────────────────────────────────

router.get('/admin/flagged', requireAdmin, (req, res) => {
  const sites = db.prepare(`
    SELECT * FROM sites WHERE status = 'flagged'
    ORDER BY last_checked_at DESC
  `).all();
  res.render('admin/flagged', {
    title: req.t('admin_flagged_title'),
    sites,
  });
});

router.post('/admin/flagged/:id/restore', requireAdmin, verifyToken, (req, res) => {
  db.prepare("UPDATE sites SET status='approved', flag_reason=NULL WHERE id=?").run(req.params.id);
  res.redirect('/admin/flagged');
});

router.post('/admin/flagged/:id/reject', requireAdmin, verifyToken, (req, res) => {
  db.prepare("UPDATE sites SET status='rejected' WHERE id=?").run(req.params.id);
  res.redirect('/admin/flagged');
});

// ── Gestion utilisateurs ─────────────────────────────────────────────────────

router.get('/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.email, u.is_admin, u.is_banned, u.is_curator,
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

router.post('/admin/users/:id/make-curator', requireAdmin, verifyToken, (req, res) => {
  db.prepare('UPDATE users SET is_curator = 1 WHERE id = ?').run(Number(req.params.id));
  res.redirect('/admin/users');
});

router.post('/admin/users/:id/unmake-curator', requireAdmin, verifyToken, (req, res) => {
  db.prepare('UPDATE users SET is_curator = 0 WHERE id = ?').run(Number(req.params.id));
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

// ── Référencements entrants (Referer header) ──────────────────────────────────

router.get('/admin/referers', requireAdmin, (req, res) => {
  const items = db.prepare(`
    SELECT * FROM referer_queue
    WHERE status = 'pending'
    ORDER BY hits DESC, last_seen DESC
  `).all();
  res.render('admin/referers', {
    title: req.t('admin_referers_title'),
    items,
  });
});

router.post('/admin/referers/:id/approve', requireAdmin, verifyToken, async (req, res) => {
  const item = db.prepare('SELECT * FROM referer_queue WHERE id = ?').get(req.params.id);
  if (!item) return res.redirect('/admin/referers');

  const existing = db.prepare("SELECT 1 FROM sites WHERE url = ? LIMIT 1").get(item.url);
  if (!existing) {
    const enriched = await enrichUrl(item.url);
    if (enriched.sslError) {
      db.prepare("UPDATE referer_queue SET status='rejected' WHERE id = ?").run(item.id);
      return res.redirect('/admin/referers');
    }
    db.prepare(`
      INSERT OR IGNORE INTO sites (url, title, status, language, risk_score, imported_by)
      VALUES (?, ?, 'pending', ?, ?, 'referer')
    `).run(item.url, (enriched.title || item.url).slice(0, 200), enriched.language || null, enriched.riskScore);
  }

  db.prepare("UPDATE referer_queue SET status='approved' WHERE id = ?").run(item.id);
  res.redirect('/admin/referers');
});

router.post('/admin/referers/:id/reject', requireAdmin, verifyToken, (req, res) => {
  db.prepare("UPDATE referer_queue SET status='rejected' WHERE id = ?").run(req.params.id);
  res.redirect('/admin/referers');
});

router.post('/admin/referers/reject-all', requireAdmin, verifyToken, (req, res) => {
  db.prepare("UPDATE referer_queue SET status='rejected' WHERE status='pending'").run();
  res.redirect('/admin/referers');
});

// ── Modération des commentaires ───────────────────────────────────────────

router.get('/admin/comments', requireAdmin, (req, res) => {
  const comments = db.prepare(`
    SELECT c.id, c.body, c.created_at, c.user_id,
           u.username,
           s.id AS site_id, s.title AS site_title, s.url AS site_url
    FROM comments c
    JOIN users u ON u.id = c.user_id
    JOIN sites s ON s.id = c.site_id
    ORDER BY c.created_at DESC
    LIMIT 300
  `).all();

  res.render('admin/comments', {
    title: 'Commentaires',
    comments,
  });
});

router.post('/admin/comment/:id/delete', requireAdmin, verifyToken, (req, res) => {
  db.prepare('DELETE FROM comments WHERE id = ?').run(parseInt(req.params.id));
  res.redirect('/admin/comments');
});

// ── Re-vérification des iframes (can_embed) ──────────────────────────────
const SSL_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_CERT_COMMON_NAME_INVALID',
]);

router.post('/admin/recheck-embed', requireAdmin, verifyToken, async (req, res) => {
  const sites = db.prepare(
    "SELECT id, url FROM sites WHERE status = 'approved' ORDER BY RANDOM() LIMIT 50"
  ).all();

  const update = db.prepare('UPDATE sites SET can_embed = ? WHERE id = ?');
  let fixed = 0;

  for (const site of sites) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const r = await fetch(site.url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StumbUpon.comBot/1.0)' },
        redirect: 'follow',
      });
      clearTimeout(timer);

      const xfo = r.headers.get('x-frame-options') || '';
      const csp = r.headers.get('content-security-policy') || '';

      let canEmbed = 1;
      if (/deny|sameorigin/i.test(xfo)) canEmbed = 0;
      if (/frame-ancestors\s+['"]?none['"]?/i.test(csp)) canEmbed = 0;
      else if (/frame-ancestors/i.test(csp) && !/frame-ancestors[^;]*\*/i.test(csp)) canEmbed = 0;

      update.run(canEmbed, site.id);
      fixed++;
    } catch (err) {
      const code = err?.cause?.code || err?.code || '';
      if (SSL_ERROR_CODES.has(code)) {
        // Cert invalide → site rejeté définitivement
        db.prepare("UPDATE sites SET status='rejected' WHERE id=?").run(site.id);
        fixed++;
      }
      // Autre erreur (timeout, DNS) → on ne touche pas
    }
  }

  res.json({ checked: sites.length, updated: fixed });
});

// ── Configuration du site ────────────────────────────────────────────────
router.get('/admin/config', requireAdmin, (req, res) => {
  res.render('admin/config', {
    title: 'Configuration',
    config: siteConfig.getAll(),
    success: req.query.success === '1',
  });
});

router.post('/admin/config', requireAdmin, verifyToken, (req, res) => {
  siteConfig.set('less_of_this',        req.body.less_of_this        === '1' ? '1' : '0');
  siteConfig.set('guest_limit_enabled', req.body.guest_limit_enabled === '1' ? '1' : '0');
  const count = Math.max(1, Math.min(200, parseInt(req.body.guest_limit_count) || 5));
  siteConfig.set('guest_limit_count', String(count));
  res.redirect('/admin/config?success=1');
});

module.exports = router;
