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

module.exports = db;
