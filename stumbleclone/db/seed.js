require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db = require('./database');

const CATEGORIES = [
  { name: 'Art',           slug: 'art',           emoji: '🎨' },
  { name: 'Photographie',  slug: 'photographie',  emoji: '📷' },
  { name: 'Science',       slug: 'science',       emoji: '🔬' },
  { name: 'Technologie',   slug: 'technologie',   emoji: '💻' },
  { name: 'Programmation', slug: 'programmation', emoji: '👨‍💻' },
  { name: 'Histoire',      slug: 'histoire',      emoji: '📜' },
  { name: 'Philosophie',   slug: 'philosophie',   emoji: '🧠' },
  { name: 'Musique',       slug: 'musique',       emoji: '🎵' },
  { name: 'Cinéma',        slug: 'cinema',        emoji: '🎬' },
  { name: 'Littérature',   slug: 'litterature',   emoji: '📚' },
  { name: 'Jeux vidéo',    slug: 'jeux-video',    emoji: '🎮' },
  { name: 'Cuisine',       slug: 'cuisine',       emoji: '🍳' },
  { name: 'Voyage',        slug: 'voyage',        emoji: '✈️' },
  { name: 'Nature',        slug: 'nature',        emoji: '🌿' },
  { name: 'Sport',         slug: 'sport',         emoji: '⚽' },
  { name: 'Humour',        slug: 'humour',        emoji: '😂' },
  { name: 'DIY/Bricolage', slug: 'diy',           emoji: '🔧' },
  { name: 'Design',        slug: 'design',        emoji: '✏️' },
  { name: 'Architecture',  slug: 'architecture',  emoji: '🏛️' },
  { name: 'Mathématiques', slug: 'mathematiques', emoji: '📐' },
  { name: 'Astronomie',    slug: 'astronomie',    emoji: '🔭' },
  { name: 'Psychologie',   slug: 'psychologie',   emoji: '🧬' },
  { name: 'Économie',      slug: 'economie',      emoji: '📈' },
  { name: 'Politique',     slug: 'politique',     emoji: '🏛' },
  { name: 'Curiosités',    slug: 'curiosites',    emoji: '🤔' },
];

// Traductions : [slug, fr, en, nl, de]
const TRANSLATIONS = [
  ['art',           'Art',           'Art',          'Kunst',          'Kunst'],
  ['photographie',  'Photographie',  'Photography',  'Fotografie',     'Fotografie'],
  ['science',       'Science',       'Science',      'Wetenschap',     'Wissenschaft'],
  ['technologie',   'Technologie',   'Technology',   'Technologie',    'Technologie'],
  ['programmation', 'Programmation', 'Programming',  'Programmeren',   'Programmierung'],
  ['histoire',      'Histoire',      'History',      'Geschiedenis',   'Geschichte'],
  ['philosophie',   'Philosophie',   'Philosophy',   'Filosofie',      'Philosophie'],
  ['musique',       'Musique',       'Music',        'Muziek',         'Musik'],
  ['cinema',        'Cinéma',        'Cinema',       'Film',           'Kino'],
  ['litterature',   'Littérature',   'Literature',   'Literatuur',     'Literatur'],
  ['jeux-video',    'Jeux vidéo',    'Video Games',  'Videospellen',   'Videospiele'],
  ['cuisine',       'Cuisine',       'Cooking',      'Koken',          'Kochen'],
  ['voyage',        'Voyage',        'Travel',       'Reizen',         'Reisen'],
  ['nature',        'Nature',        'Nature',       'Natuur',         'Natur'],
  ['sport',         'Sport',         'Sport',        'Sport',          'Sport'],
  ['humour',        'Humour',        'Humor',        'Humor',          'Humor'],
  ['diy',           'DIY/Bricolage', 'DIY',          'Knutselen',      'Heimwerken'],
  ['design',        'Design',        'Design',       'Ontwerp',        'Design'],
  ['architecture',  'Architecture',  'Architecture', 'Architectuur',   'Architektur'],
  ['mathematiques', 'Mathématiques', 'Mathematics',  'Wiskunde',       'Mathematik'],
  ['astronomie',    'Astronomie',    'Astronomy',    'Astronomie',     'Astronomie'],
  ['psychologie',   'Psychologie',   'Psychology',   'Psychologie',    'Psychologie'],
  ['economie',      'Économie',      'Economics',    'Economie',       'Wirtschaft'],
  ['politique',     'Politique',     'Politics',     'Politiek',       'Politik'],
  ['curiosites',    'Curiosités',    'Curiosities',  'Curiositeiten',  'Kuriositäten'],
];

const insertCat = db.prepare(
  'INSERT OR IGNORE INTO categories (name, slug, emoji) VALUES (@name, @slug, @emoji)'
);
const insertTr = db.prepare(
  'INSERT OR IGNORE INTO category_translations (category_id, language, name) VALUES (?, ?, ?)'
);
const getCatId = db.prepare('SELECT id FROM categories WHERE slug = ?');

const seedAll = db.transaction(() => {
  let catInserted = 0;
  let trInserted = 0;

  for (const cat of CATEGORIES) {
    const info = insertCat.run(cat);
    if (info.changes > 0) catInserted++;
  }

  for (const [slug, fr, en, nl, de] of TRANSLATIONS) {
    const row = getCatId.get(slug);
    if (!row) continue;
    const id = row.id;
    for (const [lang, name] of [['fr', fr], ['en', en], ['nl', nl], ['de', de]]) {
      const info = insertTr.run(id, lang, name);
      if (info.changes > 0) trInserted++;
    }
  }

  return { catInserted, trInserted };
});

const { catInserted, trInserted } = seedAll();
console.log(`Catégories : ${catInserted} ajoutée(s).`);
console.log(`Traductions : ${trInserted} ajoutée(s).`);

const all = db.prepare('SELECT id, emoji, name, slug FROM categories ORDER BY id').all();
console.table(all);
