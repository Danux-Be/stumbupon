// MetaFilter — curation humaine de qualité depuis 1999
// Le RSS pointe vers les threads MeFi ; l'URL externe est dans la description
const nodeFetch = globalThis.fetch;
const TIMEOUT_MS = 12_000;

const MEFI_HOSTS = /metafilter\.com|mefi\.us/i;

function extractExternalLink(html) {
  const rx = /href=["'](https?:\/\/[^"'\s>]+)["']/gi;
  let m;
  while ((m = rx.exec(html)) !== null) {
    if (!MEFI_HOSTS.test(m[1])) return m[1];
  }
  return null;
}

function parseRss(xml) {
  const items = [];
  const itemRx = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const body  = m[1];
    const title = (body.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                   body.match(/<title>([^<]+)<\/title>/))?.[1]?.trim() || '';
    const desc  = (body.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
                   body.match(/<description>([^<]*)<\/description>/))?.[1] || '';
    const link  = extractExternalLink(desc);
    if (link) items.push({ title, link });
  }
  return items;
}

async function fetch(options = {}) {
  const limit = options.limit || 20;
  console.log(`[MetaFilter] Récupération du RSS front page…`);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await nodeFetch('https://www.metafilter.com/rss.xml', {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'StumbUpon.comBot/1.0 (+https://stumble.danux.be/bot)' },
    });
    clearTimeout(t);
    if (!res.ok) { console.error('[MetaFilter] HTTP', res.status); return []; }

    const items = parseRss(await res.text());
    console.log(`[MetaFilter] ${items.length} liens externes extraits`);
    return items.slice(0, limit).map(item => ({
      url:             item.link,
      source_title:    item.title,
      source_score:    70,
      source_metadata: { metafilter: true },
    }));
  } catch (e) {
    clearTimeout(t);
    console.error('[MetaFilter] Erreur:', e.message);
    return [];
  }
}

module.exports = { name: 'metafilter', fetch };
