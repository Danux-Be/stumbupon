const express = require('express');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');
const { verifyToken } = require('../middleware/csrf');
const { sendAdminAlert } = require('../lib/mailer');

const router = express.Router();

const QUARANTINE_THRESHOLD = 3;

const hasReported = db.prepare(
  'SELECT id FROM reports WHERE site_id = ? AND reported_by = ?'
);

const insertReport = db.prepare(
  'INSERT INTO reports (site_id, reported_by, reason) VALUES (?, ?, ?)'
);

const countReports = db.prepare(
  'SELECT COUNT(DISTINCT reported_by) AS n FROM reports WHERE site_id = ? AND resolved = 0'
);

const quarantineSite = db.prepare(
  "UPDATE sites SET status = 'quarantine' WHERE id = ? AND status = 'approved'"
);

router.post('/report/:id', requireLogin, verifyToken, (req, res) => {
  const siteId = parseInt(req.params.id, 10);
  const userId = req.session.userId;
  const reason = (req.body.reason || '').trim().slice(0, 500) || null;

  if (!siteId) return res.redirect('/stumble');

  // Un seul signalement par user/site
  if (hasReported.get(siteId, userId)) {
    return res.redirect(`/stumble/${siteId}?reported=already`);
  }

  insertReport.run(siteId, userId, reason);

  const { n } = countReports.get(siteId);
  if (n >= QUARANTINE_THRESHOLD) {
    quarantineSite.run(siteId);
    const site = db.prepare('SELECT url, title FROM sites WHERE id = ?').get(siteId);
    sendAdminAlert(
      `Site mis en quarantaine — ${n} signalements`,
      `Le site "${site?.title}" a été mis en quarantaine automatiquement.\nURL : ${site?.url}\nSignalements : ${n}\n\nRevoir : /admin/reports`
    ).catch(() => {});
  }

  res.redirect(`/stumble/${siteId}?reported=1`);
});

module.exports = router;
