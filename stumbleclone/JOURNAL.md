# Journal de développement — StumbleClone

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

<!-- Les étapes suivantes seront ajoutées au fil du développement -->
