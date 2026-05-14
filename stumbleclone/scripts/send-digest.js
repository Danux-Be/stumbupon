#!/usr/bin/env node
// Digest email hebdomadaire — lancer via cron chaque lundi à 9h
// Usage : node scripts/send-digest.js [--dry-run]
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db = require('../db/database');
const { sendDigestEmail } = require('../lib/mailer');

const DRY_RUN = process.argv.includes('--dry-run');
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';

if (DRY_RUN) console.log('[digest] Mode dry-run — aucun email envoyé');

const getUsers = db.prepare(`
  SELECT id, username, email,
         COALESCE(language, 'fr') AS lang,
         COALESCE(content_languages, 'all') AS content_languages
  FROM users
  WHERE email_verified = 1
    AND is_banned = 0
    AND email_digest = 1
`);

// Sites récents (7 derniers jours) correspondant aux intérêts de l'utilisateur
const getRecentSites = db.prepare(`
  SELECT s.id, s.url, s.title, s.description,
         GROUP_CONCAT(COALESCE(ct.name, c.name), ', ') AS cats,
         SUM(ui.weight) AS interest_score,
         COALESCE((SELECT SUM(direction) FROM votes v WHERE v.site_id = s.id), 0) AS vote_score
  FROM sites s
  JOIN site_categories sc ON sc.site_id = s.id
  JOIN categories c ON c.id = sc.category_id
  LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
  JOIN user_interests ui ON ui.category_id = sc.category_id AND ui.user_id = ?
  WHERE s.status = 'approved'
    AND s.approved_at >= datetime('now', '-7 days')
    AND (? = 'all' OR INSTR(',' || ? || ',', ',' || s.language || ',') > 0)
  GROUP BY s.id
  ORDER BY interest_score DESC, vote_score DESC
  LIMIT 5
`);

// Complément : top sites all-time non vus récemment (si < 3 récents)
const getFillSites = db.prepare(`
  SELECT s.id, s.url, s.title, s.description,
         GROUP_CONCAT(COALESCE(ct.name, c.name), ', ') AS cats,
         SUM(ui.weight) AS interest_score,
         COALESCE((SELECT SUM(direction) FROM votes v WHERE v.site_id = s.id), 0) AS vote_score
  FROM sites s
  JOIN site_categories sc ON sc.site_id = s.id
  JOIN categories c ON c.id = sc.category_id
  LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
  JOIN user_interests ui ON ui.category_id = sc.category_id AND ui.user_id = ?
  WHERE s.status = 'approved'
    AND s.id NOT IN (SELECT site_id FROM views WHERE user_id = ? AND viewed_at > datetime('now', '-30 days'))
    AND (? = 'all' OR INSTR(',' || ? || ',', ',' || s.language || ',') > 0)
  GROUP BY s.id
  ORDER BY vote_score DESC, interest_score DESC
  LIMIT ?
`);

async function run() {
  const users = getUsers.all();
  console.log(`[digest] ${users.length} utilisateur(s) éligible(s) — ${new Date().toISOString()}`);

  let sent = 0, skipped = 0;

  for (const user of users) {
    const { id, username, email, lang, content_languages } = user;
    const langPref = content_languages;

    // Sites récents dans ses catégories + langues
    let sites = getRecentSites.all(lang, id, langPref, langPref);

    // Compléter si moins de 3 récents
    if (sites.length < 3) {
      const existingIds = new Set(sites.map(s => s.id));
      const needed = 5 - sites.length;
      const fill = getFillSites.all(lang, id, id, langPref, langPref, needed + 10)
        .filter(s => !existingIds.has(s.id))
        .slice(0, needed);
      sites = [...sites, ...fill];
    }

    if (!sites.length) {
      console.log(`[digest] skip ${username} — aucun site correspondant`);
      skipped++;
      continue;
    }

    const unsubUrl = `${BASE_URL}/settings`;

    if (DRY_RUN) {
      console.log(`[digest] DRY-RUN → ${email} (${lang}) — ${sites.length} site(s) :`);
      sites.forEach(s => console.log(`  • ${s.title} — ${s.url}`));
    } else {
      try {
        await sendDigestEmail(email, username, sites, lang, unsubUrl);
        console.log(`[digest] ✓ ${username} <${email}> — ${sites.length} site(s)`);
        sent++;
      } catch (err) {
        console.error(`[digest] ✗ ${username} <${email}> — ${err.message}`);
      }
    }

    // Pause légère entre envois pour ne pas saturer le serveur SMTP
    if (!DRY_RUN) await new Promise(r => setTimeout(r, 300));
  }

  console.log(`[digest] Terminé — ${sent} envoyé(s), ${skipped} ignoré(s)`);
  process.exit(0);
}

run().catch(err => { console.error('[digest] Erreur fatale :', err); process.exit(1); });
