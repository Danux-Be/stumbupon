const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'stumble.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new Database(DB_PATH);

// Performances et intégrité référentielle
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Création des tables si elles n'existent pas encore
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// Migrations : colonnes ajoutées après le schéma initial
const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userCols.includes('language')) {
  db.exec("ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'fr'");
}

const siteCols = db.prepare('PRAGMA table_info(sites)').all().map(c => c.name);
if (!siteCols.includes('language')) {
  db.exec('ALTER TABLE sites ADD COLUMN language TEXT');
}
if (!siteCols.includes('risk_score')) {
  db.exec('ALTER TABLE sites ADD COLUMN risk_score INTEGER');
}

const userCols2 = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userCols2.includes('email_verified')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0');
}
if (!userCols2.includes('email_verification_token')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verification_token TEXT');
}

const siteCols2 = db.prepare('PRAGMA table_info(sites)').all().map(c => c.name);
if (!siteCols2.includes('imported_by')) {
  db.exec('ALTER TABLE sites ADD COLUMN imported_by TEXT');
}
if (!siteCols2.includes('quality_score')) {
  db.exec('ALTER TABLE sites ADD COLUMN quality_score INTEGER');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS bot_processed (
    url_hash TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    score INTEGER,
    rejection_reason TEXT,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_bot_source ON bot_processed(source);
  CREATE INDEX IF NOT EXISTS idx_bot_date ON bot_processed(processed_at);
`);

// Étape 17 : demandes d'opt-out propriétaires de sites
db.exec(`
  CREATE TABLE IF NOT EXISTS optout_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    name TEXT,
    email TEXT NOT NULL,
    reason TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_optout_status ON optout_requests(status);
`);

// Étape 15 : poids des centres d'intérêt
const uiCols = db.prepare('PRAGMA table_info(user_interests)').all().map(c => c.name);
if (!uiCols.includes('weight')) {
  db.exec('ALTER TABLE user_interests ADD COLUMN weight REAL DEFAULT 1.0');
}

// Étape 7 : langues du contenu acceptées par l'utilisateur ('all' = pas de filtre)
const userCols3 = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userCols3.includes('content_languages')) {
  db.exec("ALTER TABLE users ADD COLUMN content_languages TEXT DEFAULT 'all'");
}

// can_embed : NULL = inconnu, 1 = iframe OK, 0 = site bloque ou inaccessible
const siteCols3 = db.prepare('PRAGMA table_info(sites)').all().map(c => c.name);
if (!siteCols3.includes('can_embed')) {
  db.exec('ALTER TABLE sites ADD COLUMN can_embed INTEGER DEFAULT NULL');
}

// Réinitialisation de mot de passe par email
const userCols4 = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userCols4.includes('password_reset_token')) {
  db.exec('ALTER TABLE users ADD COLUMN password_reset_token TEXT DEFAULT NULL');
  db.exec('ALTER TABLE users ADD COLUMN password_reset_expires DATETIME DEFAULT NULL');
}

// Bannissement utilisateur
const userCols5 = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userCols5.includes('is_banned')) {
  db.exec('ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0');
}

// Re-check sites morts
const siteCols4 = db.prepare('PRAGMA table_info(sites)').all().map(c => c.name);
if (!siteCols4.includes('last_checked_at')) {
  db.exec('ALTER TABLE sites ADD COLUMN last_checked_at DATETIME DEFAULT NULL');
  db.exec('ALTER TABLE sites ADD COLUMN flag_reason TEXT DEFAULT NULL');
}

// Digest email hebdomadaire (opt-in par défaut)
const userCols6 = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userCols6.includes('email_digest')) {
  db.exec('ALTER TABLE users ADD COLUMN email_digest INTEGER DEFAULT 1');
}

// FTS5 — recherche full-text sur les sites approuvés
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS sites_fts USING fts5(
    title, description, url,
    tokenize='unicode61',
    content='sites',
    content_rowid='id'
  )
`);
db.exec(`
  CREATE TRIGGER IF NOT EXISTS sites_fts_ai AFTER INSERT ON sites BEGIN
    INSERT INTO sites_fts(rowid, title, description, url)
    VALUES (new.id, COALESCE(new.title,''), COALESCE(new.description,''), COALESCE(new.url,''));
  END
`);
db.exec(`
  CREATE TRIGGER IF NOT EXISTS sites_fts_ad AFTER DELETE ON sites BEGIN
    INSERT INTO sites_fts(sites_fts, rowid, title, description, url)
    VALUES ('delete', old.id, COALESCE(old.title,''), COALESCE(old.description,''), COALESCE(old.url,''));
  END
`);
db.exec(`
  CREATE TRIGGER IF NOT EXISTS sites_fts_au AFTER UPDATE ON sites BEGIN
    INSERT INTO sites_fts(sites_fts, rowid, title, description, url)
    VALUES ('delete', old.id, COALESCE(old.title,''), COALESCE(old.description,''), COALESCE(old.url,''));
    INSERT INTO sites_fts(rowid, title, description, url)
    VALUES (new.id, COALESCE(new.title,''), COALESCE(new.description,''), COALESCE(new.url,''));
  END
`);
// Population initiale si l'index est vide (rebuild = méthode recommandée pour content=)
const ftsSiteCount = db.prepare("SELECT COUNT(*) AS n FROM sites WHERE status='approved'").get().n;
const ftsRowCount = db.prepare("SELECT COUNT(*) AS n FROM sites_fts").get().n;
if (ftsSiteCount > 0 && ftsRowCount === 0) {
  db.exec("INSERT INTO sites_fts(sites_fts) VALUES('rebuild')");
}

// Type de contenu : 'website' (défaut) ou 'video'
const siteCols5 = db.prepare('PRAGMA table_info(sites)').all().map(c => c.name);
if (!siteCols5.includes('type')) {
  db.exec("ALTER TABLE sites ADD COLUMN type TEXT DEFAULT 'website'");
}

// Préférence utilisateur : inclure les vidéos YouTube dans les stumbles
const userCols7 = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userCols7.includes('include_videos')) {
  db.exec('ALTER TABLE users ADD COLUMN include_videos INTEGER DEFAULT 1');
}

// Commentaires sur les sites
db.exec(`
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK(length(body) <= 500),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_comments_site ON comments(site_id, created_at DESC);
`);

// Configuration du site (clé/valeur)
db.exec(`
  CREATE TABLE IF NOT EXISTS site_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
{
  const ins = db.prepare('INSERT OR IGNORE INTO site_config (key, value) VALUES (?, ?)');
  ins.run('less_of_this',        '0');
  ins.run('guest_limit_enabled', '0');
  ins.run('guest_limit_count',   '5');
}

// Compteur de partages
const userCols8 = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userCols8.includes('shares_count')) {
  db.exec('ALTER TABLE users ADD COLUMN shares_count INTEGER DEFAULT 0');
}

// Succès utilisateurs
db.exec(`
  CREATE TABLE IF NOT EXISTS user_achievements (
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL,
    earned_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, achievement_id)
  );
  CREATE INDEX IF NOT EXISTS idx_achievements_user ON user_achievements(user_id);
`);

// Bio et réseaux sociaux sur le profil public
const userCols9 = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userCols9.includes('bio')) {
  db.exec('ALTER TABLE users ADD COLUMN bio TEXT DEFAULT NULL');
  db.exec('ALTER TABLE users ADD COLUMN social_website TEXT DEFAULT NULL');
  db.exec('ALTER TABLE users ADD COLUMN social_twitter TEXT DEFAULT NULL');
  db.exec('ALTER TABLE users ADD COLUMN social_github TEXT DEFAULT NULL');
  db.exec('ALTER TABLE users ADD COLUMN social_mastodon TEXT DEFAULT NULL');
  db.exec('ALTER TABLE users ADD COLUMN social_linkedin TEXT DEFAULT NULL');
  db.exec('ALTER TABLE users ADD COLUMN social_instagram TEXT DEFAULT NULL');
}

// Référencements entrants — sites détectés via l'en-tête Referer
db.exec(`
  CREATE TABLE IF NOT EXISTS referer_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE NOT NULL,
    hits INTEGER DEFAULT 1,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_referer_status ON referer_queue(status);
`);

module.exports = db;
