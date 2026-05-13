const session = require('express-session');
const db = require('./database');

// Table des sessions dans la même DB SQLite
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);
`);

const stmtGet     = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?');
const stmtSet     = db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)');
const stmtDestroy = db.prepare('DELETE FROM sessions WHERE sid = ?');
const stmtTouch   = db.prepare('UPDATE sessions SET expired = ? WHERE sid = ?');
const stmtClean   = db.prepare('DELETE FROM sessions WHERE expired <= ?');

class BetterSQLiteStore extends session.Store {
  get(sid, cb) {
    try {
      const row = stmtGet.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) { cb(err); }
  }

  set(sid, sess, cb) {
    try {
      const maxAge = sess.cookie?.maxAge ?? 30 * 24 * 60 * 60 * 1000;
      stmtSet.run(sid, JSON.stringify(sess), Date.now() + maxAge);
      cb(null);
    } catch (err) { cb(err); }
  }

  destroy(sid, cb) {
    try {
      stmtDestroy.run(sid);
      cb(null);
    } catch (err) { cb(err); }
  }

  touch(sid, sess, cb) {
    try {
      const maxAge = sess.cookie?.maxAge ?? 30 * 24 * 60 * 60 * 1000;
      stmtTouch.run(Date.now() + maxAge, sid);
      cb(null);
    } catch (err) { cb(err); }
  }
}

// Nettoyage des sessions expirées toutes les heures
setInterval(() => stmtClean.run(Date.now()), 60 * 60 * 1000).unref();

module.exports = BetterSQLiteStore;
