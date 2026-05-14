#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db          = require('../db/database');
const { validateUrl }    = require('../lib/validators');
const { enrichUrl }      = require('../lib/enricher');
const { isDuplicate, hashUrl, normalizeUrl } = require('./lib/deduper');
const { classify }       = require('./lib/classifier');
const { scoreCandidate } = require('./lib/scorer');

// Parsing des arguments CLI
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
);

const SOURCE_NAME      = args.source || 'hn';
const LIMIT            = parseInt(args.limit || '20', 10);
const APPROVE_THRESHOLD = parseInt(args.threshold || '70', 10);
const DRY_RUN          = args['dry-run'] === 'true';

const SOURCES = {
  hn:           require('./sources/hackernews'),
  wiby:         require('./sources/wiby'),
  lobsters:     require('./sources/lobsters'),
  reddit:       require('./sources/reddit'),
  marginalia:   require('./sources/marginalia'),
  github:       require('./sources/github'),
  neocities:    require('./sources/neocities'),
  pinboard:     require('./sources/pinboard'),
  metafilter:   require('./sources/metafilter'),
  tildes:       require('./sources/tildes'),
  kbclub:       require('./sources/kbclub'),
  searchmysite: require('./sources/searchmysite'),
};

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

async function runSource(source) {
  console.log(`\n🤖 StumbleClone Bot — source: ${source.name}, limit: ${LIMIT}, threshold: ${APPROVE_THRESHOLD}${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  const candidates = await source.fetch({ limit: LIMIT * 3 });

  const stats = { imported: 0, approved: 0, pending: 0, skipped: 0, rejected: 0 };

  for (const candidate of candidates) {
    if (stats.imported >= LIMIT) break;

    const { url, source_title, source_score } = candidate;

    // 1. Déduplication
    if (isDuplicate(url)) {
      stats.skipped++;
      continue;
    }

    // 2. Validation URL
    const urlError = validateUrl(url);
    if (urlError) {
      insertProcessed.run(hashUrl(url), url, source.name, 'rejected', 0, urlError);
      stats.rejected++;
      continue;
    }

    // 3. Enrichissement
    process.stdout.write(`  ↳ ${url.slice(0, 70)}… `);
    const enriched = await enrichUrl(url);

    // 4. Classification
    const combinedText = [source_title, enriched.title, url].filter(Boolean).join(' ');
    const categoryIds = classify(combinedText);

    // 5. Score qualité
    const qualityScore = scoreCandidate({
      url,
      enriched,
      sourceScore: source_score,
      categoryCount: categoryIds.length,
    });

    const finalTitle = enriched.title || source_title || url;
    const status = qualityScore >= APPROVE_THRESHOLD ? 'approved' : 'pending';

    process.stdout.write(`score=${qualityScore} cats=${categoryIds.length} → ${status}\n`);

    if (DRY_RUN) {
      stats.imported++;
      stats[status]++;
      continue;
    }

    // 6. Insert
    const info = insertSite.run({
      url:           normalizeUrl(url),
      title:         finalTitle.slice(0, 200),
      description:   null,
      status,
      language:      enriched.language || 'en',
      risk_score:    enriched.riskScore,
      quality_score: qualityScore,
      imported_by:   `bot:${source.name}`,
      can_embed:     enriched.canEmbed ? 1 : 0,
    });

    const siteId = info.lastInsertRowid || getSiteId.get(normalizeUrl(url))?.id;

    if (siteId && categoryIds.length > 0) {
      for (const catId of categoryIds) insertSiteCat.run(siteId, catId);
    } else if (siteId && categoryIds.length === 0) {
      // Fallback : catégorie "Curiosités"
      const fallback = db.prepare("SELECT id FROM categories WHERE slug='curiosites'").get();
      if (fallback) insertSiteCat.run(siteId, fallback.id);
    }

    insertProcessed.run(hashUrl(url), url, source.name, status, qualityScore, null);

    stats.imported++;
    stats[status]++;
  }

  console.log(`\n✅ ${source.name} terminé`);
  console.log(`   ${stats.imported} sites importés (${stats.approved} approuvés, ${stats.pending} en attente)`);
  console.log(`   ${stats.skipped} doublons ignorés`);
  console.log(`   ${stats.rejected} rejetés (URL invalide)`);
  return stats;
}

async function run() {
  const sourceNames = SOURCE_NAME === 'all'
    ? Object.keys(SOURCES)
    : [SOURCE_NAME];

  const unknown = sourceNames.filter(n => !SOURCES[n]);
  if (unknown.length) {
    console.error(`Source(s) inconnue(s) : ${unknown.join(', ')}. Disponibles : ${Object.keys(SOURCES).join(', ')}, all`);
    process.exit(1);
  }

  const totals = { imported: 0, approved: 0, pending: 0, skipped: 0, rejected: 0 };

  for (const name of sourceNames) {
    const stats = await runSource(SOURCES[name]);
    for (const k of Object.keys(totals)) totals[k] += stats[k];
  }

  if (sourceNames.length > 1) {
    console.log(`\n📊 Total toutes sources :`);
    console.log(`   ${totals.imported} importés (${totals.approved} approuvés, ${totals.pending} en attente)`);
    console.log(`   ${totals.skipped} doublons | ${totals.rejected} rejetés`);
  }
}

run().catch(err => {
  console.error('Erreur fatale :', err);
  process.exit(1);
});
