// searchmysite.net — index collaboratif du web personnel et indépendant
// Clé API optionnelle : SEARCHMYSITE_KEY dans .env
// Sans clé : fonctionne mais limité (usage raisonnable)
const nodeFetch = globalThis.fetch;
const TIMEOUT_MS = 12_000;

const QUERIES = [
  'personal website', 'digital garden', 'indie blog',
  'creative coding', 'photography', 'science writing',
  'programming tutorial', 'art portfolio', 'travel journal',
];

async function searchQuery(query, size, apiKey) {
  const url = `https://api.searchmysite.net/api/v1/search/basic/?q=${encodeURIComponent(query)}&size=${size}`;
  const headers = {
    'User-Agent': 'StumbleCloneBot/1.0 (+https://stumble.danux.be/bot)',
    'Accept': 'application/json',
  };
  if (apiKey) headers['Authorization'] = `ApiKey ${apiKey}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await nodeFetch(url, { signal: ctrl.signal, headers });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.hits?.hits || [])
      .map(h => ({
        url:             h._source?.url || h._source?.page_url || '',
        source_title:    h._source?.title || '',
        source_score:    Math.min(100, Math.round((h._score || 1) * 10)),
        source_metadata: { searchmysite_query: query },
      }))
      .filter(r => r.url.startsWith('http'));
  } catch { clearTimeout(t); return []; }
}

async function fetch(options = {}) {
  const limit  = options.limit || 20;
  const apiKey = process.env.SEARCHMYSITE_KEY || null;
  if (!apiKey) console.log(`[SearchMySite] Sans clé API (ajouter SEARCHMYSITE_KEY dans .env pour plus de requêtes)`);
  console.log(`[SearchMySite] ${QUERIES.length} requêtes…`);

  const all      = [];
  const seen     = new Set();
  const perQuery = Math.ceil(limit / QUERIES.length);

  for (const q of QUERIES) {
    if (all.length >= limit) break;
    const results = await searchQuery(q, perQuery, apiKey);
    for (const r of results) {
      if (!seen.has(r.url)) {
        seen.add(r.url);
        all.push(r);
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`[SearchMySite] ${all.length} candidats`);
  return all.slice(0, limit);
}

module.exports = { name: 'searchmysite', fetch };
