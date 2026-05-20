# StumbUpon.com — Cahier des charges

Recréation moderne et open d'un service de découverte aléatoire du web inspiré de StumbleUpon. L'utilisateur clique sur un bouton « Stumble » et est envoyé sur un site web aléatoire correspondant à ses centres d'intérêt. Il peut voter (pouce vert / pouce rouge), ce qui affine ses recommandations futures.

---

## 0. Principes directeurs (leçons tirées de la chute de StumbleUpon)

L'original StumbleUpon a fermé en 2018 après 16 ans d'existence. En analysant les causes de sa chute, on extrait cinq principes qui doivent guider toutes les décisions de design et de développement de ce projet :

### Principe 1 — La qualité du catalogue prime sur la quantité
StumbleUpon a vu son algo dégénérer en montrant de plus en plus de contenu spammeux et SEO. Quand la magie de la découverte se transforme en frustration, les utilisateurs partent. **Conséquence pratique** : on préfère 200 sites soigneusement curatés à 200 000 sites moyens. La modération humaine est notre avantage compétitif, pas une corvée.

### Principe 2 — Pas de pression de monétisation = liberté de rester pur
StumbleUpon a fini par devoir afficher des « stumbles sponsorisés » pour générer du revenu, ce qui a accéléré sa perte de crédibilité. Notre projet n'a pas d'investisseurs, pas d'obligation de croissance, pas besoin de monétiser. **Conséquence pratique** : on assume d'emblée que c'est un projet à coût d'hébergement modeste, géré par passion. Pas de pub, pas de tracking, pas de contenu sponsorisé. Si un jour le coût devient un problème, on passera par du dons/Patreon/Tipeee, jamais par de la pub injectée dans le flux.

### Principe 3 — L'expérience doit être impeccable
Les bugs sur l'extension Chrome et l'app mobile de StumbleUpon ont précipité son déclin. Sur un produit dont la valeur est entièrement dans le « clic suivant », chaque friction est mortelle. **Conséquence pratique** : on privilégie une stack simple et robuste, on teste à chaque étape, on optimise les temps de chargement. Pas de fioritures qui ralentissent. Le bouton Stumble doit répondre en moins de 200ms.

### Principe 4 — Résister au scroll infini
Le vrai concurrent qui a tué StumbleUpon, c'est Facebook, Instagram, TikTok — l'habitude du scroll passif. Nous, on assume le contre-pied : un seul site à la fois, pas de feed, pas de notifications, pas de mécaniques addictives manipulatoires. **Conséquence pratique** : pas de score, pas de niveaux, pas de gamification. Pas d'app mobile native qui pousse des notifs. On est un outil d'exploration, pas un piège à attention.

### Principe 5 — Préserver le web ouvert
StumbleUpon envoyait les gens vers de vrais sites externes. C'était sa faiblesse business mais sa beauté éthique. **Conséquence pratique** : on assume cette philosophie. On est un panneau indicateur vers le web, pas une destination qui capture. On valorise les petits sites indépendants, les pages perso, les projets bizarres, le contre-courant de la plateformisation.

Ces principes ne sont pas négociables : à chaque décision technique ou produit, ils doivent servir de boussole. En cas de doute, relire cette section.

---

## 1. Objectifs fonctionnels

### Cœur de l'expérience
- **Bouton Stumble** : un clic = redirection vers un site externe aléatoire, filtré par les goûts de l'utilisateur.
- **Vote pouce vert / pouce rouge** : feedback rapide qui alimente l'algo et la liste de favoris.
- **Catégories d'intérêts** : l'utilisateur choisit ses thèmes à l'inscription, modifiables ensuite.
- **Favoris** : tout site liké est automatiquement sauvegardé dans les favoris de l'utilisateur.
- **Soumission de sites** : les utilisateurs connectés peuvent soumettre de nouveaux sites avec catégories suggérées.

### Comptes utilisateurs
- Inscription email + mot de passe (hashage bcrypt).
- Login / logout, sessions persistantes (cookies httpOnly).
- Profil minimal : pseudo, email, catégories d'intérêt, date d'inscription.
- Page « mes favoris » et « mes soumissions ».

### Modération
- Toute soumission utilisateur passe en statut `pending`, invisible dans le pool de stumble tant qu'un admin n'a pas approuvé.
- Interface d'admin simple : liste des soumissions en attente, boutons approuver / rejeter, possibilité d'éditer catégories.
- Signalement par les utilisateurs (bouton « signaler ce site ») qui remet le site en revue.

---

## 2. Architecture technique

### Stack
- **Backend** : Node.js + Express
- **Base de données** : SQLite (fichier unique, parfait pour ce volume)
- **ORM léger** : `better-sqlite3` (synchrone, simple, performant) — pas besoin de Prisma à ce stade
- **Frontend** : HTML server-rendered (templates EJS ou Nunjucks) + htmx pour les interactions + Alpine.js pour le state local côté client
- **Auth** : `express-session` + `bcrypt` pour les mots de passe
- **Reverse proxy** : Caddy (déjà installé sur le VPS) avec SSL auto

### Arborescence proposée

```
stumbleclone/
├── package.json
├── server.js                 # point d'entrée Express
├── db/
│   ├── schema.sql            # création des tables
│   ├── seed.js               # données initiales (catégories + sites curatés)
│   └── stumble.db            # fichier SQLite (gitignored)
├── routes/
│   ├── auth.js               # /signup /login /logout
│   ├── stumble.js            # /stumble (le cœur)
│   ├── vote.js               # /vote/:siteId/:direction
│   ├── submit.js             # /submit (soumission de site)
│   ├── favorites.js          # /favorites
│   └── admin.js              # /admin/*
├── middleware/
│   ├── auth.js               # requireLogin, requireAdmin
│   └── errors.js
├── lib/
│   ├── recommender.js        # logique de recommandation
│   └── validators.js         # validation URL, sanitization
├── views/                    # templates EJS
│   ├── layout.ejs
│   ├── home.ejs
│   ├── stumble.ejs           # page avec iframe + toolbar
│   ├── login.ejs / signup.ejs
│   ├── favorites.ejs
│   ├── submit.ejs
│   └── admin/
├── public/                   # CSS, JS, assets statiques
│   ├── style.css
│   └── app.js
└── .env                      # SESSION_SECRET, NODE_ENV, etc.
```

---

## 3. Schéma de base de données

```sql
-- Utilisateurs
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Catégories (fixes, créées au seed)
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  emoji TEXT
);

-- Liaison user <-> catégories d'intérêt
CREATE TABLE user_interests (
  user_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, category_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- Sites du catalogue
CREATE TABLE sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',     -- pending | approved | rejected
  submitted_by INTEGER,              -- NULL si seed
  approved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Liaison site <-> catégories
CREATE TABLE site_categories (
  site_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (site_id, category_id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- Votes (un seul vote par user/site, écrasé si revoté)
CREATE TABLE votes (
  user_id INTEGER NOT NULL,
  site_id INTEGER NOT NULL,
  direction INTEGER NOT NULL,       -- 1 = up, -1 = down
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, site_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

-- Historique « vu » (pour ne pas re-servir trop vite le même site)
CREATE TABLE views (
  user_id INTEGER NOT NULL,
  site_id INTEGER NOT NULL,
  viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, site_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

-- Signalements
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  reported_by INTEGER,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved INTEGER DEFAULT 0,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Index utiles pour la perf
CREATE INDEX idx_sites_status ON sites(status);
CREATE INDEX idx_votes_user ON votes(user_id);
CREATE INDEX idx_views_user ON views(user_id);
```

---

## 4. Algorithme de recommandation (MVP)

Approche **par tags pondérés** — pas de vrai filtrage collaboratif au début (ça nécessite beaucoup d'utilisateurs pour donner des résultats utiles).

### Logique en pseudo-code

Quand l'utilisateur clique sur Stumble :

1. Récupérer ses catégories d'intérêt déclarées.
2. Calculer un **score de catégorie dynamique** = intérêts déclarés + bonus pour chaque catégorie où l'utilisateur a mis des pouces verts, malus pour les pouces rouges.
3. Sélectionner les sites `approved` qui :
   - ont au moins une catégorie en commun avec les intérêts de l'utilisateur
   - n'ont pas été vus dans les **N derniers stumbles** (ex: 50)
   - n'ont pas reçu de pouce rouge de cet utilisateur
4. Pondérer chaque site candidat par la somme des scores des catégories qu'il partage avec l'utilisateur + un facteur de popularité global (votes positifs - votes négatifs).
5. Tirage aléatoire pondéré dans le top 50 des candidats (pour garder de la sérendipité).

**Cas particuliers** :
- Nouvel utilisateur sans historique → tirage aléatoire pondéré uniquement par les intérêts déclarés + popularité globale.
- Si le pool de candidats < 10, élargir aux catégories voisines (à définir, ou simplement ignorer le filtre « non vu »).
- Si l'utilisateur a tout vu, reset partiel de son historique de vues anciennes (> 30 jours).

### Évolution future (V2)
- Vrai filtrage collaboratif item-based : « les utilisateurs qui ont aimé X ont aussi aimé Y ».
- Décroissance temporelle des votes anciens.
- Boost de fraîcheur pour les nouveaux sites approuvés.

### Transparence et tunabilité (principe 1 + principe 3)
Pour éviter la dérive vécue par StumbleUpon où l'algo devenait opaque et frustrant :
- **Page « pourquoi ce site ? »** accessible depuis chaque stumble : affiche les catégories qui ont fait matcher ce site, le score de popularité, et un lien pour ajuster ses intérêts.
- **Bouton « moins de ça »** distinct du pouce rouge : pouce rouge = je n'aime pas ce site précis ; « moins de ça » = je n'aime pas cette catégorie en ce moment, à diminuer dans mes recommandations.
- **Page « mon profil de goûts »** : montre à l'utilisateur la pondération actuelle de ses catégories, modifiable manuellement.
- **Pas de boîte noire** : l'utilisateur doit toujours pouvoir comprendre pourquoi il voit ce qu'il voit, et reprendre la main.

---

## 5. Pages et routes

### Public (sans login)
- `GET /` — landing page avec présentation + boutons signup/login.
- `GET /signup` `POST /signup` — création de compte avec choix de catégories.
- `GET /login` `POST /login` — connexion.
- `POST /logout`.
- `GET /about` — page « comment ça marche ».

### Authentifié
- `GET /stumble` — la page magique : iframe (ou redirect, voir section 6) + toolbar avec boutons vote et stumble suivant.
- `POST /vote/:siteId` — body `{direction: 1 | -1}`, htmx renvoie le site suivant.
- `POST /next` — passer au site suivant sans voter.
- `GET /favorites` — liste paginée des sites likés.
- `GET /submit` `POST /submit` — formulaire de soumission.
- `POST /report/:siteId` — signaler un site.
- `GET /settings` — modifier intérêts, mot de passe.

### Admin
- `GET /admin` — dashboard (stats : users, sites, pending).
- `GET /admin/pending` — liste des soumissions à modérer.
- `POST /admin/approve/:siteId` / `POST /admin/reject/:siteId`.
- `GET /admin/reports` — signalements ouverts.
- `GET /admin/users` — gestion utilisateurs (bannir, promouvoir).

---

## 6. Question importante : iframe ou redirection ?

L'original StumbleUpon utilisait une **toolbar en haut** + le site externe en dessous, ce qui techniquement passait par une iframe ou une extension de navigateur.

**Problème en 2026** : la plupart des sites modernes envoient un header `X-Frame-Options: DENY` ou une `Content-Security-Policy: frame-ancestors`, ce qui les empêche d'être affichés dans une iframe. Twitter, Reddit, YouTube, la quasi-totalité des gros sites refusent l'iframe.

**Trois options** :

1. **Iframe avec fallback** : on essaie d'afficher en iframe, si ça échoue (détection JS) on propose un bouton « ouvrir dans un nouvel onglet ». La toolbar reste sur notre domaine.
2. **Page intermédiaire** : on affiche une carte avec titre + description + screenshot + boutons vote, et un bouton « visiter » qui ouvre le site dans un nouvel onglet. Plus moderne, fonctionne toujours, mais perd la magie de l'immersion.
3. **Extension navigateur** (V2) : seule façon de revenir à l'expérience originale, mais c'est un autre projet entièrement.

**Recommandation pour le MVP** : option 2 (page intermédiaire). Plus simple, plus robuste, plus moderne. On peut soigner le design pour que ça reste fun. L'iframe peut être ajoutée en V2 comme fallback pour les sites qui le permettent.

---

## 7. Sécurité et bonnes pratiques

### Sécurité basique
- **Hashage des mots de passe** : bcrypt avec cost >= 12.
- **Sessions** : cookies httpOnly, secure (en prod), sameSite=lax.
- **CSRF** : token CSRF sur tous les POST (lib `csurf` ou équivalent moderne).
- **Rate limiting** : `express-rate-limit` sur login, signup, submit, vote.
- **Sanitization des inputs** : tout ce qui sera affiché doit passer par un échappement HTML (EJS le fait par défaut).
- **Protection iframe-side** : si on affiche du contenu externe en iframe, attribut `sandbox` strict.
- **Pas de tracking tiers**, pas de Google Analytics. Au max un compteur de visites maison.

### Validation des URL soumises (priorité haute)
Une URL soumise doit passer **toutes** ces vérifications avant d'être enregistrée :
- Commence par `http://` ou `https://` (préférer https).
- Longueur < 2000 caractères.
- Ne pointe pas vers `localhost`, `127.0.0.1`, IPs privées (`10.x`, `172.16-31.x`, `192.168.x`), ou IPv6 locales — protection contre les attaques SSRF.
- Ne pointe pas vers une IP brute (uniquement noms de domaine).
- N'utilise pas de ports non standards (autorisés : 80, 443 uniquement).
- Domaine valide et résolvable (DNS lookup côté serveur).
- Pas dans une blacklist de domaines connus pour spam/malware (liste à maintenir).

### Anti-spam — système en plusieurs couches

C'est LE point critique. StumbleUpon a été tué en partie par la pourriture progressive de son catalogue. On met en place une défense en profondeur :

**Couche 1 — Friction à l'inscription**
- Email obligatoire avec vérification (lien envoyé par email, statut `unverified` jusqu'à clic).
- Captcha sur signup (utiliser `hCaptcha` ou `Cloudflare Turnstile`, respectueux RGPD).
- Délai minimum entre la création du compte et la première soumission autorisée (ex: 24h ou après avoir voté sur 10 sites — montre un usage réel).

**Couche 2 — Limites de soumission**
- Maximum 3 soumissions par utilisateur par jour, 10 par semaine.
- Maximum 1 soumission en attente à la fois pour un nouveau compte (< 30 jours).
- Compteur de soumissions approuvées : un utilisateur dont 80%+ des soumissions sont approuvées débloque des limites plus larges (système de réputation).

**Couche 3 — Détection automatique au moment de la soumission**
- Vérifier que l'URL n'est pas déjà dans la BDD (déduplication).
- Récupérer la page côté serveur (avec timeout 10s, user-agent identifié) pour :
  - Vérifier qu'elle répond (status 200).
  - Extraire le title HTML pour comparaison avec le titre soumis (alerte si très différent).
  - Détecter les indicateurs de spam : redirections multiples, pages d'affiliation, contenu auto-généré, listes de mots-clés bourrées.
- Scoring automatique : chaque soumission reçoit un score de risque qui priorise l'ordre dans la file de modération.

**Couche 4 — Modération humaine**
- Toute soumission reste `pending` jusqu'à approbation manuelle. **Pas d'exception, jamais.**
- Interface admin affiche : URL, screenshot auto-généré, titre proposé, catégories proposées, score de risque, historique du soumetteur.
- Action rapide en un clic : approuver, rejeter, rejeter+bannir le soumetteur.

**Couche 5 — Surveillance continue**
- Re-vérification mensuelle automatique des sites approuvés : si un site renvoie 404, redirige vers un autre domaine, ou a changé de title radicalement → flag automatique pour re-modération.
- Système de signalement utilisateur (déjà prévu en section 1) : 3 signalements distincts sur un site → mise en quarantaine automatique en attendant revue admin.
- Décroissance d'autorité : un site qui collecte beaucoup de pouces rouges sur une fenêtre récente est automatiquement déprioriser dans l'algo, voire mis en quarantaine.

**Couche 6 — Bannissement**
- Un compte qui soumet du spam approuvé par erreur puis détecté plus tard peut être banni rétroactivement, et **toutes** ses autres soumissions repassent en revue.
- Bannissement par IP (avec parcimonie — IPs partagées) et par email.
- Liste de domaines email jetables (mailinator, etc.) bloqués à l'inscription.

### Surveillance technique
- Logs des actions sensibles (login, submit, vote massif) avec rotation.
- Alertes (email à l'admin) sur : pic anormal d'inscriptions, pic de soumissions, échec d'auth en masse.
- Sauvegardes quotidiennes de la BDD (voir section 10).

## 7bis. Internationalisation (i18n)

Le site doit être multilingue dès le départ — c'est beaucoup plus simple à intégrer dans l'architecture initiale qu'à rajouter après coup.

### Langues supportées au lancement
- **Français** (langue par défaut, public belge/francophone)
- **Anglais** (lingua franca du web)
- **Néerlandais** (Belgique, Pays-Bas)
- **Allemand** (Belgique germanophone, Allemagne, Autriche, Suisse)

Architecture extensible pour ajouter d'autres langues facilement (espagnol, italien, etc.) sans toucher au code.

### Détection automatique de la langue
À la première visite (utilisateur non connecté, pas de préférence stockée) :

1. Lire le header HTTP `Accept-Language` envoyé par le navigateur.
2. Parser pour extraire les langues par ordre de préférence (ex: `fr-BE,fr;q=0.9,en;q=0.8,nl;q=0.7`).
3. Trouver la première qui matche une langue supportée.
4. Si aucune ne matche, fallback sur l'anglais (plus universel que le français pour un public mondial).
5. Stocker le choix dans un cookie `lang` (1 an, sameSite=lax).

Pour un utilisateur connecté : la langue est une préférence du profil utilisateur, stockée en BDD, qui prime sur le cookie et le header.

### Sélecteur de langue
- Toujours visible dans le header/footer du site, sur toutes les pages.
- Drapeaux + nom de langue dans la langue elle-même (« Français », « English », « Nederlands », « Deutsch »).
- Le changement met à jour le cookie ET la préférence en BDD si connecté.
- URL avec préfixe de langue pour permettre le partage (ex: `/fr/stumble`, `/en/stumble`) — facilite aussi le SEO.

### Stack technique i18n
- **Lib recommandée pour Node/Express** : `i18next` avec `i18next-fs-backend` et `i18next-http-middleware`. Standard de facto, très bien documenté.
- **Format des fichiers de traduction** : JSON, un fichier par langue dans `locales/`.

```
locales/
├── fr/
│   └── translation.json
├── en/
│   └── translation.json
├── nl/
│   └── translation.json
└── de/
    └── translation.json
```

### Ce qu'il faut traduire
- Toute l'interface : boutons, labels, messages d'erreur, emails transactionnels.
- Les noms et descriptions des **catégories** (table `categories` étendue, voir ci-dessous).
- Les pages statiques : about, mentions légales, politique de confidentialité, conditions d'utilisation.
- Les emails envoyés par le système (vérification email, reset password, etc.) → dans la langue préférée de l'utilisateur.

### Ce qu'on NE traduit PAS
- **Les sites externes** : on les présente dans leur langue d'origine, c'est la nature même du web ouvert.
- **Les titres et descriptions des sites soumis** : ils sont saisis par le soumetteur dans une langue donnée. On stocke cette langue avec le site (voir schéma ci-dessous) pour pouvoir filtrer/prioriser.

### Adaptation du schéma BDD

Ajouter à la table `users` :
```sql
ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'fr';
```

Modifier la table `categories` pour supporter les traductions :
```sql
-- Soit en ajoutant des colonnes (simple, suffit pour 4 langues) :
ALTER TABLE categories ADD COLUMN name_fr TEXT;
ALTER TABLE categories ADD COLUMN name_en TEXT;
ALTER TABLE categories ADD COLUMN name_nl TEXT;
ALTER TABLE categories ADD COLUMN name_de TEXT;
-- (et supprimer la colonne name d'origine, ou la garder comme fallback)

-- Soit avec une table de traductions séparée (plus propre, plus scalable) :
CREATE TABLE category_translations (
  category_id INTEGER NOT NULL,
  language TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (category_id, language),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);
```

Recommandation : table séparée, plus propre pour ajouter des langues plus tard.

Ajouter à la table `sites` :
```sql
ALTER TABLE sites ADD COLUMN language TEXT;  -- langue détectée ou déclarée du contenu
```

### Filtrage des sites par langue (préférence utilisateur)
Dans les paramètres utilisateur, ajouter une option **« langues du contenu »** (multi-sélection, par défaut = langue de l'interface + anglais). L'algo de recommandation filtre alors les sites dont la langue est dans la liste.

Détection automatique de la langue d'un site lors de la soumission :
- Lire l'attribut `<html lang="...">` de la page.
- Si absent, utiliser une lib comme `franc` ou `cld` pour détecter à partir du contenu textuel.
- Le soumetteur peut corriger manuellement si la détection est fausse.

### Pluralisation et formats locaux
- Utiliser les fonctionnalités natives d'`i18next` pour la pluralisation (« 1 site », « 5 sites »).
- Formats de date adaptés (`Intl.DateTimeFormat` natif de JS).
- Pas de symbole monétaire pour l'instant (pas de transaction), mais à anticiper si dons un jour.

### Workflow de traduction
- Le français est la langue source (l'auteur du projet est francophone).
- Les autres langues sont traduites à partir du français.
- À chaque ajout de chaîne dans `fr/translation.json`, marquer les autres avec une clé manquante → script de check qui liste les traductions manquantes.
- Pour le MVP, traduction par Claude Code lui-même (qualité acceptable pour les 4 langues choisies) avec relecture humaine ultérieure si possible.

---

## 7ter. Bot de découverte (scraping ciblé de sources connues)

Pour alimenter le catalogue au-delà de ce que les utilisateurs soumettent, on développe un bot qui va chercher du contenu de qualité dans des sources externes connues. **Pas de crawl autonome** : uniquement du scraping ciblé de sources réputées pour leur qualité éditoriale ou communautaire.

### Sources cibles (au MVP)

| Source | Type | API/Méthode | Quotas |
|--------|------|-------------|--------|
| **Wiby.me** | Vieux web charmant | Page `/random` ou `/surprise`, scraping HTML | Soft, respecter le rate limit |
| **Hacker News** | Tech, science, idées | API officielle JSON `hacker-news.firebaseio.com` | Pas de quota, mais courtoisie |
| **Lobste.rs** | Tech curaté | Flux JSON `/hottest.json` | Respecter rate limit |
| **Reddit** (subs ciblés) | Communautés thématiques | API officielle (OAuth requis) | 60 req/min |
| **Marginalia Search** | Web non-commercial | Recherches thématiques scraped | Respecter robots.txt |
| **GitHub Awesome lists** | Listes curatées | API GitHub, extraction de liens MD | 5000 req/h authentifié |
| **Internet Archive Collections** | Archives curatées | API publique | Pas de quota strict |

Subreddits cibles (exemples, modifiables) : `InternetIsBeautiful`, `ObscureMedia`, `RabbitHole`, `WebGames`, `ArtefactPorn`, `DepthHub`, `TodayILearned` (filtre score élevé).

### Architecture du bot

Le bot est un **script Node.js séparé** du serveur web principal, lancé en CLI. Il a accès à la même BDD SQLite via une connexion partagée.

```
bot/
├── index.js              # CLI: node bot/index.js --source=hn --limit=50
├── sources/              # Un fichier par source
│   ├── hackernews.js
│   ├── wiby.js
│   ├── lobsters.js
│   ├── reddit.js
│   ├── github.js
│   └── marginalia.js
├── lib/
│   ├── enricher.js       # Fetch + extract title, description, language
│   ├── scorer.js         # Calcul du score de qualité
│   ├── classifier.js     # Attribution automatique de catégories
│   └── deduper.js        # Vérif anti-doublons
└── README.md
```

Chaque module source expose une interface standard :
```javascript
// Exemple : bot/sources/hackernews.js
module.exports = {
  name: 'hackernews',
  async fetch(options) {
    // Retourne un tableau de { url, source_title, source_score, source_metadata }
  }
};
```

### Pipeline de traitement

Pour chaque URL candidate récupérée d'une source :

1. **Déduplication** : vérifier qu'elle n'est pas déjà dans la BDD (table `sites` ou `bot_processed` ci-dessous). Si déjà présente, skip.

2. **Validation URL** : mêmes règles que pour les soumissions humaines (section 7) — anti-SSRF, schémas autorisés, etc.

3. **Enrichissement** : `fetch` de la page (timeout 10s, user-agent identifié) pour récupérer :
   - Le `<title>` HTML
   - La meta `description`
   - L'attribut `<html lang>` (et fallback détection automatique via `franc`)
   - L'OpenGraph image si présente (pour thumbnail futur)
   - Le statut HTTP final (suivre les redirects, max 3)
   - Hash du contenu textuel (pour détecter les contenus identiques sur URLs différentes)

4. **Classification automatique des catégories** : à partir du titre + description + URL, attribuer 1-3 catégories. Approche simple : dictionnaire de mots-clés par catégorie. Approche évoluée (V2) : embedding + similarité cosinus avec descriptions des catégories.

5. **Scoring de qualité** : voir section ci-dessous.

6. **Décision auto-approve vs pending** :
   - Score ≥ seuil élevé (ex: 80/100) **ET** source à haute confiance (Hacker News top, Lobste.rs) → `approved` direct.
   - Score moyen ou source de confiance modérée → `pending`.
   - Score faible → rejeté silencieusement, log seulement.

7. **Enregistrement** dans `sites` + log dans `bot_processed` pour ne pas re-traiter.

### Calcul du score de qualité (0-100)

Le score combine plusieurs signaux pondérés. Exemple de formule :

```
score = 
  +30 si HTTPS
  +20 si la page répond en moins de 3s
  +20 si lang détecté correspond à une des 4 langues supportées
  +15 si title et description bien formés (longueur raisonnable, pas que des mots-clés)
  +15 si pas de pub agressive détectée (heuristique : ratio script/contenu)
  +10 si signaux positifs de la source (score HN élevé, upvotes Reddit, etc.)
  -20 si domaine connu pour SEO/affiliation (liste maintenue)
  -30 si redirige vers un domaine différent (technique de spam fréquente)
  -10 si pas de description meta
  -50 si la page contient des mots-clés clairement disqualifiants (porno, casino, crypto-scam patterns)
```

Le seuil de auto-approbation et les poids sont configurables dans un fichier `bot/config.json` pour ajuster facilement. **Recommandé** : commencer avec un seuil très strict (90+) puis le baisser progressivement en fonction de la qualité observée.

### Adaptation du schéma BDD

Nouvelle table pour tracker ce que le bot a déjà vu :
```sql
CREATE TABLE bot_processed (
  url_hash TEXT PRIMARY KEY,           -- SHA-256 de l'URL normalisée
  url TEXT NOT NULL,
  source TEXT NOT NULL,                -- 'hackernews', 'wiby', etc.
  status TEXT NOT NULL,                -- 'imported', 'rejected', 'duplicate'
  score INTEGER,
  rejection_reason TEXT,
  processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_bot_processed_source ON bot_processed(source);
CREATE INDEX idx_bot_processed_date ON bot_processed(processed_at);
```

Ajout à la table `sites` :
```sql
ALTER TABLE sites ADD COLUMN imported_by TEXT;   -- 'user:42' ou 'bot:hackernews'
ALTER TABLE sites ADD COLUMN quality_score INTEGER;  -- score au moment de l'import
```

### Interface admin pour le bot

- **Page `/admin/bot`** : dashboard avec stats par source (imported, pending, rejected).
- **Bouton « lancer une exécution »** par source, avec options (limite, période).
- **Historique des exécutions** : date, source, résultats.
- **Page de configuration** : seuils de score, poids, sources actives/inactives.

### Considérations éthiques et légales

**Respect des sources** :
- User-agent identifié : `StumbUpon.comBot/1.0 (+https://tonsite.com/bot)`. Une page `/bot` explique ce qu'il fait et comment être exclu.
- Lecture systématique de `robots.txt` avant tout fetch d'une URL candidate.
- Rate limit strict : maximum 1 requête par seconde par domaine.
- Respect du `Crawl-Delay` si présent dans robots.txt.
- Headers `If-Modified-Since` pour ne pas re-télécharger inutilement.

**Respect du contenu** :
- On ne stocke que : URL, titre, description courte (max 200 caractères), langue. Pas de contenu plein.
- Ces données relèvent généralement du fair use / des snippets autorisés (similaire à Google, Bing).
- Possibilité pour un propriétaire de site de demander le retrait : route publique `/remove?url=...` qui ouvre un ticket admin.
- Page **« opt-out »** : un propriétaire peut demander que son domaine soit blacklisté pour toujours.

**Respect des CGU des sources** :
- Hacker News, Lobste.rs, Reddit (via API officielle), GitHub : utilisation conforme.
- Wiby et Marginalia : sites favorables à ce type d'usage, mais courtoisie de prévenir les mainteneurs (ils sont 1-2 personnes).
- Pas de scraping de plateformes hostiles au scraping (LinkedIn, Twitter/X, Facebook, Instagram).

**Cas du contenu problématique** :
- Si une URL trouvée pointe vers du contenu manifestement illégal (CSAM, etc.), le bot doit :
  - Ne JAMAIS la stocker.
  - Logger l'incident dans un fichier séparé.
  - Si récurrent depuis une source, désactiver automatiquement cette source.
- Filtres de mots-clés disqualifiants stricts dans le scoring (-50 ou plus).

### Cas d'usage typiques

**Au lancement du projet** : exécution massive sur Hacker News top des 5 dernières années, filtré sur posts à 100+ upvotes → quelques centaines de sites de qualité d'un coup, pour avoir un catalogue substantiel dès le premier jour.

**En entretien** : exécution mensuelle de chaque source avec limite raisonnable (50-100 candidats), revue rapide du pending par l'admin.

**Découverte thématique** : « il me manque des sites en catégorie Art » → exécution ciblée sur les subs/sources artistiques.

---

## 8. RGPD (l'utilisateur est en Belgique)

- Page **Politique de confidentialité** claire, dans toutes les langues supportées : quelles données, pourquoi, combien de temps.
- Page **Mentions légales** : identité de l'éditeur du site, hébergeur, dans toutes les langues.
- **Consentement** explicite à l'inscription (case à cocher non pré-cochée), texte traduit.
- **Droit à l'effacement** : bouton « supprimer mon compte » qui supprime vraiment toutes les données.
- **Export des données** : bouton qui génère un JSON de ses données (favoris, votes, soumissions, préférences de langue incluses).
- **Pas de cookies tiers**, donc pas besoin de bandeau cookies. Cookies internes (session, lang) exemptés car strictement nécessaires/préférence utilisateur.
- **Stockage de la langue** : le cookie `lang` est considéré comme cookie de préférence (légitime sans consentement explicite selon les guidelines CNIL/APD).

---

## 9. Données de seed

Au premier lancement, peupler la BDD avec :

### Catégories (suggestions, à ajuster)
Art, Photographie, Science, Technologie, Programmation, Histoire, Philosophie, Musique, Cinéma, Littérature, Jeux vidéo, Cuisine, Voyage, Nature, Sport, Humour, DIY/Bricolage, Design, Architecture, Mathématiques, Astronomie, Psychologie, Économie, Politique, Curiosités.

### Sites curatés (~100 minimum pour démarrer)
Mix de :
- Vieux sites web charmants (rétro, sites perso, internet artisanal style Wiby)
- Outils web créatifs (visualisations, générateurs, jeux navigateur)
- Wikipédia articles fascinants (avec URL `https://fr.wikipedia.org/wiki/...`)
- Blogs indépendants de qualité
- Pages d'archives sympas (Internet Archive, projets historiques)

Pour gagner du temps : Claude Code peut générer un fichier `seed-sites.json` avec une centaine d'URLs accompagnées de titre, description et catégories suggérées. À reviewer avant import.

---

## 10. Déploiement avec Caddy

Configuration `Caddyfile` à ajouter (sous-domaine ou nouveau domaine à décider plus tard) :

```
stumble.mondomaine.com {
    reverse_proxy localhost:3000
    encode gzip
    log {
        output file /var/log/caddy/stumble.log
        format json
    }
}
```

Lancer le serveur Node via **systemd** pour qu'il redémarre auto :

```ini
# /etc/systemd/system/stumble.service
[Unit]
Description=StumbUpon.com
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/stumbleclone
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=NODE_ENV=production
EnvironmentFile=/var/www/stumbleclone/.env

[Install]
WantedBy=multi-user.target
```

**Sauvegardes** : un cron quotidien qui copie `stumble.db` vers un dossier `/backups/` avec rotation 7 jours. SQLite gère ça très bien à chaud avec `.backup`.

---

## 11. Plan d'implémentation suggéré (étape par étape)

**Étape 1 — Squelette** : init projet npm, Express, route `/`, template de base. Test : « hello world » sur localhost:3000.

**Étape 2 — i18n dès le départ** : intégrer i18next, fichiers de traduction pour fr/en/nl/de (même réduits au début), middleware de détection de langue (cookie > préférence user > Accept-Language > défaut), sélecteur de langue dans le layout. Test : changer de langue, vérifier que tout suit, recharger en navigation privée avec Accept-Language modifié pour valider la détection auto.

**Étape 3 — BDD** : créer schema.sql avec les colonnes language, table category_translations, fonction d'init, seed des catégories dans les 4 langues. Test : interroger les catégories en CLI dans chaque langue.

**Étape 4 — Auth** : signup, login, logout, sessions, vérification email. Préférence de langue stockée au profil et utilisée pour les emails. Test : créer un compte, recevoir l'email de vérification dans la bonne langue.

**Étape 5 — Catégories d'intérêt** : choix à l'inscription, page settings pour modifier intérêts ET langue ET langues du contenu. Test : vérifier que tout est stocké et restauré.

**Étape 6 — Seed de sites** : générer ~100 sites curatés avec détection de langue de chaque site, les importer. Test : voir la liste en admin avec filtre par langue.

**Étape 7 — Le bouton Stumble** : route `/stumble` qui renvoie un site random filtré par intérêts ET par langues acceptées. Test : changer ses langues acceptées, vérifier que le pool change.

**Étape 8 — Vote** : enregistrer up/down, intégrer dans l'algo de reco. Test : voter rouge sur un site, vérifier qu'il ne réapparaît plus.

**Étape 9 — Favoris** : page liste, pagination. Test : voir ses likes.

**Étape 10 — Soumission + modération de base** : formulaire submit avec validation URL stricte (anti-SSRF) ET détection auto de la langue du site soumis, file pending en admin, approbation/rejet. Test : soumettre, approuver, voir apparaître dans le pool.

**Étape 11 — Anti-spam couches 1-3** : vérification email obligatoire, captcha (Cloudflare Turnstile), limites de soumission par utilisateur, fetch de la page soumise côté serveur pour score de risque automatique. Test : tenter de spammer, vérifier que les défenses tiennent.

**Étape 12 — Signalement + surveillance continue** : système de reports utilisateurs, mise en quarantaine auto à 3 signalements, dashboard admin avec alertes. Test parcours signalement complet.

**Étape 13 — Bot de découverte (MVP)** : script CLI Node, une première source simple (Hacker News API), pipeline d'enrichissement, scoring, table `bot_processed`, dashboard admin de base `/admin/bot`. Test : lancer une import de 20 sites, vérifier qu'ils arrivent en pending avec scores cohérents.

**Étape 14 — Bot — sources additionnelles** : ajout progressif des autres sources (Wiby, Lobste.rs, Reddit, GitHub awesome lists, Marginalia), refinement du scoring. Test : exécuter chaque source, vérifier qualité globale.

**Étape 15 — Transparence algo** : page « pourquoi ce site », bouton « moins de ça », page profil de goûts modifiable. Test : ajuster ses intérêts, vérifier que les recos changent.

**Étape 16 — Design final** : styling soigné. Style retenu : moderne et épuré. Vérifier que les longueurs de texte varient bien entre langues (l'allemand est souvent 30% plus long que l'anglais) et que l'UI tient.

**Étape 17 — RGPD** : pages légales dans les 4 langues, export, suppression, page opt-out pour propriétaires de sites. Test : tout supprimer son compte.

**Étape 18 — Déploiement** : systemd, Caddy, sauvegardes, alertes admin par email. Test : tout marche en prod.

À chaque étape, demander à Claude Code : *« implémente l'étape X de STUMBLECLONE.md, ne fais que cette étape, montre-moi le diff avant de l'appliquer »*.

---

## 12. Choix de design retenus (rappel des décisions)

- Source de contenu : **mix de sites curatés + articles Wikipédia random**.
- Persistance des préférences : **oui, comptes utilisateurs**.
- Style visuel : **moderne et épuré**.
- Affichage du site externe : **page intermédiaire** (option 2 section 6).
- Domaine : **à décider plus tard**, prévoir sous-domaine par défaut.
- **Multilingue dès le départ** : français, anglais, néerlandais, allemand. Détection automatique via Accept-Language, sélecteur toujours visible, préférence stockée au profil pour les utilisateurs connectés.

---

## 13. Notes pour Claude Code

- Travailler en commits Git fréquents et descriptifs.
- Pas de surdesign initial : faire marcher avant d'optimiser.
- Tout code commenté en français (l'utilisateur est francophone).
- Erreurs renvoyées en français côté UI.
- Tests : optionnels au MVP, mais ajouter au moins un README expliquant comment lancer localement.
- Ne jamais exécuter `rm -rf` ni manipuler `stumble.db` sans confirmation explicite.

