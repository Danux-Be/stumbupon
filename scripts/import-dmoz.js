#!/usr/bin/env node
/**
 * Import depuis le dump RDF DMOZ/ODP avec catégories pré-assignées.
 *
 * Téléchargement du dump :
 *   https://archive.org/details/dmoz-odp-rdf-data  (fichier content.rdf.u8, ~1 Go)
 *
 * Usage :
 *   node scripts/import-dmoz.js --file=content.rdf.u8 [options]
 *
 * Options :
 *   --file=<path>      Chemin vers le fichier RDF                (obligatoire)
 *   --limit=<n>        Nombre max de sites à importer            (défaut : 50 000)
 *   --topic=<prefix>   Filtrer par chemin DMOZ (ex: Top/Arts, Top/World/Français)
 *   --dry-run          Simulation sans écriture en DB
 *   --status=<s>       approved | pending                        (défaut : approved)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs       = require('fs');
const readline = require('readline');

const db                 = require('../db/database');
const { validateUrl }    = require('../lib/validators');
const { isDuplicate, hashUrl, normalizeUrl } = require('../bot/lib/deduper');

// ── Args ─────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; })
);

const FILE     = args.file;
const LIMIT    = parseInt(args.limit  || '50000', 10);
const TOPIC    = args.topic  || null;
const DRY_RUN  = args['dry-run'] === 'true';
const STATUS   = args.status === 'pending' ? 'pending' : 'approved';

if (!FILE) {
  console.error('Usage: node scripts/import-dmoz.js --file=content.rdf.u8 [--limit=50000] [--topic=Top/Arts] [--dry-run]');
  process.exit(1);
}

// ── Mapping DMOZ → slugs StumbleClone ────────────────────────────────────────
// Ordonné du plus spécifique au plus général (premier match gagne)
const CATEGORY_MAP = [
  // Computers / Tech
  { p: 'Top/Computers/Programming',              s: ['programmation'] },
  { p: 'Top/Computers/Open_Source',              s: ['programmation'] },
  { p: 'Top/Computers/Software',                 s: ['programmation', 'technologie'] },
  { p: 'Top/Computers/Security',                 s: ['technologie', 'programmation'] },
  { p: 'Top/Computers/Graphics',                 s: ['design', 'art'] },
  { p: 'Top/Computers/Artificial_Intelligence',  s: ['technologie', 'programmation'] },
  { p: 'Top/Computers/Internet',                 s: ['technologie'] },
  { p: 'Top/Computers/Hardware',                 s: ['technologie'] },
  { p: 'Top/Computers',                          s: ['technologie'] },

  // Science
  { p: 'Top/Science/Astronomy',                  s: ['astronomie'] },
  { p: 'Top/Science/Math',                       s: ['mathematiques'] },
  { p: 'Top/Science/Mathematics',                s: ['mathematiques'] },
  { p: 'Top/Science/Physics',                    s: ['science'] },
  { p: 'Top/Science/Biology',                    s: ['science'] },
  { p: 'Top/Science/Chemistry',                  s: ['science'] },
  { p: 'Top/Science/Psychology',                 s: ['psychologie'] },
  { p: 'Top/Science/Earth_Sciences',             s: ['nature', 'science'] },
  { p: 'Top/Science/Environment',                s: ['nature', 'science'] },
  { p: 'Top/Science/Social_Sciences',            s: ['psychologie', 'politique'] },
  { p: 'Top/Science/Technology',                 s: ['technologie'] },
  { p: 'Top/Science',                            s: ['science'] },

  // Arts
  { p: 'Top/Arts/Architecture',                  s: ['architecture'] },
  { p: 'Top/Arts/Cinema',                        s: ['cinema'] },
  { p: 'Top/Arts/Movies',                        s: ['cinema'] },
  { p: 'Top/Arts/Television',                    s: ['cinema'] },
  { p: 'Top/Arts/Animation',                     s: ['cinema', 'art'] },
  { p: 'Top/Arts/Comics',                        s: ['art', 'litterature'] },
  { p: 'Top/Arts/Crafts',                        s: ['diy', 'art'] },
  { p: 'Top/Arts/Design',                        s: ['design'] },
  { p: 'Top/Arts/Humor',                         s: ['humour'] },
  { p: 'Top/Arts/Literature',                    s: ['litterature'] },
  { p: 'Top/Arts/Poetry',                        s: ['litterature'] },
  { p: 'Top/Arts/Music',                         s: ['musique'] },
  { p: 'Top/Arts/Performing_Arts',               s: ['musique', 'art'] },
  { p: 'Top/Arts/Photography',                   s: ['photographie'] },
  { p: 'Top/Arts/Visual_Arts',                   s: ['art'] },
  { p: 'Top/Arts',                               s: ['art'] },

  // Games
  { p: 'Top/Games/Video_Games',                  s: ['jeux-video'] },
  { p: 'Top/Games/Computer',                     s: ['jeux-video'] },
  { p: 'Top/Games/Puzzles',                      s: ['jeux-video'] },
  { p: 'Top/Games',                              s: ['jeux-video'] },

  // Health
  { p: 'Top/Health/Mental_Health',               s: ['psychologie'] },
  { p: 'Top/Health/Nutrition',                   s: ['cuisine', 'science'] },
  { p: 'Top/Health/Fitness',                     s: ['sport'] },
  { p: 'Top/Health',                             s: ['science'] },

  // Home
  { p: 'Top/Home/Cooking',                       s: ['cuisine'] },
  { p: 'Top/Home/Gardening',                     s: ['nature', 'diy'] },
  { p: 'Top/Home/Improvement',                   s: ['diy'] },
  { p: 'Top/Home/Crafts',                        s: ['diy', 'art'] },
  { p: 'Top/Home',                               s: ['diy'] },

  // Recreation
  { p: 'Top/Recreation/Humor',                   s: ['humour'] },
  { p: 'Top/Recreation/Travel',                  s: ['voyage'] },
  { p: 'Top/Recreation/Outdoors',                s: ['nature', 'sport'] },
  { p: 'Top/Recreation/Food',                    s: ['cuisine'] },
  { p: 'Top/Recreation/Pets',                    s: ['nature'] },
  { p: 'Top/Recreation/Photography',             s: ['photographie'] },
  { p: 'Top/Recreation/Sports',                  s: ['sport'] },
  { p: 'Top/Recreation/Collecting',              s: ['curiosites'] },
  { p: 'Top/Recreation/Music',                   s: ['musique'] },
  { p: 'Top/Recreation',                         s: ['voyage', 'curiosites'] },

  // Sports
  { p: 'Top/Sports',                             s: ['sport'] },

  // Society
  { p: 'Top/Society/History',                    s: ['histoire'] },
  { p: 'Top/Society/Philosophy',                 s: ['philosophie'] },
  { p: 'Top/Society/Religion_and_Spirituality',  s: ['philosophie'] },
  { p: 'Top/Society/Politics',                   s: ['politique'] },
  { p: 'Top/Society/Law',                        s: ['politique'] },
  { p: 'Top/Society/Issues',                     s: ['politique'] },
  { p: 'Top/Society/People',                     s: ['curiosites'] },
  { p: 'Top/Society',                            s: ['politique', 'curiosites'] },

  // Business / Economy
  { p: 'Top/Business/Finance',                   s: ['economie'] },
  { p: 'Top/Business/Investing',                 s: ['economie'] },
  { p: 'Top/Business',                           s: ['economie'] },

  // News / Reference
  { p: 'Top/News',                               s: ['politique'] },
  { p: 'Top/Reference/Education',                s: ['science'] },
  { p: 'Top/Reference/Museums',                  s: ['histoire', 'art'] },
  { p: 'Top/Reference/Maps',                     s: ['voyage'] },
  { p: 'Top/Reference/Libraries',                s: ['litterature'] },
  { p: 'Top/Reference',                          s: ['curiosites'] },

  // Regional / World
  { p: 'Top/Regional',                           s: ['voyage'] },
  { p: 'Top/World',                              s: ['voyage'] },
];

// Langue détectée depuis le chemin de topic DMOZ
const LANG_PATTERNS = [
  { match: /World\/Fran[çc]ais/,                  lang: 'fr' },
  { match: /World\/Deutsch/,                       lang: 'de' },
  { match: /World\/Espa[ñn]ol/,                   lang: 'es' },
  { match: /World\/Portugu[êe]s/,                 lang: 'pt' },
  { match: /World\/Italiano/,                      lang: 'it' },
  { match: /World\/Nederlands/,                    lang: 'nl' },
  { match: /World\/Japanese|World\/Nihongo/,       lang: 'ja' },
  { match: /World\/Chinese/,                       lang: 'zh' },
  { match: /World\/Russian|World\/Ru[ss]/,         lang: 'ru' },
  { match: /World\/Arabic|World\/Arab/,            lang: 'ar' },
  { match: /World\/Polska/,                        lang: 'pl' },
  { match: /World\/Dansk/,                         lang: 'da' },
];

function detectLang(topicPath) {
  for (const { match, lang } of LANG_PATTERNS) {
    if (match.test(topicPath)) return lang;
  }
  return 'en';
}

function mapCategories(topicPath, allCats) {
  for (const { p, s } of CATEGORY_MAP) {
    if (topicPath.startsWith(p)) {
      return allCats
        .filter(c => s.includes(c.slug) || s.includes(c.slug.replace('-', '_')))
        .map(c => c.id);
    }
  }
  return [];
}

function decodeEntities(str) {
  return (str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

// ── Requêtes DB ───────────────────────────────────────────────────────────────
const allCats      = db.prepare('SELECT id, slug FROM categories').all();

const insertSite   = db.prepare(`
  INSERT OR IGNORE INTO sites
    (url, title, description, status, language, risk_score, quality_score, imported_by, can_embed, approved_at)
  VALUES
    (@url, @title, @description, @status, @language, @risk_score, @quality_score, @imported_by, @can_embed,
     CASE WHEN @status='approved' THEN CURRENT_TIMESTAMP ELSE NULL END)
`);
const insertCat    = db.prepare('INSERT OR IGNORE INTO site_categories (site_id, category_id) VALUES (?, ?)');
const getSiteId    = db.prepare('SELECT id FROM sites WHERE url = ?');
const insertProc   = db.prepare(`
  INSERT OR REPLACE INTO bot_processed (url_hash, url, source, status, score, rejection_reason)
  VALUES (?, ?, 'dmoz', ?, 70, NULL)
`);

const flushBatch = db.transaction((batch) => {
  for (const { url, title, description, language, catIds } of batch) {
    const info = insertSite.run({
      url, title, description,
      status:        STATUS,
      language,
      risk_score:    0,
      quality_score: 70,
      imported_by:   'dmoz',
      can_embed:     null,
    });
    insertProc.run(hashUrl(url), url, STATUS);
    if (catIds.length) {
      const siteId = info.changes ? getSiteId.get(url)?.id : null;
      if (siteId) {
        for (const catId of catIds) insertCat.run(siteId, catId);
      }
    }
  }
});

// ── Parser ligne à ligne ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n📚 Import DMOZ — ${FILE}`);
  console.log(`   limit=${LIMIT}${TOPIC ? ` topic=${TOPIC}` : ''} status=${STATUS}${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  const rl = readline.createInterface({
    input: fs.createReadStream(FILE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  const stats = { imported: 0, skipped: 0, nocat: 0, filtered: 0 };
  const batch = [];

  // État du parser
  let url = '', title = '', desc = '', topic = '';
  let inPage = false;
  let lineNum = 0;

  for await (const line of rl) {
    lineNum++;

    if (line.includes('<ExternalPage about=')) {
      const m = line.match(/about="([^"]+)"/);
      if (m) { url = m[1]; title = ''; desc = ''; topic = ''; inPage = true; }

    } else if (inPage) {

      if (line.includes('<d:Title>')) {
        const m = line.match(/<d:Title>([^<]*)<\/d:Title>/);
        if (m) title = decodeEntities(m[1].trim());

      } else if (line.includes('<d:Description>')) {
        const m = line.match(/<d:Description>([^<]*)<\/d:Description>/);
        if (m) desc = decodeEntities(m[1].trim());

      } else if (line.includes('<topic>')) {
        const m = line.match(/<topic>([^<]+)<\/topic>/);
        if (m) topic = m[1].trim();

      } else if (line.includes('</ExternalPage>')) {
        inPage = false;

        if (stats.imported >= LIMIT) break;

        // Filtre topic
        if (TOPIC && !topic.startsWith(TOPIC)) { stats.filtered++; continue; }

        // Validation URL
        if (!url || validateUrl(url)) { stats.skipped++; continue; }

        // Déduplication
        if (isDuplicate(url)) { stats.skipped++; continue; }

        // Catégories
        const catIds = mapCategories(topic, allCats);
        if (!catIds.length) { stats.nocat++; continue; }

        const lang = detectLang(topic);
        const normUrl = normalizeUrl(url);

        stats.imported++;
        if (stats.imported % 1000 === 0) {
          process.stdout.write(`  → ${stats.imported} importés, ${stats.skipped} ignorés, ${stats.nocat} sans catégorie (ligne ${lineNum})\n`);
        }

        if (!DRY_RUN) {
          batch.push({ url: normUrl, title: (title || normUrl).slice(0, 200), description: desc.slice(0, 500) || null, language: lang, catIds });
          if (batch.length >= 200) flushBatch(batch.splice(0));
        }
      }
    }
  }

  if (!DRY_RUN && batch.length) flushBatch(batch.splice(0));

  console.log(`\n✅ Terminé`);
  console.log(`   importés       : ${stats.imported}`);
  console.log(`   doublons/invalides : ${stats.skipped}`);
  console.log(`   sans catégorie : ${stats.nocat}`);
  console.log(`   hors filtre    : ${stats.filtered}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
