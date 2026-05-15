const db = require('../db/database');

const OWN_HOSTS = new Set(['stumble.danux.be', 'localhost', '127.0.0.1']);
const STATIC_EXT = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|map)$/i;
const BOT_UA = /bot|crawler|spider|slurp|bingpreview|facebot|twitterbot|linkedinbot|whatsapp|telegram|discord/i;

const stmtUpsert = db.prepare(`
  INSERT INTO referer_queue (url, hits, last_seen, status)
  VALUES (?, 1, CURRENT_TIMESTAMP, 'pending')
  ON CONFLICT(url) DO UPDATE SET
    hits = hits + 1,
    last_seen = CURRENT_TIMESTAMP
  WHERE status = 'pending'
`);

const stmtAlreadySite = db.prepare(
  "SELECT 1 FROM sites WHERE url = ? AND status IN ('approved','pending') LIMIT 1"
);
const stmtAlreadyQueue = db.prepare(
  "SELECT status FROM referer_queue WHERE url = ? LIMIT 1"
);

function captureReferer(req, res, next) {
  const raw = req.get('Referer');
  if (!raw) return next();

  if (STATIC_EXT.test(req.path)) return next();
  if (BOT_UA.test(req.get('User-Agent') || '')) return next();

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return next();
  }

  const host = parsed.hostname;
  if (OWN_HOSTS.has(host) || host.endsWith('.danux.be')) return next();
  if (!['http:', 'https:'].includes(parsed.protocol)) return next();

  // Normalise : enlève les paramètres de tracking et le fragment
  parsed.hash = '';
  ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','ref','fbclid','gclid'].forEach(p => parsed.searchParams.delete(p));
  const url = parsed.toString().replace(/\/$/, '');

  if (url.length > 500) return next();

  // Vérifie si déjà dans les sites ou rejeté/approuvé dans la queue
  if (stmtAlreadySite.get(url)) return next();
  const existing = stmtAlreadyQueue.get(url);
  if (existing && existing.status !== 'pending') return next();

  // Fire-and-forget — ne bloque pas la requête
  try {
    stmtUpsert.run(url);
  } catch {
    // Ignore les erreurs DB (contrainte unique en race condition)
  }

  next();
}

module.exports = { captureReferer };
