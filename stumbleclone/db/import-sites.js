require('dotenv').config();
const path = require('path');
const db = require('./database');
const sites = require('./seed-sites.json');

const getCatId = db.prepare('SELECT id FROM categories WHERE slug = ?');

const insertSite = db.prepare(`
  INSERT OR IGNORE INTO sites (url, title, description, status, language, submitted_by, approved_at)
  VALUES (@url, @title, @description, 'approved', @language, NULL, CURRENT_TIMESTAMP)
`);

const insertSiteCat = db.prepare(
  'INSERT OR IGNORE INTO site_categories (site_id, category_id) VALUES (?, ?)'
);

const getSiteId = db.prepare('SELECT id FROM sites WHERE url = ?');

let inserted = 0;
let skipped = 0;
let catLinks = 0;
let unknownSlugs = [];

const importAll = db.transaction(() => {
  for (const site of sites) {
    const info = insertSite.run({
      url: site.url,
      title: site.title,
      description: site.description,
      language: site.language,
    });

    let siteId;
    if (info.changes === 1) {
      siteId = info.lastInsertRowid;
      inserted++;
    } else {
      siteId = getSiteId.get(site.url)?.id;
      skipped++;
    }

    for (const slug of (site.categories || [])) {
      const cat = getCatId.get(slug);
      if (!cat) {
        if (!unknownSlugs.includes(slug)) unknownSlugs.push(slug);
        continue;
      }
      const linkInfo = insertSiteCat.run(siteId, cat.id);
      catLinks += linkInfo.changes;
    }
  }
});

importAll();

console.log(`\n✅ Import terminé`);
console.log(`   ${inserted} sites insérés`);
console.log(`   ${skipped} déjà présents (ignorés)`);
console.log(`   ${catLinks} liens site↔catégorie créés`);
if (unknownSlugs.length) {
  console.warn(`\n⚠️  Slugs de catégories inconnus : ${unknownSlugs.join(', ')}`);
}
