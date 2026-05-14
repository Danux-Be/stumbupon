const db = require('../../db/database');

const KEYWORDS = {
  programmation:  ['javascript','python','rust','golang','node','react','typescript','css','html','api','github','code','software','developer','programming','framework','linux','terminal','bash','algorithm','compiler','open.source'],
  technologie:    ['ai','machine learning','llm','gpt','hardware','chip','processor','robot','drone','electric','battery','startup','tech','silicon','quantum','neural'],
  science:        ['physics','biology','chemistry','neuroscience','climate','evolution','dna','genome','experiment','research','study','discovery','quantum','astrophysics','geology'],
  mathematiques:  ['math','geometry','topology','algebra','calculus','prime','number theory','proof','statistics','probability','combinatorics','graph theory'],
  astronomie:     ['space','nasa','telescope','planet','star','galaxy','orbit','comet','asteroid','cosmos','universe','black hole','mars','moon','rocket'],
  psychologie:    ['psychology','cognitive','behavior','mental','brain','therapy','bias','decision','habit','motivation','anxiety','mindset','emotion'],
  philosophie:    ['philosophy','ethics','consciousness','metaphysics','epistemology','logic','stoic','existential','moral','free will','identity'],
  histoire:       ['history','ancient','medieval','war','civilization','empire','revolution','historical','archaeology','museum','archive','century'],
  litterature:    ['book','novel','essay','fiction','poetry','writing','author','literature','read','story','narrative','prose'],
  art:            ['art','painting','drawing','illustration','design','creative','visual','gallery','artist','sculpture','craft','canvas'],
  musique:        ['music','song','album','band','composer','jazz','classical','guitar','piano','sound','audio','melody','rhythm'],
  cinema:         ['film','movie','cinema','director','documentary','animation','video','youtube','short film','screenplay'],
  photographie:   ['photo','photography','camera','lens','portrait','landscape','street photography','exposure','darkroom'],
  design:         ['design','ux','ui','typography','color','layout','interface','figma','sketch','brand','logo','font'],
  architecture:   ['architecture','building','urban','city','construction','interior','space','structure','housing','architect'],
  jeux_video:     ['game','gaming','indie','pixel','nintendo','playstation','steam','rpg','fps','strategy','retro game'],
  cuisine:        ['food','recipe','cooking','cuisine','restaurant','ingredient','bread','ferment','baking','chef'],
  nature:         ['nature','forest','ocean','wildlife','ecology','plant','animal','garden','bird','hiking','environment'],
  voyage:         ['travel','city','country','culture','language','map','geography','explore','journey','destination'],
  sport:          ['sport','running','cycling','climbing','football','basketball','swimming','fitness','athlete','marathon'],
  diy:            ['diy','build','maker','3d print','electronics','arduino','woodwork','repair','craft','hack','project'],
  economie:       ['economy','finance','market','investment','startup','business','entrepreneur','money','trade','blockchain'],
  politique:      ['politics','democracy','election','policy','government','society','human rights','activism','freedom'],
  humour:         ['funny','humor','satire','comedy','joke','meme','parody','absurd','weird','quirky','bizarre'],
  curiosites:     ['weird','obscure','hidden','unknown','secret','strange','unusual','rare','fascinating','interesting','surprising','collection','trivia'],
};

let catCache = null;
function getCategories() {
  if (!catCache) catCache = db.prepare('SELECT id, slug FROM categories').all();
  return catCache;
}

function classify(text) {
  const lower = (text || '').toLowerCase();
  const matched = new Set();

  for (const [slug, keywords] of Object.entries(KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        matched.add(slug);
        break;
      }
    }
  }

  const cats = getCategories();
  // Normalise les slugs avec tiret (jeux-video) vs underscore (jeux_video)
  return cats
    .filter(c => matched.has(c.slug) || matched.has(c.slug.replace('-', '_')))
    .map(c => c.id);
}

module.exports = { classify };
