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

const insert = db.prepare(
  'INSERT OR IGNORE INTO categories (name, slug, emoji) VALUES (@name, @slug, @emoji)'
);

const seedCategories = db.transaction(() => {
  let inserted = 0;
  for (const cat of CATEGORIES) {
    const info = insert.run(cat);
    if (info.changes > 0) inserted++;
  }
  return inserted;
});

const inserted = seedCategories();
console.log(`Seed catégories : ${inserted} ajoutée(s), ${CATEGORIES.length - inserted} déjà présente(s).`);

// Affichage de toutes les catégories pour vérification
const all = db.prepare('SELECT id, emoji, name, slug FROM categories ORDER BY id').all();
console.table(all);
