const nodeFetch = globalThis.fetch;
const TIMEOUT_MS = 10_000;
const WIBY_SURPRISE = 'https://wiby.me/surprise/';

async function fetchOnce() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await nodeFetch(WIBY_SURPRISE, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'StumbUpon.comBot/1.0 (+https://stumble.danux.be/bot)' },
    });
    clearTimeout(t);
    if (!res.ok) return null;

    // Wiby retourne une page avec un meta refresh pointant vers le site cible
    const html = await res.text();
    const match = html.match(/meta[^>]+http-equiv=["']refresh["'][^>]+URL=([^"'\s>]+)/i)
                || html.match(/meta[^>]+content=["'][^"']*URL=([^"'\s>]+)/i);
    return match ? match[1].trim() : null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

async function fetch(options = {}) {
  const limit = options.limit || 20;
  console.log(`[Wiby] Récupération de ${limit} pages aléatoires…`);

  const candidates = [];
  let attempts = 0;
  const maxAttempts = limit * 3;

  while (candidates.length < limit && attempts < maxAttempts) {
    attempts++;
    const url = await fetchOnce();
    if (url && !candidates.find(c => c.url === url)) {
      candidates.push({
        url,
        source_title: '',
        source_score: 50, // score neutre — Wiby ne fournit pas de score
        source_metadata: { wiby: true },
      });
    }
    // Courtoisie : pause 500ms entre chaque requête
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[Wiby] ${candidates.length} candidats trouvés (${attempts} tentatives)`);
  return candidates;
}

module.exports = { name: 'wiby', fetch };
