const HN_BASE = 'https://hacker-news.firebaseio.com/v0';
const MIN_SCORE = 100;
const FETCH_TIMEOUT = 8_000;

const nodeFetch = globalThis.fetch;

async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await nodeFetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok ? res.json() : null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

async function fetch(options = {}) {
  const limit = options.limit || 20;
  const minScore = options.minScore || MIN_SCORE;

  console.log(`[HN] Récupération des best stories (limit=${limit}, minScore=${minScore})…`);

  const ids = await fetchWithTimeout(`${HN_BASE}/beststories.json`);
  if (!Array.isArray(ids)) {
    console.error('[HN] Impossible de récupérer les IDs');
    return [];
  }

  const candidates = [];
  let checked = 0;

  for (const id of ids) {
    if (candidates.length >= limit) break;
    if (checked > limit * 5) break; // ne pas chercher indéfiniment

    checked++;
    const item = await fetchWithTimeout(`${HN_BASE}/item/${id}.json`);

    if (!item || !item.url) continue;
    if (item.dead || item.deleted) continue;
    if ((item.score || 0) < minScore) continue;

    candidates.push({
      url:             item.url,
      source_title:    item.title || '',
      source_score:    item.score || 0,
      source_metadata: { hn_id: item.id, by: item.by, time: item.time },
    });
  }

  console.log(`[HN] ${candidates.length} candidats trouvés (${checked} items vérifiés)`);
  return candidates;
}

module.exports = { name: 'hackernews', fetch };
