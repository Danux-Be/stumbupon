// Pinboard — signets publics populaires, très diversifiés
const nodeFetch = globalThis.fetch;
const TIMEOUT_MS = 12_000;

function parseRss(xml) {
  const items = [];
  const itemRx = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const body  = m[1];
    const title = (body.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                   body.match(/<title>([^<]+)<\/title>/))?.[1]?.trim() || '';
    const link  = body.match(/<link>([^<]+)<\/link>/)?.[1]?.trim() || '';
    if (link.startsWith('http')) items.push({ title, link });
  }
  return items;
}

async function fetch(options = {}) {
  const limit = options.limit || 20;
  console.log(`[Pinboard] Récupération des signets populaires…`);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await nodeFetch('https://feeds.pinboard.in/rss/popular/', {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'StumbUpon.comBot/1.0 (+https://stumble.danux.be/bot)' },
    });
    clearTimeout(t);
    if (!res.ok) { console.error('[Pinboard] HTTP', res.status); return []; }

    const items = parseRss(await res.text());
    console.log(`[Pinboard] ${items.length} items extraits`);
    return items.slice(0, limit).map(item => ({
      url:             item.link,
      source_title:    item.title,
      source_score:    60,
      source_metadata: { pinboard: true },
    }));
  } catch (e) {
    clearTimeout(t);
    console.error('[Pinboard] Erreur:', e.message);
    return [];
  }
}

module.exports = { name: 'pinboard', fetch };
