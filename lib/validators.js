const db = require('../db/database');

const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|::1$|fc|fd)/i;
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i;
const RESERVED_HOSTS = ['localhost', '0.0.0.0', 'broadcasthost', 'ip6-localhost', 'ip6-loopback'];

function validateUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return 'error_url_invalid';
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return 'error_url_invalid';
  if (rawUrl.length > 2000) return 'error_url_too_long';

  const host = parsed.hostname.replace(/^\[|\]$/g, '');

  if (RESERVED_HOSTS.includes(host.toLowerCase())) return 'error_url_private';
  if (IP_RE.test(host)) return 'error_url_no_ip';
  if (PRIVATE_IP_RE.test(host)) return 'error_url_private';

  const port = parsed.port ? parseInt(parsed.port, 10) : null;
  if (port !== null && port !== 80 && port !== 443) return 'error_url_port';

  const exists = db.prepare('SELECT id FROM sites WHERE url = ?').get(rawUrl);
  if (exists) return 'error_url_duplicate';

  return null;
}

module.exports = { validateUrl };
