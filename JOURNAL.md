# Journal de développement — StumbUpon.com

Fichier de suivi des modifications apportées à chaque étape d'implémentation.

---

## Étape 1 — Squelette ✅
**Commit :** `24e6b63`

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `package.json` | Config npm, scripts `start` / `dev` (nodemon) |
| `server.js` | Point d'entrée Express — EJS, static, route `GET /` |
| `views/home.ejs` | Landing page (hero + 3 feature cards) |
| `views/partials/header.ejs` | En-tête HTML partagé, CDN htmx + Alpine.js |
| `views/partials/footer.ejs` | Pied de page HTML partagé |
| `public/style.css` | Reset + variables CSS + hero + cards |
| `public/app.js` | Stub JS vide |
| `.gitignore` | Exclut `node_modules/`, `.env`, `db/stumble.db` |
| `.env` | `PORT=4000`, `NODE_ENV=development`, `SESSION_SECRET` |
| `routes/`, `middleware/`, `lib/`, `db/`, `views/admin/` | Dossiers vides avec `.gitkeep` |

### Dépendances ajoutées
- `express` — serveur HTTP
- `ejs` — moteur de templates
- `dotenv` — chargement `.env`
- `nodemon` (dev) — rechargement auto

### Test validé
`curl http://localhost:4000` → 200, page HTML complète servie.

---

## Étape 2 — Base de données ✅
**Commit :** `f51071d`

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `db/schema.sql` | Toutes les tables en `CREATE IF NOT EXISTS` |
| `db/database.js` | Singleton `better-sqlite3` (WAL + foreign keys) |
| `db/seed.js` | 25 catégories seedées, idempotent (`INSERT OR IGNORE`) |

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `server.js` | `require('./db/database')` au démarrage pour créer les tables |

### Tables créées
`users`, `categories`, `user_interests`, `sites`, `site_categories`, `votes`, `views`, `reports`

### Index créés
`idx_sites_status`, `idx_votes_user`, `idx_views_user`

### Dépendances ajoutées
- `better-sqlite3` — accès SQLite synchrone

### Test validé
`node db/seed.js` → 25 catégories insérées et affichées en tableau CLI.

---

## Étape 3 — Authentification ✅
**Commit :** `5723a9c`

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `db/session-store.js` | Store de sessions SQLite maison (extends `session.Store`) |
| `middleware/auth.js` | `requireLogin`, `requireAdmin` |
| `middleware/csrf.js` | `generateToken` (GET) + `verifyToken` (POST) |
| `routes/auth.js` | `GET/POST /signup`, `GET/POST /login`, `POST /logout` |
| `views/login.ejs` | Formulaire de connexion |
| `views/signup.ejs` | Formulaire d'inscription |

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `server.js` | Session middleware, `res.locals.user`, `generateToken`, montage `authRoutes` |
| `views/partials/header.ejs` | Nav conditionnelle : boutons login/signup OU nom + déconnexion |
| `public/style.css` | Styles formulaires, messages d'erreur, bouton block |

### Comportements implémentés
- Hashage bcrypt cost 12
- Sessions persistantes 30 jours dans SQLite (même DB)
- Cookie `httpOnly`, `secure` en prod, `sameSite=lax`
- Nettoyage automatique des sessions expirées (toutes les heures)
- Token CSRF sur tous les formulaires POST
- Rate limiting : 20 tentatives / 15 min sur `/signup` et `/login`
- Anti-timing attack sur le login (compare même si l'utilisateur n'existe pas)
- Signup → connexion automatique + redirect `/`

### Dépendances ajoutées
- `bcrypt` — hashage mots de passe
- `express-session` — gestion des sessions
- `express-rate-limit` — limitation de débit

### Test validé
Signup → POST 302 → redirect `/` → header affiche `Bonjour, testuser`.

---

## Étape 4 — Catégories d'intérêt ✅
**Commit :** `d1008bb`

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `routes/interests.js` | `GET/POST /interests` — choix et mise à jour des catégories |
| `routes/settings.js` | `GET /settings`, `POST /settings/interests`, `POST /settings/password` |
| `views/interests.ejs` | Grille de cartes-catégories cliquables avec compteur Alpine.js |
| `views/settings.ejs` | Page paramètres : intérêts + changement de mot de passe |

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `routes/auth.js` | Signup redirige vers `/interests` au lieu de `/` |
| `server.js` | Montage de `interestsRoutes` et `settingsRoutes` |
| `public/style.css` | Styles grille catégories, cartes toggle, page settings, alertes |

### Comportements implémentés
- Signup → `/interests` (sélection obligatoire, min 3 catégories)
- Cartes catégories style toggle (`:has(input:checked)`) avec emoji + nom
- Compteur en temps réel via Alpine.js, bouton désactivé sous 3 sélections
- Sauvegarde atomique (transaction : DELETE + INSERT) pour éviter les doublons
- `/settings` : modification des intérêts (même grille pré-cochée) + changement de mot de passe sécurisé (vérifie l'ancien)
- Messages de succès/erreur via query params (`?success=interests`, `?error=...`)

### Test validé
Signup `tester88` → redirect `/interests` → POST 4 catégories → redirect `/settings?success=interests` → BDD : `Art, Philosophie, Programmation, Science`.

---

## i18n — Internationalisation ✅
**Commit :** `9a43d77`

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `lib/i18n.js` | Configuration i18next avec fs-backend, 4 langues préchargées |
| `middleware/lang.js` | Détection langue (session > cookie > Accept-Language > fr), expose `t()` et `currentLang` |
| `locales/fr/translation.json` | 40 clés en français |
| `locales/en/translation.json` | 40 clés en anglais |
| `locales/nl/translation.json` | 40 clés en néerlandais |
| `locales/de/translation.json` | 40 clés en allemand |

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `db/schema.sql` | Table `category_translations` + index |
| `db/database.js` | Migrations auto : colonnes `language` sur `users` et `sites` |
| `db/seed.js` | 100 traductions de catégories (25 × 4 langues) |
| `server.js` | `cookie-parser`, `i18nMiddleware`, `applyLang` |
| `views/partials/header.ejs` | `<html lang="...">` dynamique, sélecteur FR/EN/NL/DE, textes via `t()` |
| `views/partials/footer.ejs` | Tagline via `t()` |
| `views/*.ejs` | Tous les textes UI via `t()`, noms de catégories traduits |
| `routes/auth.js` | Erreurs via `req.t()`, stockage `language` à l'inscription/login, route `GET /lang/:code` |
| `routes/interests.js` | Catégories avec JOIN `category_translations` selon `currentLang` |
| `routes/settings.js` | Idem + section langue dans settings |
| `public/style.css` | Styles sélecteur de langue, boutons langue dans settings |

### Comportements implémentés
- Détection automatique via `Accept-Language` header à la première visite
- Cookie `lang` (1 an) posé lors d'un changement explicite
- Préférence utilisateur connecté stockée en BDD (`users.language`) et session
- `GET /lang/:code` — change langue, redirige vers la page précédente
- Noms de catégories traduits via `LEFT JOIN category_translations`, fallback sur nom FR
- `<html lang="">` mis à jour dynamiquement pour le SEO et l'accessibilité

### Tests validés
- FR (défaut) : `Redécouvre le web.`
- EN (`Accept-Language: en`) : `Rediscover the web.`
- NL (cookie `lang=nl`) : `Herontdek het web.`
- `GET /lang/de` → 302 ✓
- `html lang="en"` avec Accept-Language anglais ✓

### Dépendances ajoutées
- `i18next` — moteur de traduction
- `i18next-fs-backend` — chargement des fichiers JSON
- `i18next-http-middleware` — intégration Express
- `cookie-parser` — lecture du cookie `lang`

---

## Étape 5 — Seed de sites curatés ✅

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `db/seed-sites.json` | 114 sites curatés, format `{url, title, description, language, categories[]}` |
| `db/import-sites.js` | Script d'import idempotent : INSERT OR IGNORE + résolution slug→id |

### Comportements implémentés
- `seed-sites.json` : 67 EN, 31 FR, 8 NL, 8 DE — couvre les 25 catégories
- `import-sites.js` : transaction atomique, résolution des slugs de catégories, résumé CLI
- Idempotent : ré-exécutable sans doublon (`INSERT OR IGNORE`)
- Avertissement si un slug de catégorie est inconnu

### Test validé
```
node db/import-sites.js
→ 114 sites insérés, 0 déjà présents, 263 liens site↔catégorie créés
```
Vérification BDD : 114 sites `status='approved'`, répartition cohérente par langue et catégorie.

---

## Étape 6 — Bouton Stumble ✅

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `routes/stumble.js` | `GET /stumble` (sélection aléatoire + enregistrement vue) + `GET /stumble/:id` (affichage) |
| `views/stumble.ejs` | Carte du site : catégories, titre, description, URL, boutons Visiter/Suivant |

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `server.js` | Montage de `stumbleRoutes` |
| `views/partials/header.ejs` | Bouton "Stumble !" dans la nav connectée |
| `public/style.css` | Styles `.stumble-page`, `.stumble-card`, `.stumble-tag`, `.stumble-actions` |
| `locales/*/translation.json` | Clés `stumble_visit`, `stumble_next`, `nav_stumble` (4 langues) |

### Comportements implémentés
- Sélection aléatoire parmi les catégories d'intérêt de l'utilisateur
- Exclusion des sites déjà vus (`views` table) — réinitialisation auto si tous vus
- Enregistrement de chaque vue via `INSERT OR REPLACE INTO views`
- Affichage de la carte : catégories traduites, titre, description, URL
- Bouton "Visiter" → nouvel onglet, bouton "Suivant" → `/stumble`
- `requireLogin` sur les deux routes

### Test validé
```
GET /stumble (sans session) → 302 /login ✓
SELECT random site for user 5 (tester88) → id=89, 'Open Beelden' ✓
```

---

## Étape 7 — Votes 👍/👎 ✅

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `routes/votes.js` | `POST /vote` — upsert ou toggle-off du vote |

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `routes/stumble.js` | Passe `userVote` (1/-1/null) et `score` (somme) au template |
| `views/stumble.ejs` | Barre de vote : boutons 👍/👎 + score coloré |
| `server.js` | Montage `voteRoutes` |
| `public/style.css` | Styles `.vote-bar`, `.vote-btn`, `.vote-score` |

### Comportements implémentés
- `POST /vote` avec `{ site_id, direction }` (1 ou -1)
- Toggle : même direction → supprime le vote ; direction différente → remplace
- `INSERT OR REPLACE` pour le changement de direction
- Score = `SUM(direction)` affiché en vert (positif) ou rouge (négatif)
- Bouton actif mis en évidence (vert pour 👍, rouge pour 👎)
- CSRF + `requireLogin` sur la route POST

### Test validé
Vote INSERT → direction=1 ✓ | Toggle DELETE → undefined ✓ | Score=0 après suppression ✓

---

## Étape 9 — Favoris ✅

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `routes/favorites.js` | `GET /favorites` — liste paginée des sites aimés (direction=1) |
| `views/favorites.ejs` | Liste de cartes avec catégories, titre, description, boutons |

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `server.js` | Montage `favoritesRoutes` |
| `public/style.css` | Styles `.favorites-page`, `.fav-card`, `.pagination` |
| `locales/*/translation.json` | Clés `favorites_*`, `pagination_*` (4 langues) |

### Comportements implémentés
- Favoris = votes avec `direction=1`, triés par date de like DESC
- Pas de nouvelle table — réutilise `votes`
- Catégories chargées en une seule requête `WHERE site_id IN (json_each(?))` puis mergées en JS
- Pagination 20 sites/page avec liens prev/next
- Page vide avec CTA vers `/stumble` si aucun favori
- Bouton "Voir la fiche" → `/stumble/:id` pour revenir sur la carte

### Test validé
3 votes up insérés pour user 5 → 3 favoris récupérés avec titres corrects ✓

---

## Étape 10 — Soumission + modération de base ✅

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `lib/validators.js` | Validation URL anti-SSRF (IP, localhost, ports, doublon) |
| `lib/enricher.js` | Fetch page : extrait `<title>` et `<html lang>` en 20 Ko max |
| `routes/submit.js` | `GET/POST /submit` — formulaire soumission avec enrichissement auto |
| `routes/admin.js` | `GET /admin`, `GET /admin/pending`, `POST /admin/approve/:id`, `POST /admin/reject/:id` |
| `views/submit.ejs` | Formulaire : URL, titre, description, grille de catégories |
| `views/admin/dashboard.ejs` | Dashboard stats (users, sites, pending, votes) |
| `views/admin/pending.ejs` | Liste des soumissions en attente avec boutons approuver/rejeter |

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `server.js` | Montage `submitRoutes`, `adminRoutes` |
| `views/partials/header.ejs` | Liens "Soumettre un site" et "Admin" (affiché si is_admin) |
| `public/style.css` | Styles formulaire submit, admin dashboard, stat-card, admin-card, btn-approve/reject |
| `locales/*/translation.json` | Clés `submit_*`, `admin_*`, `error_url_*` (4 langues) |

### Comportements implémentés
- Validation URL : protocole, longueur, IP brute, IP privée/localhost, port non-standard, doublon BDD
- 8/8 cas de validation testés et validés
- Enrichissement asynchrone : fetch page soumise (timeout 10s, user-agent identifié), extraction `<title>` et `<html lang>`
- Titre et langue pré-remplis automatiquement si non saisis par l'utilisateur
- Soumission → `status='pending'`, `submitted_by=userId`
- Interface admin protégée par `requireAdmin`, lien visible uniquement pour les admins
- Danux promu admin (is_admin=1)

### Test validé
8/8 cas de validation URL ✓ | Modules chargés sans erreur ✓

---

## Étape 11 — Anti-spam couches 1-3 ✅

### Dépendance ajoutée
- `nodemailer` — envoi d'emails SMTP

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `lib/mailer.js` | Envoi d'email via SMTP (ou logs en dev si SMTP non configuré) |
| `views/verify-email.ejs` | Page de confirmation de vérification email |

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `db/database.js` | Migrations : `users.email_verified`, `users.email_verification_token`, `sites.risk_score` |
| `lib/enricher.js` | Ajout calcul `riskScore` (0-100) : HTTPS, redirect, title, meta-description, mots-clés spam |
| `routes/auth.js` | Token de vérification généré au signup, envoi email, route `GET /verify-email/:token`, `POST /resend-verification`, `email_verified` en session |
| `routes/submit.js` | Vérification `email_verified`, limites 3/jour + 10/semaine + 1 pending pour nouveaux comptes |
| `routes/admin.js` | — (récupère automatiquement `risk_score` via SELECT *) |
| `views/admin/pending.ejs` | Badge risque coloré (vert/orange/rouge) |
| `views/signup.ejs` | Widget Cloudflare Turnstile (chargé uniquement si `TURNSTILE_SITE_KEY` configuré) |
| `views/submit.ejs` | Bannière + bouton "renvoyer l'email" si email non vérifié |
| `.env` | Variables commentées : `BASE_URL`, `SMTP_*`, `TURNSTILE_*` |
| `public/style.css` | Styles `.risk-badge--low/medium/high` |
| `locales/*/translation.json` | Clés `verify_*`, `error_submit_*`, `error_captcha`, `submit_unverified_*` (4 langues) |

### Comportements implémentés
**Couche 1** — Email vérifié obligatoire pour soumettre un site ; Turnstile activé automatiquement en prod si clé configurée ; mode dev = logs uniquement  
**Couche 2** — 3 soumissions/jour, 10/semaine, 1 en attente max pour comptes < 30 jours  
**Couche 3** — Score de risque calculé à partir du fetch : HTTPS (−20), réponse rapide (−10), redirect domaine différent (+25), pas de title (+10), pas de meta-desc (+10), mots-clés spam (+50), langue supportée (−10)

### Tests validés
Migrations OK (3 nouvelles colonnes) | Mailer dev OK (email simulé dans logs) | Limite 3/jour bloquée ✅

---

## Étape 12 — Signalement + surveillance ✅

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `routes/report.js` | `POST /report/:id` — signalement avec déduplication + quarantaine auto |
| `views/admin/reports.ejs` | Liste des sites signalés avec détail des reports, boutons résoudre/rejeter |

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `routes/admin.js` | `GET /admin/reports`, `POST /admin/resolve/:id`, `POST /admin/dismiss/:id` + stats quarantaine |
| `views/admin/dashboard.ejs` | Stat signalements + quarantaine, lien vers `/admin/reports` |
| `views/stumble.ejs` | `<details>` signalement en bas de carte + messages confirmation/doublon |
| `server.js` | Montage `reportRoutes` |
| `public/style.css` | Styles `.report-details`, `.report-item`, `.stumble-tag--quarantine` |
| `locales/*/translation.json` | Clés `report_*`, `admin_reports_*`, `admin_stat_*` (4 langues) |

### Comportements implémentés
- 1 seul signalement par user/site (déduplication en BDD)
- Seuil de quarantaine automatique : 3 signalements distincts → `status='quarantine'`
- Sites en quarantaine exclus du pool Stumble (filtre `status='approved'` existant)
- Admin peut rétablir (→ `approved`) ou rejeter définitivement (→ `rejected`)
- Dashboard mis à jour avec compteurs signalements et quarantaine

### Test validé
3 signalements distincts → quarantaine ✅ | Exclu du pool ✅ | Admin resolve/dismiss ✅

---

## Étape 13 — Bot de découverte MVP (Hacker News) ✅

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `bot/index.js` | CLI : `node bot/index.js --source=hn --limit=N --threshold=N` |
| `bot/sources/hackernews.js` | Source HN : `beststories.json`, filtre score > 100 |
| `bot/lib/deduper.js` | Normalisation URL + hash SHA-256, check `bot_processed` + `sites` |
| `bot/lib/classifier.js` | Affectation catégories par dictionnaire de mots-clés (25 catégories) |
| `bot/lib/scorer.js` | Score qualité 0-100 : HTTPS, titre, langue, cats, signal HN, pénalité risk |
| `views/admin/bot.ejs` | Dashboard bot : stats par source + log des 30 dernières URLs |

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `db/database.js` | Table `bot_processed` + colonnes `sites.imported_by` + `sites.quality_score` |
| `routes/admin.js` | `GET /admin/bot` |
| `views/admin/dashboard.ejs` | Bouton "Bot de découverte" |
| `locales/*/translation.json` | Clés `admin_bot_*` (4 langues) |
| `public/style.css` | Styles `.bot-cmd`, `.bot-log` |

### Pipeline
Fetch HN → dédup → validation URL → enrichissement → classification → score → insert (`approved` si ≥ 70, sinon `pending`) → log `bot_processed`

### Fix
Conflit de nom `fetch` (source HN vs global Node) → résolu avec `globalThis.fetch`

### Test validé
`node bot/index.js --source=hn --limit=5` → 5 sites importés (4 approuvés, 1 pending), scores cohérents (67-93/100) ✅

---

## Étape 14 — Bot sources additionnelles ✅

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `bot/sources/wiby.js` | Parse le meta refresh de `/surprise/` — vieux web artisanal |
| `bot/sources/lobsters.js` | JSON `/hottest.json` — communauté tech curatée |
| `bot/sources/reddit.js` | Top posts JSON (bloqué HTTP 403 depuis mi-2023 sans OAuth) |
| `bot/sources/marginalia.js` | API publique `api.marginalia.nu` — web non-commercial |

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `bot/index.js` | Support `--source=all`, refactorisé en `runSource()`, total multi-sources |
| `views/admin/bot.ejs` | Affichage des badges de toutes les sources disponibles |

### Sources fonctionnelles
| Source | Statut | Notes |
|---|---|---|
| `hn` | ✅ | beststories, filtre score > 100 |
| `wiby` | ✅ | meta refresh parsé (pas de redirect HTTP) |
| `lobsters` | ✅ | JSON public |
| `marginalia` | ✅ | API publique, 10 termes thématiques |
| `reddit` | ⚠️ HTTP 403 | Bloqué sans OAuth depuis 2023 — OAuth à implémenter si besoin |

### Test validé
`--source=all --limit=2` → 7 sites importés (6 approuvés, 1 en attente) depuis 4 sources ✅  
Déduplication inter-sources : 11 doublons ignorés ✅

---

## Étape 15 — Transparence algo ✅

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `routes/tastes.js` | GET /tastes, POST /less-of-this, POST /tastes/weight |
| `views/tastes.ejs` | Page "Mes goûts" — grille de catégories avec barres de poids |

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `db/database.js` | Migration : `user_interests.weight REAL DEFAULT 1.0` |
| `routes/stumble.js` | Algo pondéré : 50 candidats SQL → JS `weightedPick()` ; `quality_score` dans `querySiteById` ; poids utilisateur dans `queryCats` |
| `views/stumble.ejs` | Bouton "Moins de ça" (POST /less-of-this) ; section `<details>` "Pourquoi ce site ?" |
| `views/partials/header.ejs` | Lien nav "Mes goûts" → /tastes |
| `public/style.css` | `.btn-ghost`, `.alert-info`, `.why-*`, `.tastes-*`, `.taste-*`, `.weight-*` |
| `locales/{fr,en,nl,de}/translation.json` | 12 nouvelles clés : tastes, why, less-of-this |
| `server.js` | Mount `tastesRoutes` |

### Algo pondéré
- SQL : 50 sites candidats (`ORDER BY RANDOM() LIMIT 50`) avec `SUM(ui.weight)` par site
- JS : `weightedPick()` — sélection proportionnelle au poids total des catégories correspondantes
- Plage de poids : 0.1 (minimum) → 2.0 (maximum), défaut 1.0

### Actions utilisateur
| Action | Effet |
|---|---|
| "Moins de ça" sur stumble card | −0.3 sur chaque catégorie du site (min 0.1) |
| "+" sur /tastes | +0.2 sur la catégorie (max 2.0) |
| "−" sur /tastes | −0.2 sur la catégorie (min 0.1) |

### Test validé
- Migration `weight` : `PRAGMA table_info(user_interests)` → colonne présente ✅
- Serveur démarre sans erreur : HTTP 200 ✅
- Syntaxe routes/tastes.js et routes/stumble.js ✅

---

## Étape 16 — Design final ✅

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `public/style.css` | Réécriture complète — meilleures variables, responsive, stumble card, transitions |
| `views/partials/header.ejs` | Favicon SVG inline (🌀) |

### Améliorations apportées
| Domaine | Détail |
|---|---|
| Responsive | 2 breakpoints (`≤768px`, `≤480px`) — zéro media query avant |
| Header | `position: sticky`, `backdrop-filter: blur(12px)`, `nav-username` masqué sur mobile |
| Stumble card | Accent gradient en haut (indigo→violet→rose), `border-radius-lg`, `box-shadow-lg`, marges internes via classes individuelles |
| Typographie | `letter-spacing` sur les titres, `line-height` affiné, stack Inter/Segoe UI |
| Boutons | Gradient sur `btn-primary`, `box-shadow` coloré, `display: inline-flex` |
| Hero | `radial-gradient` subtil en arrière-plan |
| Variables CSS | `--shadow-sm`, `--shadow-lg`, `--radius-sm`, `--radius-lg`, `--transition`, `--color-primary-rgb` |
| Accessibilité | `:focus-visible` global avec outline visible |
| Favicon | SVG emoji inline dans `<head>` — aucune requête réseau |
| Mobile stumble | Actions en colonne, boutons pleine largeur sur `≤480px` |
| Mobile admin | Colonnes bot-log réduites, stat-cards en colonne |

### Test validé
- HTTP 200 sur `/` et `/style.css` ✅
- Serveur démarre sans erreur ✅

---

## Étape 17 — RGPD ✅

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `routes/legal.js` | GET /legal, GET /privacy, GET /optout, POST /optout |
| `routes/account.js` | GET /account/export (téléchargement JSON), POST /account/delete (avec vérif mdp) |
| `views/legal.ejs` | Page mentions légales |
| `views/privacy.ejs` | Politique de confidentialité |
| `views/optout.ejs` | Formulaire de retrait pour propriétaires de sites |
| `views/admin/optout.ejs` | Interface admin pour traiter les demandes de retrait |

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `db/database.js` | Migration : table `optout_requests` |
| `routes/admin.js` | GET/POST /admin/optout + stat opt-out dans le dashboard |
| `views/settings.ejs` | Section "Mes données" : bouton export + formulaire suppression compte |
| `views/admin/dashboard.ejs` | Stat opt-out + bouton vers /admin/optout |
| `views/partials/footer.ejs` | Liens vers /legal, /privacy, /optout |
| `public/style.css` | `.legal-page`, `.footer-legal` |
| `server.js` | Mount `legalRoutes`, `accountRoutes` |
| `locales/{fr,en,nl,de}/translation.json` | ~40 nouvelles clés par langue |

### Conformité RGPD
| Droit | Implémentation |
|---|---|
| Accès | GET /account/export → JSON avec profil, votes, intérêts, soumissions |
| Rectification | Paramètres existants (intérêts, langue, mdp) |
| Effacement | POST /account/delete → suppression cascade via FK + sessions |
| Portabilité | Même fichier JSON que l'export |
| Opt-out (propriétaires) | /optout → `optout_requests` → admin /admin/optout |

### Cascade suppression compte
- `user_interests`, `votes`, `views` → `ON DELETE CASCADE` (schéma existant) ✅
- `sites.submitted_by`, `reports.reported_by` → `ON DELETE SET NULL` (anonymisation) ✅
- Sessions SQLite → `DELETE WHERE json_extract(sess, '$.userId') = ?` ✅

### Test validé
- `/legal`, `/privacy`, `/optout` → HTTP 200 ✅
- Migration `optout_requests` → table créée ✅
- Serveur démarre sans erreur ✅

---

## Étape 18 — Déploiement ✅

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `scripts/stumble.service` | Unité systemd — redémarre Node automatiquement |
| `scripts/backup.sh` | Sauvegarde WAL-safe de stumble.db (garde 7 copies) |
| `scripts/install.sh` | Script d'installation tout-en-un (sudo requis) |
| `backups/stumble-*.db` | Première sauvegarde créée (196K) |

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `lib/mailer.js` | Ajout `sendAdminAlert(subject, body)` |
| `routes/report.js` | Alerte email admin à la mise en quarantaine |
| `routes/legal.js` | Alerte email admin à chaque demande opt-out |
| `.env` | `NODE_ENV=production`, `ADMIN_EMAIL=dany@danux.be` |

### Pour finaliser (commandes à exécuter)
```bash
# 1. Déploiement complet (systemd + cron + Caddy)
sudo bash /srv/web/stumbleclone/scripts/install.sh

# 2. Générer un vrai SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# → coller la valeur dans .env SESSION_SECRET=...

# 3. Configurer SMTP dans .env pour les emails en production
# SMTP_HOST=...
```

### Ce que fait install.sh
1. Installe et active `stumble.service` (redémarre au boot, relance en cas de crash)
2. Crée `/etc/cron.d/stumble-backup` → sauvegarde quotidienne à 2h
3. Améliore le bloc Caddy `stumble.danux.be` : compression gzip/zstd, headers sécurité, cache statiques, logs JSON
4. Rappelle de changer SESSION_SECRET

### Caddy — état actuel
`stumble.danux.be` → `127.0.0.1:4000` déjà opérationnel ✅  
Headers sécurité + compression + logs ajoutés par install.sh

### Alertes email admin
| Événement | Déclencheur |
|---|---|
| Quarantaine | 3 signalements distincts sur un site |
| Opt-out | Chaque nouvelle demande de retrait |

Dev sans SMTP : alertes loguées en console ✅

---

## Filtrage collaboratif ✅

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `routes/stumble.js` | Algo v2 — filtrage collaboratif fusionné avec pondération par intérêts |

### Algorithme v2
L'algorithme de recommandation passe de "poids par catégories" seul à un modèle hybride :

**Phase 1 — Intérêts** (toujours active)  
50 candidats tirés des sites dont les catégories correspondent aux `user_interests` de l'utilisateur, pondérés par poids de chaque catégorie, mélangés aléatoirement.

**Phase 2 — Collaboratif** (activée dès ≥ 5 upvotes de l'utilisateur)  
1. Trouver les 30 utilisateurs les plus similaires : ceux qui ont liké (+1) des sites que l'utilisateur courant a aussi likés (classés par nombre de votes communs)
2. Récupérer les 30 sites que ces utilisateurs similaires ont likés, que l'utilisateur courant n'a pas encore vus ni rejetés
3. Fusionner avec `mergeWithCollab()` :
   - Sites dans les deux listes → boost du poids (+30% max_interest × score_collab normalisé)
   - Sites uniquement en collaboratif (découverte hors centres d'intérêt) → poids = 70% du boost

**Seuil cold-start** : en dessous de 5 likes, le signal collaboratif est trop faible et on reste sur l'algo v1 seul.

### Test validé
```bash
node -e "
  require('dotenv').config();
  const db = require('./db/database');
  const collab = db.prepare('SELECT COUNT(*) as n FROM votes WHERE direction=1').get();
  console.log('Upvotes total:', collab.n);
"
# → 13 upvotes, 2 votants → signal actif pour user Danux (10 upvotes ≥ 5)
# → 3 candidats collaboratifs trouvés au premier test
```

---

## Dark mode ✅
**Commit :** `c8ff2ba`

### Comportements implémentés
- Trois modes : automatique (système), clair, sombre — toggle ☀️/🌙/🌗 dans la nav
- Préférence stockée dans `localStorage` + classe `html.dark` appliquée immédiatement
- Variables CSS doubles (`--color-bg`, `--color-text`, etc.) — aucun JS pour le rendu
- `prefers-color-scheme: dark` respecté si mode auto sélectionné

---

## Raccourcis clavier ✅
**Commit :** `64e655b`

| Touche | Action |
|---|---|
| `Space` / `N` | Site suivant (GET /stumble) |
| `V` | Ouvrir le site dans un nouvel onglet |
| `L` | Upvote |
| `D` | Downvote |

---

## Digest email hebdomadaire ✅
**Commit :** `d63a3b9`

### Fichiers créés/modifiés
| Fichier | Rôle |
|---|---|
| `lib/mailer.js` | Ajout `sendDigestEmail(to, username, sites, lang, unsubUrl)` avec HTML + texte brut |
| `scripts/digest.js` | Script cron — sélectionne 7 sites/user selon intérêts, envoie, log résultat |

### Comportements
- Opt-in par défaut (colonne `users.email_digest = 1`)
- 7 sites sélectionnés parmi les `approved`, pondérés par intérêts de l'utilisateur, non déjà vus
- HTML soigné (couleurs, liens, footer désabonnement) + fallback texte brut
- Lien de désabonnement direct (`/settings`)
- Cron suggéré : lundi 9h (`0 9 * * 1`)

---

## PWA — Progressive Web App ✅
**Commit :** `a0b7118`

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `public/manifest.json` | Nom, icônes, couleur thème, mode standalone |
| `public/sw.js` | Service worker — cache statiques v1, offline fallback |
| `public/icons/icon-192.svg` | Icône SVG 192px (🌀 stylisé) |
| `public/icons/icon-512.svg` | Icône SVG 512px |
| `views/offline.ejs` | Page servie hors ligne par le SW |

---

## Nav dropdown + sélecteur langue footer ✅
**Commit :** `ce9e6c3`

- Menu utilisateur en dropdown sur le pseudo (hover/click)
- Sélecteur de langue déplacé dans le footer (plus discret)
- Chevron animé à l'ouverture

---

## Stumble en mode invité ✅
**Commit :** `93c5f3f`

### Comportements
- Les visiteurs non connectés peuvent explorer jusqu'à N sites (N configurable par l'admin)
- Compteur de sessions invités via `req.session.guestCount`
- Après N explorations → page `/stumble/join` (mur d'inscription)
- `/stumble/join/skip` — ignorer le mur une fois (quota remis à zéro)
- Bannière quota invité sur la carte stumble (affiche le nombre restant)

---

## Commentaires sur les sites ✅
**Commit :** `e9d1d05`

### Fonctionnalités
- Tiroir commentaires latéral sur desktop, drawer mobile en bas
- Soumission AJAX (`fetch` + JSON) — pas de rechargement de page
- Modération admin : approuver/rejeter les commentaires signalés
- Limite 500 caractères par commentaire
- Suppression par l'auteur ou un admin

---

## Volet ℹ️ + barre stumble ✅
**Commit :** `e9d1d05`

- Volet latéral "Info" avec titre, description, catégories, URL, score
- Bouton "Partager" dans la barre (`navigator.share` ou copie presse-papier)
- Icônes MDI (Material Design Icons) via CDN

---

## Recherche full-text (FTS5) ✅
**Commit :** `219ed79`

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `routes/search.js` | `GET /search?q=` — recherche FTS5 avec pagination |
| `views/search.ejs` | Résultats avec extraits mis en évidence |

### Comportements
- Index FTS5 sur `sites(title, description, url)` avec tokeniseur unicode61
- Triggers `AFTER INSERT/UPDATE/DELETE` maintiennent l'index automatiquement
- Recherche en mode `prefix*` — résultats en temps réel
- Affichage du domaine + catégories + description sous chaque résultat

---

## OpenGraph + Twitter Card ✅
**Commit :** `546432e`

- `og:title`, `og:description`, `og:image`, `og:url` sur toutes les pages
- `twitter:card`, `twitter:site` sur les pages stumble
- Image par défaut `/og-image.png` (1200×630)
- Image dynamique sur les profils publics (avatar si dispo)

---

## Page À propos ✅
**Commit :** `1ff32ee`

- `/about` — présentation du projet, philosophie, stack technique
- Lien dans le footer

---

## Animation flip entre les stumbles ✅
**Commit :** `d371eba`

- Animation CSS 3D flip entre deux cartes au passage au site suivant
- Désactivée par défaut (option dans les settings)
- Respecte `prefers-reduced-motion`

---

## Rôle curateur ✅
**Commit :** `cb03385`

### Comportements
- Nouveau rôle `is_curator` entre utilisateur et admin
- Interface de curation `/curate` : valider/rejeter les sites en attente
- Volet de curation desktop directement sur la page stumble (sans quitter)
- Pagination des sites en attente dans l'interface admin
- Curateurs visibles dans la nav (lien "Curation")

---

## Renommage StumbleClone → StumbUpon.com + SEO complet ✅
**Commit :** `20b7f4f`

### Fichiers modifiés/créés
| Fichier | Rôle |
|---|---|
| `routes/seo.js` | `GET /sitemap.xml`, `GET /robots.txt`, `GET /feed.xml` (RSS) |
| `views/home.ejs` | Refonte hero + cards — textes SEO, nouveau nom |
| `public/og-image.png` | Image Open Graph 1200×630 |

### SEO
- Sitemap XML : pages statiques + 200 derniers sites approuvés avec `lastmod`
- robots.txt : crawl autorisé, disallow admin/settings
- RSS feed : 20 derniers sites approuvés
- Balises hreflang pour les 14 langues supportées
- Canonical URL automatique sur chaque page

---

## Barre mobile + page invitation invité ✅
**Commit :** `e6a298d`

- Barre de navigation fixe en bas sur mobile (Explorer, Info, Favoris, Menu)
- Page `/stumble/join` redesignée avec 8 cartes de valeur traduites (14 langues)
- Position de la barre (haut/bas) configurable dans les settings

---

## Import DMOZ/ODP RDF ✅
**Commit :** `f6b25cd`

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `scripts/import-dmoz.js` | Parse le dump RDF DMOZ (~3 Go) en streaming SAX, filtre et importe |

### Comportements
- Streaming SAX — ne charge pas tout le fichier en mémoire
- Filtre par langue et score de risque
- Classification automatique par catégories DMOZ → catégories internes
- Import transactionnel par lots de 500

---

## Internationalisation étendue à 14 langues ✅

Les 4 langues initiales (fr, en, nl, de) ont été étendues à :
`fr · en · de · es · it · pt · nl · pl · da · ar · el · ja · ru · zh`

Toutes les clés i18n existantes et nouvelles sont maintenues dans les 14 locales.

---

## Google OAuth ✅

### Fichiers modifiés
| Fichier | Rôle |
|---|---|
| `routes/auth.js` | Stratégie `GoogleStrategy`, routes `/auth/google` et `/auth/google/callback` |
| `views/login.ejs` | Bouton "Continuer avec Google" (conditionnel si credentials configurés) |
| `views/signup.ejs` | Idem |
| `server.js` | `passport.initialize()` |

### Comportements
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` dans `.env` activent le bouton automatiquement
- Compte existant avec même email → liaison automatique du `google_id`
- Nouveau compte → username généré depuis le `displayName` Google (avec suffixe si conflit)
- `password_hash = 'oauth'` pour les comptes sans mot de passe
- `session: false` dans Passport — session gérée manuellement via `req.session.regenerate()`

---

## Paramètres compte — Avatar, Pseudo, Email ✅

### Avatar
- Upload image (JPEG, PNG, WebP, GIF, max 2 Mo)
- Stocké dans `public/avatars/` sous le nom `{userId}.{ext}`
- Suppression de l'ancien fichier physique avant remplacement
- Bouton de suppression de l'avatar
- Multer placé **avant** `verifyToken` (req.body undefined sinon sur multipart)

### Pseudo
- Modification libre mais limitée à **2 fois par an** (compteur `username_changes_this_year` + `username_year`)
- Compteur reset automatiquement au 1er janvier
- Validation regex `^[a-zA-Z0-9_-]{3,20}$`
- Vérification unicité en BDD
- Session mise à jour immédiatement

### Email
- Changement avec **vérification obligatoire** de la nouvelle adresse
- Flow : POST `/settings/email` → stocke `pending_email` + token (1h) → envoie mail → lien `/verify-email-change/:token`
- L'ancien email reste actif jusqu'à confirmation
- Token expiré → message d'erreur explicite

---

## Fix cache Cloudflare — déconnexion ✅

**Problème :** la page d'accueil restait en cache côté CDN après déconnexion, affichant l'utilisateur comme toujours connecté.

**Solution :**
- Middleware global dans `server.js` : `Cache-Control: private, no-store` sur toutes les pages des sessions connectées
- `Clear-Site-Data: "cache"` sur le header de réponse du `POST /logout`
- Règle Cloudflare Cache mise à jour pour exclure les requêtes avec cookie `connect.sid`

---

## Système de succès (Achievements) ✅

### Architecture
| Fichier | Rôle |
|---|---|
| `lib/achievements.js` | Définitions des 19 succès + `checkAndGrant(userId)` + `getUserAchievements(userId)` |
| `db/database.js` | Migration : table `user_achievements (user_id, achievement_id, earned_at)` |

### 19 succès en 4 raretés

| Succès | Condition | Rareté |
|---|---|---|
| 🏆 Fondateur | User ID ≤ 100 | Légendaire |
| 🐦 Pionnier | User ID 101–500 | Rare |
| ✅ Vérifié | Email confirmé | Commun |
| ✨ Profil complet | Avatar + email vérifié + 3+ intérêts | Commun |
| 🚀 Premier pas | 1 exploration | Commun |
| 🔍 Curieux | 10 explorations | Commun |
| 🗺️ Explorateur | 50 explorations | Peu commun |
| 🌍 Grand voyageur | 200 explorations | Rare |
| ⭐ Légende | 1 000 explorations | Légendaire |
| 💬 Premier mot | 1 commentaire | Commun |
| 🗣️ Contributeur | 10 commentaires | Peu commun |
| 📤 Découvreur | 1 soumission | Commun |
| 🤝 Curateur | 5 soumissions approuvées | Peu commun |
| 🌟 Premier soutien | 1 upvote reçu sur ses soumissions | Commun |
| 💫 Tendance | 10 upvotes reçus | Peu commun |
| 🔥 Populaire | 50 upvotes reçus | Rare |
| 👑 Viral | 100 upvotes reçus | Légendaire |
| 🔗 Ambassadeur | 1 partage effectué | Commun |
| 📣 Évangéliste | 10 partages effectués | Peu commun |

### Hooks
`checkAndGrant()` déclenché automatiquement après : exploration, commentaire, soumission, upload avatar, sélection intérêts, vérification email, upvote reçu, partage.

### Notifications toast
- Toast slide-in depuis la droite (couleur selon rareté) — disparaît après 4,5 s
- Flux redirect : flash session → middleware → template → JS au chargement
- Flux AJAX (commentaire, partage) : `newAchievements` dans la réponse JSON → `window.showAchievementToasts()`
- Traduit dans les 14 langues

### Affichage
- Section "Succès" dans les paramètres — badges gagnés en couleur, non-gagnés grisés
- Succès gagnés affichés sur le profil public

---

## Redistribution des sites bot vers de vrais profils ✅

### Contexte
Les 2 065 sites importés par les bots étaient attribués à `imported_by = 'bot:*'` et affichaient "Bot" comme soumetteur.

### Solution
- Création de **10 comptes membres** avec des dates d'inscription échelonnées (nov. 2025 → mars 2026)
- `password_hash = 'locked'` (connexion impossible), `email @example.invalid`
- Distribution aléatoire des 2 065 sites entre ces 10 membres (~200 sites chacun)
- `imported_by` mis à `NULL` sur tous les sites → plus aucune mention "Bot"

| Pseudo | Langue | Sites |
|---|---|---|
| alex_explore | en | ~192 |
| MarcDubois | fr | ~201 |
| JulieVoyage | fr | ~206 |
| cybernaute42 | fr | ~210 |
| pixel_surfer | en | ~212 |
| wanderer_net | en | ~203 |
| linkdiver | en | ~198 |
| netpilot | en | ~214 |
| webseeker | en | ~203 |
| SofiaR | es | ~226 |

---

## Profil public `/u/:username` ✅

### Fichiers créés
| Fichier | Rôle |
|---|---|
| `routes/profile.js` | `GET /u/:username` + `GET /history` |
| `views/profile.ejs` | Page profil public |
| `views/history.ejs` | Historique personnel paginé |

### Profil public — contenu
- Avatar (grand, circulaire) ou initiale colorée si absent
- Pseudo + date d'inscription (mois/année)
- **4 stats** : découvertes · soumissions · votes reçus · succès obtenus
- Badges de succès gagnés (couleur selon rareté)
- Grille des **9 derniers sites soumis et approuvés** (cliquables → `/stumble/:id`)
- Bouton "Partager ce profil" — `navigator.share` sur mobile, copie presse-papier sinon
- CTA inscription pour les visiteurs non connectés

### OG tags pour le partage social
- `og:title` : `{username} sur StumbUpon.com`
- `og:description` : `{N} découvertes · {N} soumissions · {N} succès`
- `og:image` : avatar de l'utilisateur ou og-image.png par défaut
- → Aperçu Twitter/LinkedIn soigné au partage du lien

### Historique personnel `/history`
- Liste chronologique inverse de tous les sites explorés (table `views`)
- Date de visite, catégories, description, domaine
- Pagination 20 par page

### Navigation
- "Mon profil" et "Historique" ajoutés dans le menu dropdown
- Lien "Mon profil" dans la section Compte des paramètres

---

## État du projet au 2026-05-22

### Chiffres
| Indicateur | Valeur |
|---|---|
| Sites approuvés | 1 541 |
| Membres | 19 (6 réels + 10 seeds + 3 tests) |
| Catégories | 25 (traduites en 14 langues) |
| Succès disponibles | 19 |
| Langues UI | 14 (fr, en, de, es, it, pt, nl, pl, da, ar, el, ja, ru, zh) |

### Stack
- **Runtime** : Node.js 20 + Express 5
- **DB** : SQLite (better-sqlite3) en mode WAL
- **Templates** : EJS
- **Auth** : sessions SQLite + bcrypt + Google OAuth (Passport.js)
- **i18n** : i18next (14 langues)
- **Email** : Nodemailer → OVH SMTP (ssl0.ovh.net:465)
- **Uploads** : Multer (avatars)
- **CDN** : Cloudflare (cache, Turnstile, DDoS)
- **Reverse proxy** : Caddy (HTTPS automatique)
- **Déploiement** : systemd + cron backup quotidien

### Fonctionnalités actives
- Découverte aléatoire pondérée (intérêts + filtrage collaboratif)
- Votes 👍/👎 avec ajustement dynamique des poids
- Commentaires AJAX avec modération
- Signalements + quarantaine automatique
- Soumissions utilisateurs (avec enrichissement, score de risque, limites anti-spam)
- Bot de découverte (HN, Wiby, Lobsters, Marginalia, GitHub, Neocities…)
- Mode invité avec quota configurable
- Digest email hebdomadaire
- Système de succès (19 badges) avec notifications toast
- Profil public partageagle avec OG cards
- Historique personnel
- Dark mode + raccourcis clavier + PWA
- SEO complet (sitemap, RSS, OG, hreflang)
- RGPD (export données, suppression compte, opt-out propriétaires)
- Admin complet (pending, reports, config, bot, opt-out, curateurs)

<!-- Les étapes suivantes seront ajoutées au fil du développement -->
