// Tildes.net — agrégateur communautaire modéré, groupes thématiques
// Les posts de type "lien" ont l'URL externe dans la description RSS
const nodeFetch = globalThis.fetch;
const TIMEOUT_MS = 12_000;

// Groupes disponibles sur tildes.net
const GROUPS = ['comp', 'science', 'tech', 'creative', 'games', 'music', 'books', 'life', 'talk'];

function extractUrl(text) {
  const m = text.match(/(https?:\/\/[^\s<>"]+)/);
  return (m && !m[1].includes('tildes.net')) ? m[1] : null;
}

function parseRss(xml, group) {
  const items = [];
  const itemRx = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const body  = m[1];
    const title = (body.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                   body.match(/<title>([^<]+)<\/title>/))?.[1]?.trim() || '';
    const desc  = (body.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
                   body.match(/<description>([^<]*)<\/description>/))?.[1]?.trim() || '';
    const link  = extractUrl(desc);
    if (link) items.push({ title, link, group });
  }
  return items;
}

async function fetchGroup(group) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await nodeFetch(`https://tildes.net/~${group}.rss`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'StumbUpon.comBot/1.0 (+https://stumble.danux.be/bot)' },
    });
    clearTimeout(t);
    if (!res.ok) return [];
    return parseRss(await res.text(), group);
  } catch { clearTimeout(t); return []; }
}

async function fetch(options = {}) {
  const limit = options.limit || 20;
  console.log(`[Tildes] Récupération de ${GROUPS.length} groupes…`);

  const all  = [];
  const seen = new Set();

  for (const group of GROUPS) {
    if (all.length >= limit) break;
    const items = await fetchGroup(group);
    for (const item of items) {
      if (!seen.has(item.link)) {
        seen.add(item.link);
        all.push({
          url:             item.link,
          source_title:    item.title,
          source_score:    65,
          source_metadata: { tildes_group: item.group },
        });
      }
    }
    await new Promise(r => setTimeout(r, 600));
  }

  console.log(`[Tildes] ${all.length} candidats`);
  return all.slice(0, limit);
}

module.exports = { name: 'tildes', fetch };
