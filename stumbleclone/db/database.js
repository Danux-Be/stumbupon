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

module.exports = db;
