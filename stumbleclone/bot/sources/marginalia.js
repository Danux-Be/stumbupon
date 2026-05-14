const nodeFetch = globalThis.fetch;
const TIMEOUT_MS = 12_000;

// Termes de recherche thématiques pour diversifier les découvertes
const SEARCH_TERMS = [
  'personal website', 'indie blog', 'digital garden', 'small web',
  'interactive visualization', 'web experiment', 'creative coding',
  'obscure history', 'science explained', 'philosophy blog',
];

async function searchMarginalia(query, limit) {
  const url = `https://api.marginalia.nu/public/search/${encodeURIComponent(query)}?count=${limit}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await nodeFetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'StumbleCloneBot/1.0 (+https://stumble.danux.be/bot)' },
    });
    clearTimeout(t);
    if (!res.ok) return [];

    const data = await res.json();
    return (data.results || [])
      .filter(r => r.url)
      .map(r => ({
        url:             r.url,
        source_title:    r.title || '',
        source_score:    Math.round((r.quality || 0) * 100),
        source_metadata: { marginalia_query: query },
      }));
  } catch {
    clearTimeout(t);
    return [];
  }
}

async function fetch(options = {}) {
  const limit = options.limit || 20;
  const termsToUse = SEARCH_TERMS.slice(0, Math.ceil(limit / 3));
  const perTerm = Math.ceil(limit / termsToUse.length);

  console.log(`[Marginalia] ${termsToUse.length} requêtes de recherche (${perTerm} résultats/requête)…`);

  const all = [];
  const seen = new Set();

  for (const term of termsToUse) {
    if (all.length >= limit) break;
    const results = await searchMarginalia(term, perTerm);
    for (const r of results) {
      if (!seen.has(r.url)) {
        seen.add(r.url);
        all.push(r);
      }
    }
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`[Marginalia] ${all.length} candidats uniques`);
  return all.slice(0, limit);
}

module.exports = { name: 'marginalia', fetch };
