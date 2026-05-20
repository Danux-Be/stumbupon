#!/usr/bin/env node
/**
 * Import massif d'URLs dans StumbUpon.com.
 *
 * Usage:
 *   node scripts/import-bulk.js --file=top-1m.csv [options]
 *
 * Options:
 *   --file=<path>         Fichier source : CSV Tranco (rank,domain) ou liste d'URLs brutes
 *   --limit=<n>           Nombre max d'URLs à traiter     (défaut : 10 000)
 *   --offset=<n>          Ignorer les N premières lignes  (défaut : 0)
 *   --threshold=<n>       Score min pour auto-approbation (défaut : 60)
 *   --concurrency=<n>     Requêtes HTTP parallèles        (défaut : 5)
 *   --lang=<xx,yy>        Garder uniquement ces langues   (ex : fr,en)
 *   --dry-run             Simulation sans écriture en DB
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs       = require('fs');
const readline = require('readline');

const db                 = require('../db/database');
const { validateUrl }    = require('../lib/validators');
const { enrichUrl }      = require('../lib/enricher');
const { isDuplicate, hashUrl, normalizeUrl } = require('../bot/lib/deduper');
const { classify }       = require('../bot/lib/classifier');
const { scoreCandidate } = require('../bot/lib/scorer');

// ── Arguments CLI ────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; })
);

// ── Blacklists ───────────────────────────────────────────────────────────────
const BLACKLIST_KEYWORDS = [
  'casino', 'poker', 'slots', 'gambling', 'betting', 'blackjack', 'roulette',
  'baccarat', 'sportsbet', 'sportbet', 'bookie', 'bookmaker', 'betway',
  'bet365', '1xbet', 'unibet', 'payday', 'paydayloan', 'quickloan',
  'pharma', 'viagra', 'cialis', 'xanax', 'tramadol',
  'porn', 'xxx', 'adult', 'escort', 'webcam-sex',
  'crypto-earn', 'nft-drop', 'airdrop-claim',
];
const BLACKLIST_DOMAINS = [
  'wix.com', 'weebly.com', 'wordpress.com', 'blogger.com', 'blogspot.com',
  'tumblr.com', 'squarespace.com', 'strikingly.com', 'jimdo.com', 'webnode.com',
  'webflow.io', 'carrd.co', 'glitch.me', 'netlify.app', 'vercel.app',
  'pages.dev', 'github.io', 'gitlab.io', 'herokuapp.com', 'fly.dev',
  'azurewebsites.net', 'web.app', 'firebaseapp.com',
];

function isBlacklisted(url) {
  const lower = url.toLowerCase();
  if (BLACKLIST_KEYWORDS.some(k => lower.includes(k))) return 'keyword';
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (BLACKLIST_DOMAINS.some(d => host === d || host.endsWith('.' + d))) return 'domain';
  return null;
}

const FILE        = args.file;
const LIMIT       = parseInt(args.limit       || '10000', 10);
const THRESHOLD   = parseInt(args.threshold   || '0',     10);
const CONCURRENCY = parseInt(args.concurrency || '5',     10);
const DRY_RUN     = args['dry-run'] === 'true';
const LANGS       = args.lang ? args.lang.split(',') : null;
const RESUME      = 'resume' in args;

const OFFSET = RESUME
  ? (db.prepare("SELECT COUNT(*) AS n FROM bot_processed WHERE source='bulk-import'").get().n)
  : parseInt(args.offset || '0', 10);

if (!FILE) {
  console.error('Usage: node scripts/import-bulk.js --file=<path> [--limit=10000] [--offset=0|--resume] [--threshold=60] [--concurrency=5] [--lang=fr,en] [--dry-run]');
  process.exit(1);
}

// ── Requêtes DB préparées ────────────────────────────────────────────────────
const insertSite = db.prepare(`
  INSERT OR IGNORE INTO sites
    (url, title, description, status, language, risk_score, quality_score, imported_by, can_embed, approved_at)
  VALUES
    (@url, @title, @description, @status, @language, @risk_score, @quality_score, @imported_by, @can_embed,
     CASE WHEN @status='approved' THEN CURRENT_TIMESTAMP ELSE NULL END)
`);

const insertSiteCat = db.prepare(
  'INSERT OR IGNORE INTO site_categories (site_id, category_id) VALUES (?, ?)'
);

const getSiteId = db.prepare('SELECT id FROM sites WHERE url = ?');

const insertProcessed = db.prepare(`
  INSERT OR REPLACE INTO bot_processed (url_hash, url, source, status, score, rejection_reason)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const flushBatch = db.transaction((items) => {
  for (const { url, title, status, language, risk_score, quality_score, can_embed, categoryIds } of items) {
    const info = insertSite.run({
      url, title, description: null, status, language,
      risk_score, quality_score,
      imported_by: 'bulk-import',
      can_embed: can_embed ? 1 : 0,
    });
    if (info.changes && categoryIds.length) {
      const siteId = getSiteId.get(url)?.id;
      if (siteId) {
        for (const catId of categoryIds) insertSiteCat.run(siteId, catId);
      }
    }
  }
});

// ── Traitement d'une URL ─────────────────────────────────────────────────────
async function processUrl(raw) {
  const url = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;

  if (isDuplicate(url)) return { skip: true, reason: 'duplicate' };

  const blacklisted = isBlacklisted(url);
  if (blacklisted) return { skip: true, reason: `blacklist:${blacklisted}` };

  const err = validateUrl(url);
  if (err) return { skip: true, reason: 'invalid' };

  let enriched;
  try { enriched = await enrichUrl(url); }
  catch { return { skip: true, reason: 'error' }; }

  if (enriched.dead)     return { skip: true, reason: 'dead' };
  if (enriched.sslError) return { skip: true, reason: 'ssl' };

  if (LANGS && enriched.language && !LANGS.includes(enriched.language))
    return { skip: true, reason: `lang:${enriched.language}` };

  if (enriched.riskScore > 30)  return { skip: true, reason: `risk:${enriched.riskScore}` };
  if (!enriched.canEmbed)       return { skip: true, reason: 'no-embed' };

  const categoryIds  = classify([enriched.title, url].filter(Boolean).join(' '));
  const qualityScore = scoreCandidate({ url, enriched, sourceScore: 0, categoryCount: categoryIds.length });
  const status       = qualityScore >= THRESHOLD ? 'approved' : 'pending';

  return {
    skip: false,
    status,
    score: qualityScore,
    data: {
      url:           normalizeUrl(url),
      title:         (enriched.title || url).slice(0, 200),
      status,
      language:      enriched.language || 'en',
      risk_score:    enriched.riskScore,
      quality_score: qualityScore,
      can_embed:     enriched.canEmbed,
      categoryIds,
    },
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📦 Import massif — ${FILE}`);
  console.log(`   limit=${LIMIT} offset=${OFFSET} threshold=${THRESHOLD} concurrency=${CONCURRENCY}${LANGS ? ` lang=${LANGS.join(',')}` : ''}${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  // Lecture du fichier
  const rl   = readline.createInterface({ input: fs.createReadStream(FILE) });
  const urls = [];
  let firstLine = true;
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Ignorer l'en-tête CSV (contient des lettres en 1ère colonne)
    if (firstLine) { firstLine = false; if (!/^\d/.test(trimmed)) continue; }
    const parts = trimmed.split(',');
    let domain;
    if (parts.length >= 12) domain = parts[2].trim();       // Majestic Million (12 colonnes)
    else if (parts.length >= 2) domain = parts[1].trim();   // Tranco (rank,domain)
    else domain = parts[0].trim();                          // URL brute
    urls.push(domain);
  }

  const slice = urls.slice(OFFSET, OFFSET + LIMIT);
  console.log(`   ${slice.length} URLs à traiter sur ${urls.length} dans le fichier\n`);

  const stats = { approved: 0, pending: 0, skipped: 0, errors: 0 };
  const batch = [];
  const start = Date.now();

  for (let i = 0; i < slice.length; i += CONCURRENCY) {
    const chunk   = slice.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map(processUrl));

    for (let j = 0; j < results.length; j++) {
      const idx = i + j;
      const pct = Math.round((idx + 1) / slice.length * 100);
      const raw = chunk[j];

      if (results[j].status === 'rejected') {
        stats.errors++;
        process.stdout.write(`[${pct}%] erreur — ${raw.slice(0, 60)}\n`);
        continue;
      }

      const r = results[j].value;

      if (r.skip) {
        stats.skipped++;
        process.stdout.write(`[${pct}%] skip(${r.reason}) — ${raw.slice(0, 60)}\n`);
        continue;
      }

      stats[r.status]++;
      process.stdout.write(`[${pct}%] score=${r.score} → ${r.status} — ${r.data.url.slice(0, 60)}\n`);

      if (!DRY_RUN) {
        batch.push(r.data);
        insertProcessed.run(hashUrl(r.data.url), r.data.url, 'bulk-import', r.status, r.score, null);
      }
    }

    // Flush toutes les 50 entrées
    if (!DRY_RUN && batch.length >= 50) flushBatch(batch.splice(0));
  }

  if (!DRY_RUN && batch.length) flushBatch(batch.splice(0));

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`\n✅ Terminé en ${elapsed}s`);
  console.log(`   approuvés : ${stats.approved}`);
  console.log(`   en attente: ${stats.pending}`);
  console.log(`   ignorés   : ${stats.skipped}`);
  console.log(`   erreurs   : ${stats.errors}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
