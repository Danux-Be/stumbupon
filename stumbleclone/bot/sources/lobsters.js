const nodeFetch = globalThis.fetch;
const TIMEOUT_MS = 10_000;
const LOBSTERS_URL = 'https://lobste.rs/hottest.json';

async function fetch(options = {}) {
  const limit = options.limit || 20;
  const minScore = options.minScore || 10;

  console.log(`[Lobste.rs] Récupération du flux hottest (limit=${limit}, minScore=${minScore})…`);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await nodeFetch(LOBSTERS_URL, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'StumbleCloneBot/1.0 (+https://stumble.danux.be/bot)' },
    });
    clearTimeout(t);

    if (!res.ok) {
      console.error(`[Lobste.rs] HTTP ${res.status}`);
      return [];
    }

    const stories = await res.json();
    const candidates = stories
      .filter(s => s.url && !s.url.startsWith('/') && (s.score || 0) >= minScore)
      .slice(0, limit)
      .map(s => ({
        url:             s.url,
        source_title:    s.title || '',
        source_score:    s.score || 0,
        source_metadata: { lobsters_id: s.short_id, tags: s.tags },
      }));

    console.log(`[Lobste.rs] ${candidates.length} candidats trouvés`);
    return candidates;
  } catch (err) {
    clearTimeout(t);
    console.error(`[Lobste.rs] Erreur : ${err.message}`);
    return [];
  }
}

module.exports = { name: 'lobsters', fetch };
