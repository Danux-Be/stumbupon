const nodeFetch = globalThis.fetch;
const TIMEOUT_MS = 15_000;

// Listes curatées dont les READMEs contiennent des URLs de vrais sites web
const AWESOME_LISTS = [
  // Design et ressources créatives
  { repo: 'bradtraversy/design-resources-for-developers', branch: 'master' },
  { repo: 'nicolesaidy/awesome-web-design',               branch: 'master' },
  { repo: 'kosmos/awesome-generative-art',                branch: 'master' },
  { repo: 'terkelg/awesome-creative-coding',              branch: 'master' },
  // Outils et productivité
  { repo: 'jyguyomarch/awesome-productivity',             branch: 'master' },
  { repo: 'pluja/awesome-privacy',                        branch: 'master' },
  // Science et données
  { repo: 'academic/awesome-datascience',                 branch: 'master' },
  { repo: 'owainlewis/awesome-artificial-intelligence',   branch: 'master' },
  // Musique et art
  { repo: 'ciconia/awesome-music',                        branch: 'master' },
  // Jeux et interactif
  { repo: 'leereilly/games',                              branch: 'master' },
  // Web et exploration
  { repo: 'sindresorhus/awesome-nodejs',                  branch: 'main'   },
  { repo: 'trimstray/the-book-of-secret-knowledge',       branch: 'master' },
];

// Domaines à exclure : hébergement de code, packages, CI, badges…
const SKIP_DOMAINS = new Set([
  'github.com', 'gitlab.com', 'bitbucket.org',
  'npmjs.com', 'pypi.org', 'packagist.org', 'rubygems.org', 'crates.io',
  'raw.githubusercontent.com', 'shields.io', 'img.shields.io',
  'travis-ci.org', 'travis-ci.com', 'circleci.com', 'codecov.io',
  'coveralls.io', 'snyk.io', 'dependabot.com',
  'youtube.com', 'youtu.be', 'twitter.com', 'x.com',
  'linkedin.com', 'facebook.com', 'instagram.com',
  'wikipedia.org', 'medium.com', 'dev.to',
  'opensource.org', 'creativecommons.org',
]);

function extractUrls(markdown, repoName) {
  const results = [];
  // Liens markdown [texte](url) ou [texte](url "titre")
  const mdLinkRe = /\[([^\]]{3,120})\]\((https?:\/\/[^)\s"]{10,})/g;
  let m;

  while ((m = mdLinkRe.exec(markdown)) !== null) {
    const [, text, url] = m;

    try {
      const u = new URL(url);
      const domain = u.hostname.replace(/^www\./, '');

      if (SKIP_DOMAINS.has(domain)) continue;
      if (domain.endsWith('.github.io') && !isInterestingSite(u)) continue;
      // Ignorer les images et fichiers statiques
      if (/\.(png|jpg|jpeg|gif|svg|ico|pdf|zip|tar|gz|exe)$/i.test(u.pathname)) continue;

      results.push({
        url:          url.split('"')[0].split(' ')[0], // nettoyer les titres inline
        source_title: text.trim(),
        source_score: 50,
        source_metadata: { repo: repoName },
      });
    } catch {
      // URL malformée — ignorer
    }
  }

  return results;
}

function isInterestingSite(u) {
  // Les pages github.io qui ne sont pas des badges/stats sont souvent des projets web
  return u.pathname.length > 1;
}

async function fetchReadme(repo, branch) {
  const token = process.env.GITHUB_TOKEN;
  const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/README.md`;

  const headers = { 'User-Agent': 'StumbleCloneBot/1.0 (+https://stumble.danux.be/bot)' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await nodeFetch(rawUrl, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      // Essayer readme.md en minuscule
      const res2 = await nodeFetch(rawUrl.replace('README.md', 'readme.md'), {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res2.ok) {
        console.warn(`[GitHub] ${repo} → HTTP ${res.status}`);
        return null;
      }
      return res2.text();
    }

    return res.text();
  } catch (err) {
    console.warn(`[GitHub] ${repo} erreur : ${err.message}`);
    return null;
  }
}

async function fetch(options = {}) {
  const limitPerRepo = Math.max(5, Math.ceil((options.limit || 30) / AWESOME_LISTS.length));
  console.log(`[GitHub] ${AWESOME_LISTS.length} awesome lists × ${limitPerRepo} URLs max/repo`);

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log('[GitHub] Pas de GITHUB_TOKEN — mode anonyme (60 req/h)');
  }

  const all = [];
  const seen = new Set();

  for (const { repo, branch } of AWESOME_LISTS) {
    const markdown = await fetchReadme(repo, branch);
    if (!markdown) continue;

    const urls = extractUrls(markdown, repo);

    // Déduplication locale inter-repos
    const fresh = urls.filter(u => !seen.has(u.url));
    fresh.forEach(u => seen.add(u.url));

    const picked = fresh.slice(0, limitPerRepo);
    console.log(`[GitHub] ${repo} → ${urls.length} URLs extraites, ${picked.length} retenues`);
    all.push(...picked);

    // Pause courtoise entre les repos
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[GitHub] ${all.length} candidats au total`);
  return all;
}

module.exports = { name: 'github', fetch };
