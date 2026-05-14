const nodeFetch = globalThis.fetch;
const TIMEOUT_MS = 12_000;

const SUBREDDITS = [
  { name: 'InternetIsBeautiful', minScore: 200 },
  { name: 'ObscureMedia',        minScore: 100 },
  { name: 'WebGames',            minScore: 150 },
  { name: 'RabbitHole',          minScore: 100 },
  { name: 'DepthHub',            minScore: 150 },
  { name: 'UsefulWebsites',      minScore: 200 },
];

// Cache du token OAuth (valide 1h)
let _token = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const clientId     = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('REDDIT_CLIENT_ID et REDDIT_CLIENT_SECRET requis dans .env');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await nodeFetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'User-Agent':    'StumbleCloneBot/1.0 (+https://stumble.danux.be/bot)',
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Authentification Reddit échouée (HTTP ${res.status}) : ${body}`);
  }

  const data = await res.json();
  _token = data.access_token;
  // expires_in est en secondes, on enlève 60s de marge
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  console.log(`[Reddit] Token OAuth obtenu (expire dans ${Math.round(data.expires_in / 60)} min)`);
  return _token;
}

async function fetchSubreddit(sub, limit, minScore, token) {
  const url = `https://oauth.reddit.com/r/${sub}/top.json?t=month&limit=100`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await nodeFetch(url, {
      signal: ctrl.signal,
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent':    'StumbleCloneBot/1.0 (+https://stumble.danux.be/bot)',
        'Accept':        'application/json',
      },
    });
    clearTimeout(t);

    if (!res.ok) {
      console.warn(`[Reddit] r/${sub} → HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    const posts = data?.data?.children || [];

    return posts
      .map(p => p.data)
      .filter(p =>
        p.url &&
        !p.url.includes('reddit.com') &&
        !p.url.includes('redd.it') &&
        !p.is_self &&
        (p.score || 0) >= minScore
      )
      .slice(0, limit)
      .map(p => ({
        url:             p.url,
        source_title:    p.title || '',
        source_score:    p.score || 0,
        source_metadata: { subreddit: sub, reddit_id: p.id },
      }));
  } catch (err) {
    clearTimeout(t);
    console.warn(`[Reddit] r/${sub} erreur : ${err.message}`);
    return [];
  }
}

async function fetch(options = {}) {
  const clientId = process.env.REDDIT_CLIENT_ID;
  if (!clientId) {
    console.warn('[Reddit] REDDIT_CLIENT_ID non configuré — source ignorée');
    return [];
  }

  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    console.error(`[Reddit] Impossible d'obtenir un token : ${err.message}`);
    return [];
  }

  const limitPerSub = Math.ceil((options.limit || 20) / SUBREDDITS.length);
  console.log(`[Reddit] ${SUBREDDITS.length} subreddits × ${limitPerSub} candidats max/sub`);

  const all = [];
  for (const { name, minScore } of SUBREDDITS) {
    const results = await fetchSubreddit(name, limitPerSub, minScore, token);
    console.log(`[Reddit] r/${name} → ${results.length} candidats`);
    all.push(...results);
    // Rate limit courtois : 1 req/s
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`[Reddit] ${all.length} candidats au total`);
  return all;
}

module.exports = { name: 'reddit', fetch };
