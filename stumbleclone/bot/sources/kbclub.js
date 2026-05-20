// 512KB Club — sites curatés légers (<512 Ko), signal de qualité et sobriété
const nodeFetch = globalThis.fetch;
const TIMEOUT_MS = 12_000;

const EXCLUDE = /512kb\.club|github\.com|twitter\.com|facebook\.com/i;

async function fetch(options = {}) {
  const limit = options.limit || 20;
  console.log(`[512kb.club] Récupération de la liste…`);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await nodeFetch('https://512kb.club', {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'StumbUpon.comBot/1.0 (+https://stumble.danux.be/bot)' },
    });
    clearTimeout(t);
    if (!res.ok) { console.error('[512kb.club] HTTP', res.status); return []; }

    const html = await res.text();
    const urls = [...html.matchAll(/href="(https?:\/\/[^"]+)"/gi)]
      .map(m => m[1])
      .filter(u => !EXCLUDE.test(u))
      .filter(u => { try { new URL(u); return true; } catch { return false; } });

    // Dédoublonner
    const unique = [...new Set(urls)];

    // Mélanger pour la variété
    for (let i = unique.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unique[i], unique[j]] = [unique[j], unique[i]];
    }

    console.log(`[512kb.club] ${unique.length} sites trouvés`);
    return unique.slice(0, limit).map(url => ({
      url,
      source_title:    '',
      source_score:    55,
      source_metadata: { kbclub: true },
    }));
  } catch (e) {
    clearTimeout(t);
    console.error('[512kb.club] Erreur:', e.message);
    return [];
  }
}

module.exports = { name: 'kbclub', fetch };
