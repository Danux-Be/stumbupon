const express = require('express');
const db = require('../db/database');

const router = express.Router();

const stmtSitemap = db.prepare(`
  SELECT id, approved_at
  FROM sites
  WHERE status = 'approved'
  ORDER BY approved_at DESC
  LIMIT 10000
`);

const stmtFeed = db.prepare(`
  SELECT s.id, s.url, s.title, s.description, s.language, s.approved_at
  FROM sites s
  WHERE s.status = 'approved'
  ORDER BY s.approved_at DESC
  LIMIT 50
`);

const stmtFeedCategories = db.prepare(`
  SELECT sc.site_id, c.name, c.emoji
  FROM site_categories sc
  JOIN categories c ON c.id = sc.category_id
  WHERE sc.site_id IN (SELECT value FROM json_each(?))
  ORDER BY c.name
`);

function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function xmlEsc(s) {
  if (!s) return '';
  return decodeHtmlEntities(String(s))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toRFC822(dateStr) {
  if (!dateStr) return new Date().toUTCString();
  return new Date(String(dateStr).replace(' ', 'T') + 'Z').toUTCString();
}

router.get('/sitemap.xml', (req, res) => {
  const base = process.env.BASE_URL || 'https://stumbupon.com';

  const staticPages = [
    { loc: `${base}/`,        changefreq: 'daily',   priority: '1.0' },
    { loc: `${base}/about`,   changefreq: 'monthly', priority: '0.8' },
    { loc: `${base}/search`,  changefreq: 'weekly',  priority: '0.7' },
    { loc: `${base}/legal`,   changefreq: 'yearly',  priority: '0.3' },
    { loc: `${base}/privacy`, changefreq: 'yearly',  priority: '0.3' },
    { loc: `${base}/optout`,  changefreq: 'yearly',  priority: '0.3' },
  ];

  const today = new Date().toISOString().slice(0, 10);
  const sites = stmtSitemap.all();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  for (const p of staticPages) {
    xml += `  <url>\n    <loc>${p.loc}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>\n`;
  }

  for (const s of sites) {
    const lastmod = s.approved_at ? String(s.approved_at).slice(0, 10) : today;
    xml += `  <url>\n    <loc>${base}/stumble/${s.id}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.5</priority>\n  </url>\n`;
  }

  xml += `</urlset>`;
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.send(xml);
});

router.get('/feed.xml', (req, res) => {
  const base = process.env.BASE_URL || 'https://stumbupon.com';
  const sites = stmtFeed.all();

  const ids = JSON.stringify(sites.map(s => s.id));
  const cats = stmtFeedCategories.all(ids);
  const catsBySite = {};
  for (const c of cats) {
    if (!catsBySite[c.site_id]) catsBySite[c.site_id] = [];
    catsBySite[c.site_id].push(c);
  }

  const buildDate = sites.length ? toRFC822(sites[0].approved_at) : new Date().toUTCString();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n`;
  xml += `  <channel>\n`;
  xml += `    <title>StumbUpon.com — nouveaux sites</title>\n`;
  xml += `    <link>${base}</link>\n`;
  xml += `    <description>Les derniers sites ajoutés au catalogue StumbUpon.com. Un clic, un site.</description>\n`;
  xml += `    <language>fr</language>\n`;
  xml += `    <lastBuildDate>${buildDate}</lastBuildDate>\n`;
  xml += `    <atom:link href="${base}/feed.xml" rel="self" type="application/rss+xml"/>\n`;
  xml += `    <image>\n`;
  xml += `      <url>${base}/og-image.png</url>\n`;
  xml += `      <title>StumbUpon.com</title>\n`;
  xml += `      <link>${base}</link>\n`;
  xml += `    </image>\n`;

  for (const site of sites) {
    const siteCats = catsBySite[site.id] || [];
    const stumbleUrl = `${base}/stumble/${site.id}`;
    const desc = site.description
      ? xmlEsc(site.description)
      : xmlEsc(site.url);

    xml += `    <item>\n`;
    xml += `      <title>${xmlEsc(site.title || site.url)}</title>\n`;
    xml += `      <link>${stumbleUrl}</link>\n`;
    xml += `      <guid isPermaLink="true">${stumbleUrl}</guid>\n`;
    xml += `      <description>${desc}</description>\n`;
    xml += `      <pubDate>${toRFC822(site.approved_at)}</pubDate>\n`;
    for (const cat of siteCats) {
      xml += `      <category>${xmlEsc(cat.emoji + ' ' + cat.name)}</category>\n`;
    }
    xml += `    </item>\n`;
  }

  xml += `  </channel>\n</rss>`;
  res.set('Content-Type', 'application/rss+xml; charset=utf-8');
  res.send(xml);
});

module.exports = router;
