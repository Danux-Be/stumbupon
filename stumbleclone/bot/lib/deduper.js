const crypto = require('crypto');
const db = require('../../db/database');

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    // Forcer https si http
    u.protocol = 'https:';
    // Supprimer le trailing slash
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    // Supprimer les query strings de tracking courants
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content',
     'fbclid','gclid','ref','source'].forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
}

function hashUrl(url) {
  return crypto.createHash('sha256').update(normalizeUrl(url)).digest('hex');
}

function isDuplicate(url) {
  const hash = hashUrl(url);
  const inProcessed = db.prepare('SELECT url_hash FROM bot_processed WHERE url_hash = ?').get(hash);
  if (inProcessed) return true;
  const normalized = normalizeUrl(url);
  const inSites = db.prepare('SELECT id FROM sites WHERE url = ? OR url = ?').get(url, normalized);
  return !!inSites;
}

module.exports = { normalizeUrl, hashUrl, isDuplicate };
