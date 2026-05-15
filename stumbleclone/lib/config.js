const db = require('../db/database');

const DEFAULTS = {
  less_of_this:        '0',
  guest_limit_enabled: '0',
  guest_limit_count:   '5',
};

const stmtAll = db.prepare('SELECT key, value FROM site_config');
const stmtSet = db.prepare('INSERT OR REPLACE INTO site_config (key, value) VALUES (?, ?)');

let _cache = null;

function _load() {
  if (_cache) return _cache;
  _cache = { ...DEFAULTS };
  for (const row of stmtAll.all()) _cache[row.key] = row.value;
  return _cache;
}

function get(key) {
  return _load()[key] ?? DEFAULTS[key] ?? null;
}

function set(key, value) {
  stmtSet.run(key, String(value));
  _cache = null;
}

function getAll() {
  return { ..._load() };
}

module.exports = { get, set, getAll, DEFAULTS };
