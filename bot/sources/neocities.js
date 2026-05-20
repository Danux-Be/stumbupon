// Neocities — sites personnels et créatifs style "nouveau GeoCities"
// Scrape la page de navigation publique
const nodeFetch = globalThis.fetch;
const TIMEOUT_MS = 12_000;

const SKIP = new Set([
  'browse', 'about', 'blog', 'news', 'plan', 'tips', 'tutorials',
  'contact', 'supporters', 'profile', 'settings', 'likes',
  'login', 'create', 'api', 'tags', 'terms', 'privacy', 'donate',
]);

async function fetchPage(offset) {
  const url = `https://neocities.org/browse?sort_by=views&offset=${offset}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await nodeFetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'StumbUpon.comBot/1.0 (+https://stumble.danux.be/bot)' },
    });
    clearTimeout(t);
    return res.ok ? res.text() : null;
  } catch { clearTimeout(t); return null; }
}

async function fetch(options = {}) {
  const limit = options.limit || 20;
  console.log(`[Neocities] Récupération de ${limit} sites perso…`);

  const all  = [];
  const seen = new Set();
  let   offset = 0;

  while (all.length < limit) {
    const html = await fetchPage(offset);
    if (!html) break;

    const matches = [...html.matchAll(/href="\/([a-zA-Z0-9][a-zA-Z0-9_-]{1,30})"/g)];
    let added = 0;
    for (const m of matches) {
      const name = m[1];
      if (SKIP.has(name)) continue;
      const url = `https://${name}.neocities.org`;
      if (!seen.has(url)) {
        seen.add(url);
        all.push({ url, source_title: name, source_score: 50, source_metadata: { neocities: name } });
        added++;
      }
    }
    if (added === 0) break;
    offset += 40;
    await new Promise(r => setTimeout(r, 600));
  }

  console.log(`[Neocities] ${all.length} candidats`);
  return all.slice(0, limit);
}

module.exports = { name: 'neocities', fetch };
