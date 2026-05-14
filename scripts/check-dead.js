#!/usr/bin/env node
// Re-vérifie les sites approuvés pour détecter les liens morts, redirects hijack, etc.
// Usage : node scripts/check-dead.js [--concurrency=10] [--limit=N] [--force]
// --force : re-vérifie même les sites récemment vérifiés
require('dotenv').config();
const db = require('../db/database');

const CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '10');
const LIMIT       = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');
const FORCE       = process.argv.includes('--force');
const TIMEOUT_MS  = 10_000;
const UA = 'StumbleCloneBot/1.0 (health-check)';

const updateSite = db.prepare(`
  UPDATE sites
  SET last_checked_at = CURRENT_TIMESTAMP,
      status = CASE WHEN ? IS NOT NULL THEN 'flagged' ELSE status END,
      flag_reason = ?,
      can_embed = COALESCE(?, can_embed)
  WHERE id = ?
`);

async function checkSite(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    clearTimeout(timer);
    res.body?.cancel().catch(() => {});

    // Redirect vers un domaine différent
    if (res.url !== url) {
      try {
        const origHost  = new URL(url).hostname.replace(/^www\./, '');
        const finalHost = new URL(res.url).hostname.replace(/^www\./, '');
        if (origHost !== finalHost && !finalHost.endsWith('.' + origHost) && !origHost.endsWith('.' + finalHost)) {
          return { flag: `redirect → ${new URL(res.url).hostname}`, canEmbed: null };
        }
      } catch { /* ignore malformed */ }
    }

    if (res.status === 404) return { flag: 'HTTP 404', canEmbed: 0 };
    if (res.status === 410) return { flag: 'HTTP 410 (gone)', canEmbed: 0 };
    if (res.status >= 500)  return { flag: `HTTP ${res.status}`, canEmbed: null };

    // Vérifier can_embed
    let canEmbed = 1;
    const xfo = res.headers.get('x-frame-options') || '';
    if (/deny|sameorigin/i.test(xfo)) canEmbed = 0;
    const csp = res.headers.get('content-security-policy') || '';
    if (/frame-ancestors\s+['"]?none['"]?/i.test(csp)) canEmbed = 0;
    else if (/frame-ancestors/i.test(csp) && !/frame-ancestors[^;]*\*/i.test(csp)) canEmbed = 0;

    return { flag: null, canEmbed };
  } catch (err) {
    clearTimeout(timer);
    const reason = err.name === 'AbortError' ? 'timeout' : 'inaccessible';
    return { flag: reason, canEmbed: 0 };
  }
}

async function main() {
  // Ne re-vérifie pas les sites vus dans les 25 derniers jours (sauf --force)
  const ageFilter = FORCE ? '' : "AND (last_checked_at IS NULL OR last_checked_at < datetime('now', '-25 days'))";
  let query = `SELECT id, url FROM sites WHERE status IN ('approved', 'flagged') ${ageFilter} ORDER BY last_checked_at ASC NULLS FIRST`;
  if (LIMIT > 0) query += ` LIMIT ${LIMIT}`;

  const sites = db.prepare(query).all();

  if (!sites.length) {
    console.log('✅ Aucun site à vérifier (tous récemment contrôlés). Utilise --force pour tout re-vérifier.');
    return;
  }

  console.log(`🔍 ${sites.length} sites à vérifier (concurrence: ${CONCURRENCY})…\n`);

  let done = 0, ok = 0, flagged = 0;

  for (let i = 0; i < sites.length; i += CONCURRENCY) {
    const batch = sites.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (s) => {
      const result = await checkSite(s.url);
      return { id: s.id, url: s.url, ...result };
    }));

    for (const { id, url, flag, canEmbed } of results) {
      updateSite.run(flag || null, flag || null, canEmbed, id);
      done++;
      if (flag) {
        flagged++;
        const short = url.replace(/^https?:\/\//, '').slice(0, 50);
        process.stdout.write(`\r  ${done}/${sites.length} — ✅ ${ok} OK  ⚠️  ${flagged} flaggés   \n`);
        console.log(`     ⚠️  ${short} → ${flag}`);
      } else {
        ok++;
        process.stdout.write(`\r  ${done}/${sites.length} — ✅ ${ok} OK  ⚠️  ${flagged} flaggés   `);
      }
    }
  }

  console.log(`\n\n✅ Terminé : ${ok} sites OK, ${flagged} flaggés pour re-modération.`);

  if (flagged > 0) {
    console.log(`\nSites flaggés — à vérifier sur /admin/flagged`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
