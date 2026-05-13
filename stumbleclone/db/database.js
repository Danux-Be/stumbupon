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

module.exports = db;
