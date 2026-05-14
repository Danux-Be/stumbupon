const TIMEOUT_MS = 10_000;
const UA = 'StumbleCloneBot/1.0 (discovery bot; not for scraping)';

const SPAM_KEYWORDS = /\b(casino|poker|slots|crypto\s*scam|buy\s*followers|payday\s*loan|viagra|cialis|xxx|porn|escort)\b/i;

async function enrichUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let riskScore = 50;
  let title = null;
  let language = null;
  let finalUrl = url;

  let canEmbed = true;

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    clearTimeout(timer);

    finalUrl = res.url;

    // Vérifier si le site autorise l'intégration en iframe
    const xfo = res.headers.get('x-frame-options') || '';
    if (/deny|sameorigin/i.test(xfo)) canEmbed = false;

    const csp = res.headers.get('content-security-policy') || '';
    if (/frame-ancestors\s+['"]?none['"]?/i.test(csp)) canEmbed = false;
    else if (/frame-ancestors/i.test(csp) && !/frame-ancestors[^;]*\*/i.test(csp)) canEmbed = false;

    // Bonus HTTPS
    if (new URL(finalUrl).protocol === 'https:') riskScore -= 20;

    // Malus si redirect vers domaine différent
    const origHost = new URL(url).hostname;
    const finalHost = new URL(finalUrl).hostname;
    if (origHost !== finalHost && !finalHost.endsWith('.' + origHost) && !origHost.endsWith('.' + finalHost)) {
      riskScore += 25;
    }

    if (!res.ok) {
      riskScore += 20;
      return { title, language, riskScore: Math.min(100, riskScore), canEmbed: false };
    }

    // Bonus si réponse rapide (heuristique : pas de timeout = bon signe)
    riskScore -= 10;

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) {
      return { title, language, riskScore: Math.min(100, riskScore) };
    }

    const reader = res.body.getReader();
    let chunk = '';
    let done = false;
    while (!done && chunk.length < 20_000) {
      const { value, done: d } = await reader.read();
      done = d;
      if (value) chunk += new TextDecoder().decode(value);
    }
    reader.cancel();

    const titleMatch = chunk.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : null;

    const langMatch = chunk.match(/<html[^>]+lang=["']([a-zA-Z-]{2,10})["']/i);
    language = langMatch ? langMatch[1].slice(0, 2).toLowerCase() : null;

    // Malus si pas de title ou pas de description meta
    if (!title) riskScore += 10;
    const hasDesc = /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{10}/i.test(chunk);
    if (!hasDesc) riskScore += 10;

    // Malus si mots-clés spam
    if (SPAM_KEYWORDS.test(title || '') || SPAM_KEYWORDS.test(chunk.slice(0, 5000))) {
      riskScore += 50;
    }

    // Bonus si lang est une langue supportée
    if (language && ['fr', 'en', 'nl', 'de'].includes(language)) riskScore -= 10;

  } catch {
    clearTimeout(timer);
    riskScore += 30;
    canEmbed = false; // site inaccessible
  }

  return { title, language, riskScore: Math.max(0, Math.min(100, riskScore)), canEmbed };
}

module.exports = { enrichUrl };
