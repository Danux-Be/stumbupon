const db = require('../../db/database');
const { isDuplicate } = require('../lib/deduper');

const UA = 'StumbUpon.comBot/1.0 (+https://stumble.danux.be/bot)';
const TIMEOUT_MS = 10_000;
const DELAY_MS = 700;
const MAX_PER_DOMAIN = 3;

const SKIP_EXTENSIONS = /\.(pdf|zip|gz|tar|png|jpg|jpeg|gif|svg|ico|webp|mp4|mp3|ogg|woff2?|ttf|eot|css|js|json|xml)(\?.*)?$/i;
const SKIP_PATHS = /\/(login|signin|signup|register|logout|cart|checkout|admin|wp-admin|wp-login|feed|rss\.xml|sitemap|cdn-cgi|\.well-known)/i;
const TRACKING_PARAMS = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid','ref','source'];

// Cache robots.txt par domaine pour cette exécution
const robotsCache = new Map();

async function fetchRobots(host) {
  if (robotsCache.has(host)) return robotsCache.get(host);
  const disallowed = [];
  try {
    const ctrl = AbortSignal.timeout(5_000);
    const res = await fetch(`https://${host}/robots.txt`, {
      signal: ctrl,
      headers: { 'User-Agent': UA },
    });
    if (res.ok) {
      const text = await res.text();
      let inBlock = false;
      for (const raw of text.split('\n')) {
        const line = raw.trim().toLowerCase();
        if (line.startsWith('user-agent:')) {
          const agent = line.slice(11).trim();
          inBlock = agent === '*' || agent.includes('stumbleclonebot');
        } else if (inBlock && line.startsWith('disallow:')) {
          const path = line.slice(9).trim();
          if (path) disallowed.push(path);
        }
      }
    }
  } catch { /* robots.txt inaccessible = pas de restriction */ }
  robotsCache.set(host, disallowed);
  return disallowed;
}

function isAllowedByRobots(pathname, rules) {
  for (const rule of rules) {
    if (pathname.startsWith(rule)) return false;
  }
  return true;
}

async function fetchHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    clearTimeout(t);
    if (!res.ok) { res.body?.cancel(); return null; }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) { res.body?.cancel(); return null; }

    const reader = res.body.getReader();
    let html = '';
    while (html.length < 30_000) {
      const { value, done } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
    }
    reader.cancel();
    return html;
  } catch {
    clearTimeout(t);
    return null;
  }
}

function extractLinks(html, seedHost) {
  // url → anchor text
  const links = new Map();
  const re = /href=["']([^"'#\s]{10,512})["'][^>]*>([^<]{0,120})/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim();
    const anchor = m[2].replace(/\s+/g, ' ').trim();
    if (!/^https?:\/\//i.test(href)) continue;

    let u;
    try { u = new URL(href); } catch { continue; }

    const host = u.hostname;
    if (host === seedHost || host.endsWith('.' + seedHost)) continue;
    if (SKIP_EXTENSIONS.test(u.pathname)) continue;
    if (SKIP_PATHS.test(u.pathname)) continue;

    u.hash = '';
    TRACKING_PARAMS.forEach(p => u.searchParams.delete(p));
    const clean = u.toString().replace(/\/$/, '');

    if (!links.has(clean)) links.set(clean, anchor);
  }
  return links;
}

async function fetch(options = {}) {
  const seedCount = parseInt(options.seeds || '5', 10);
  const limit = options.limit || 20;

  const seeds = db.prepare(`
    SELECT url FROM sites
    WHERE status = 'approved'
    ORDER BY RANDOM()
    LIMIT ?
  `).all(seedCount);

  console.log(`[Crawler] ${seeds.length} seed(s) sélectionné(s), extraction de liens…`);

  // url → { anchorText, hitCount }
  const linkMap = new Map();

  for (const seed of seeds) {
    let seedHost;
    try { seedHost = new URL(seed.url).hostname; } catch { continue; }

    process.stdout.write(`  ↳ ${seed.url.slice(0, 70)}… `);

    const robots = await fetchRobots(seedHost);
    const seedPath = new URL(seed.url).pathname;
    if (!isAllowedByRobots(seedPath, robots)) {
      process.stdout.write('bloqué (robots.txt)\n');
      continue;
    }

    const html = await fetchHtml(seed.url);
    if (!html) {
      process.stdout.write('inaccessible\n');
      await new Promise(r => setTimeout(r, DELAY_MS));
      continue;
    }

    const links = extractLinks(html, seedHost);
    let found = 0;
    for (const [url, anchor] of links) {
      const existing = linkMap.get(url);
      if (existing) {
        existing.hitCount++;
      } else {
        linkMap.set(url, { anchorText: anchor, hitCount: 1 });
        found++;
      }
    }
    process.stdout.write(`${found} nouveaux liens\n`);
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // Trier par hit count (liens cités par plusieurs seeds = plus populaires)
  const sorted = [...linkMap.entries()]
    .sort((a, b) => b[1].hitCount - a[1].hitCount);

  const domainCount = new Map();
  const candidates = [];

  for (const [url, { anchorText, hitCount }] of sorted) {
    if (candidates.length >= limit) break;
    if (isDuplicate(url)) continue;

    let host;
    try { host = new URL(url).hostname; } catch { continue; }

    const dc = domainCount.get(host) || 0;
    if (dc >= MAX_PER_DOMAIN) continue;
    domainCount.set(host, dc + 1);

    // Bonus de score si le lien apparaît sur plusieurs seeds
    const source_score = 45 + Math.min(15, (hitCount - 1) * 5);

    candidates.push({
      url,
      source_title: anchorText,
      source_score,
      source_metadata: { crawler: true, hit_count: hitCount },
    });
  }

  console.log(`[Crawler] ${candidates.length} candidats (depuis ${linkMap.size} liens extraits)`);
  return candidates;
}

module.exports = { name: 'crawler', fetch };
