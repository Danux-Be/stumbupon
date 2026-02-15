require("dotenv").config();

const express = require("express");
const path = require("path");
const fsp = require("fs/promises");
const multer = require("multer");
const sharp = require("sharp");
const TurndownService = require("turndown");
const { execFile } = require("child_process");
const bcryptjs = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Parser = require("rss-parser");

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// === SECRET KEY (load from env or use default for local dev) ===
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-dev-key-change-in-prod";

// === SECURITY HEADERS (prevent indexing + framing) ===
app.use((req, res, next) => {
  res.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// === CORS for view tracking from public site ===
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Allow danux.be and www.danux.be
  if (origin && (origin.includes('danux.be') || origin.includes('localhost'))) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', 'https://danux.be');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Origin, X-Requested-With, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// === JWT MIDDLEWARE ===
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Missing or invalid token' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'Invalid token' });
  }
}

// === ADMIN-ONLY MIDDLEWARE ===
function verifyAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin access required' });
  }
  next();
}

// === EDITOR-OR-ADMIN MIDDLEWARE (blocks 'membre' role) ===
function verifyEditor(req, res, next) {
  if (!['admin', 'editor'].includes(req.user.role)) {
    return res.status(403).json({ ok: false, error: 'Editor or admin access required' });
  }
  next();
}

// === PATHS ===
const BLOG_ROOT = "/srv/web/danux-blog";
const BLOG_CONTENT_DIR = path.join(BLOG_ROOT, "src/content/posts");
const UPLOAD_DIR = "/var/www/blog/uploads";
const BACKUP_UPLOAD_DIR = path.join(__dirname, "data", "uploads"); // Backup local
const DEPLOY_DIR = "/var/www/blog"; // Caddy sert danux.be ici
const DEPLOY_LOCK = "/tmp/danux-blog-deploy.lock";
const VIEWS_FILE = path.join(__dirname, "data", "views.json");
const USERS_FILE = path.join(__dirname, "data", "users.json");
const FEEDS_FILE = path.join(__dirname, "data", "feeds.json");
const CARDS_FILE = path.join(__dirname, "data", "cards.json");
const PARTNERS_FILE = path.join(__dirname, "data", "partners.json");

const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const IGDB_CLIENT_ID = process.env.IGDB_CLIENT_ID || "";
const IGDB_CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET || "";

console.log("[DEBUG] TMDB_API_KEY:", TMDB_API_KEY ? "SET" : "MISSING");
console.log("[DEBUG] IGDB_CLIENT_ID:", IGDB_CLIENT_ID ? "SET" : "MISSING");
console.log("[DEBUG] IGDB_CLIENT_SECRET:", IGDB_CLIENT_SECRET ? "SET" : "MISSING");

let igdbTokenCache = { token: "", expiresAt: 0 };

async function getIgdbFrenchLocalization(gameId, token) {
  try {
    const body = `fields name,summary,language.name; where game = ${gameId}; limit 50;`;
    const r = await fetch("https://api.igdb.com/v4/game_localizations", {
      method: "POST",
      headers: {
        "Client-ID": IGDB_CLIENT_ID,
        "Authorization": `Bearer ${token}`
      },
      body
    });
    if (!r.ok) return null;
    const j = await r.json();
    const fr = (j || []).find((loc) => {
      const name = String(loc?.language?.name || "").toLowerCase();
      return name === "french" || name === "français" || name === "francais";
    });
    if (!fr) return null;
    return {
      name: fr.name || "",
      summary: fr.summary || ""
    };
  } catch {
    return null;
  }
}

async function getOrCreateIgdbCover(imageId) {
  console.log("[DEBUG] getOrCreateIgdbCover called with imageId:", imageId);
  if (!imageId) {
    console.log("[DEBUG] getOrCreateIgdbCover: No imageId, returning empty");
    return "";
  }
  const finalName = `igdb-${imageId}.webp`;
  const finalPath = path.join(UPLOAD_DIR, finalName);
  const backupPath = path.join(BACKUP_UPLOAD_DIR, finalName);
  console.log("[DEBUG] getOrCreateIgdbCover: finalPath =", finalPath);
  
  // Check if exists in main or backup
  try {
    await fsp.access(finalPath);
    console.log("[DEBUG] getOrCreateIgdbCover: File exists, returning cached:", `/uploads/${finalName}`);
    return `/uploads/${finalName}`;
  } catch {
    // Check backup and restore if exists
    try {
      await fsp.access(backupPath);
      await fsp.mkdir(UPLOAD_DIR, { recursive: true });
      await fsp.copyFile(backupPath, finalPath);
      console.log("[DEBUG] getOrCreateIgdbCover: Restored from backup:", `/uploads/${finalName}`);
      return `/uploads/${finalName}`;
    } catch {
      console.log("[DEBUG] getOrCreateIgdbCover: File does not exist, downloading...");
    }
  }

  try {
    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    // Use t_1080p for high quality (1920x1080), fallback to t_720p if needed
    const srcUrl = `https://images.igdb.com/igdb/image/upload/t_1080p/${imageId}.jpg`;
    console.log("[DEBUG] getOrCreateIgdbCover: Downloading from:", srcUrl);
    const r = await fetch(srcUrl);
    if (!r.ok) {
      console.log("[DEBUG] getOrCreateIgdbCover: Download failed with status:", r.status);
      throw new Error(`IGDB cover download failed (${r.status})`);
    }
    const contentLength = Number(r.headers.get("content-length") || 0);
    if (contentLength && contentLength > 15 * 1024 * 1024) {
      throw new Error("IGDB cover too large");
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const tmpPath = path.join(UPLOAD_DIR, `igdb-${imageId}-${Date.now()}.tmp`);
    await fsp.writeFile(tmpPath, buf);
    console.log("[DEBUG] getOrCreateIgdbCover: Downloaded to temp:", tmpPath);
    try {
      await sharp(tmpPath)
        .resize(1920, 1080, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 90 })
        .toFile(finalPath);
      await fsp.unlink(tmpPath).catch(() => {});
      console.log("[DEBUG] getOrCreateIgdbCover: Converted to webp:", finalPath);
      // Backup copy
      await fsp.mkdir(BACKUP_UPLOAD_DIR, { recursive: true });
      await fsp.copyFile(finalPath, backupPath).catch(() => {});
      console.log("[DEBUG] getOrCreateIgdbCover: Backed up to:", backupPath);
      console.log("[DEBUG] getOrCreateIgdbCover: Returning path:", `/uploads/${finalName}`);
      return `/uploads/${finalName}`;
    } catch (e) {
      console.log("[DEBUG] getOrCreateIgdbCover: Sharp conversion failed:", e.message);
      const fallbackName = `igdb-${imageId}.jpg`;
      const fallbackPath = path.join(UPLOAD_DIR, fallbackName);
      const fallbackBackupPath = path.join(BACKUP_UPLOAD_DIR, fallbackName);
      await fsp.rename(tmpPath, fallbackPath).catch(() => {});
      // Backup copy
      await fsp.mkdir(BACKUP_UPLOAD_DIR, { recursive: true });
      await fsp.copyFile(fallbackPath, fallbackBackupPath).catch(() => {});
      console.log("[DEBUG] getOrCreateIgdbCover: Using fallback JPG:", `/uploads/${fallbackName}`);
      return `/uploads/${fallbackName}`;
    }
  } catch (e) {
    console.log("[DEBUG] getOrCreateIgdbCover: CRITICAL ERROR:", e.message);
    throw e;
  }
}

// Download and cache TMDB images (poster or backdrop)
async function getOrCreateTmdbImage(imagePath, type = "poster") {
  console.log("[DEBUG] getOrCreateTmdbImage called:", imagePath, type);
  if (!imagePath) return "";
  
  // TMDB image sizes: w500, w780, w1280, original
  // For poster (jaquette): w780 is good quality
  // For backdrop (couverture): w1280 for high quality
  const size = type === "backdrop" ? "w1280" : "w780";
  const safeId = imagePath.replace(/[^a-zA-Z0-9]/g, "");
  const finalName = `tmdb-${type}-${safeId}.webp`;
  const finalPath = path.join(UPLOAD_DIR, finalName);
  const backupPath = path.join(BACKUP_UPLOAD_DIR, finalName);
  
  // Check if exists
  try {
    await fsp.access(finalPath);
    console.log("[DEBUG] getOrCreateTmdbImage: cached:", `/uploads/${finalName}`);
    return `/uploads/${finalName}`;
  } catch {
    // Check backup
    try {
      await fsp.access(backupPath);
      await fsp.mkdir(UPLOAD_DIR, { recursive: true });
      await fsp.copyFile(backupPath, finalPath);
      console.log("[DEBUG] getOrCreateTmdbImage: restored from backup");
      return `/uploads/${finalName}`;
    } catch {
      console.log("[DEBUG] getOrCreateTmdbImage: downloading...");
    }
  }
  
  try {
    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    const srcUrl = `https://image.tmdb.org/t/p/${size}${imagePath}`;
    console.log("[DEBUG] getOrCreateTmdbImage: downloading from:", srcUrl);
    const r = await fetch(srcUrl);
    if (!r.ok) throw new Error(`TMDB image download failed (${r.status})`);
    
    const buf = Buffer.from(await r.arrayBuffer());
    const tmpPath = path.join(UPLOAD_DIR, `tmdb-${Date.now()}.tmp`);
    await fsp.writeFile(tmpPath, buf);
    
    try {
      await sharp(tmpPath)
        .resize(1920, 1080, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 90 })
        .toFile(finalPath);
      await fsp.unlink(tmpPath).catch(() => {});
      // Backup
      await fsp.mkdir(BACKUP_UPLOAD_DIR, { recursive: true });
      await fsp.copyFile(finalPath, backupPath).catch(() => {});
      console.log("[DEBUG] getOrCreateTmdbImage: OK:", `/uploads/${finalName}`);
      return `/uploads/${finalName}`;
    } catch (e) {
      // Fallback to jpg
      const fallbackName = `tmdb-${type}-${safeId}.jpg`;
      const fallbackPath = path.join(UPLOAD_DIR, fallbackName);
      await fsp.rename(tmpPath, fallbackPath).catch(() => {});
      await fsp.copyFile(fallbackPath, path.join(BACKUP_UPLOAD_DIR, fallbackName)).catch(() => {});
      return `/uploads/${fallbackName}`;
    }
  } catch (e) {
    console.log("[DEBUG] getOrCreateTmdbImage: ERROR:", e.message);
    return "";
  }
}

// Fetch and download multiple TMDB images (backdrops/posters for gallery)
async function getTmdbMediaImages(tmdbId, type = "movie", limit = 8) {
  if (!tmdbId || !TMDB_API_KEY) return [];
  try {
    const endpoint = type === "tv" ? "tv" : "movie";
    const imagesUrl = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}/images?api_key=${encodeURIComponent(TMDB_API_KEY)}`;
    const r = await fetch(imagesUrl);
    if (!r.ok) return [];
    const data = await r.json();
    
    // Prefer backdrops (horizontal), then posters
    const backdrops = (data.backdrops || []).slice(0, limit);
    const results = [];
    
    for (const img of backdrops) {
      if (!img.file_path) continue;
      try {
        const url = await getOrCreateTmdbImage(img.file_path, "backdrop");
        if (url) results.push(url);
      } catch (e) {
        console.log("[DEBUG] getTmdbMediaImages: failed for", img.file_path);
      }
    }
    return results;
  } catch (e) {
    console.log("[DEBUG] getTmdbMediaImages error:", e.message);
    return [];
  }
}

// Fetch TMDB videos (trailers, teasers, etc.)
async function getTmdbVideos(tmdbId, type = "movie") {
  if (!tmdbId || !TMDB_API_KEY) return [];
  try {
    const endpoint = type === "tv" ? "tv" : "movie";
    // Try French first, then English
    const videosUrlFr = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}/videos?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=fr-FR`;
    const videosUrlEn = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}/videos?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=en-US`;
    
    let videos = [];
    const rFr = await fetch(videosUrlFr);
    if (rFr.ok) {
      const dataFr = await rFr.json();
      videos = dataFr.results || [];
    }
    
    // If no French videos, try English
    if (videos.length === 0) {
      const rEn = await fetch(videosUrlEn);
      if (rEn.ok) {
        const dataEn = await rEn.json();
        videos = dataEn.results || [];
      }
    }
    
    // Filter for YouTube trailers/teasers and map to useful format
    return videos
      .filter(v => v.site === "YouTube" && ["Trailer", "Teaser", "Clip", "Featurette"].includes(v.type))
      .slice(0, 5)
      .map(v => ({
        site: "YouTube",
        name: v.name || v.type,
        type: v.type,
        url: `https://www.youtube.com/watch?v=${v.key}`,
        embed: `https://www.youtube.com/embed/${v.key}`,
        thumb: `https://img.youtube.com/vi/${v.key}/maxresdefault.jpg`
      }));
  } catch (e) {
    console.log("[DEBUG] getTmdbVideos error:", e.message);
    return [];
  }
}

async function getIgdbMediaImages(list, limit = 8) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const results = [];
  for (const item of list.slice(0, limit)) {
    const imageId = item?.image_id;
    if (!imageId) continue;
    try {
      const url = await getOrCreateIgdbCover(imageId);
      if (url) results.push(url);
    } catch (e) {
      console.log("[DEBUG] getIgdbMediaImages: failed for", imageId, e.message);
    }
  }
  return results;
}

async function getIgdbToken() {
  const now = Date.now();
  if (igdbTokenCache.token && igdbTokenCache.expiresAt > now + 30_000) {
    console.log("[DEBUG] getIgdbToken: Using cached token");
    return igdbTokenCache.token;
  }
  if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) {
    console.log("[DEBUG] getIgdbToken: Missing credentials!");
    console.log("[DEBUG]   IGDB_CLIENT_ID:", IGDB_CLIENT_ID ? "SET" : "MISSING");
    console.log("[DEBUG]   IGDB_CLIENT_SECRET:", IGDB_CLIENT_SECRET ? "SET" : "MISSING");
    throw new Error("IGDB credentials missing");
  }
  console.log("[DEBUG] getIgdbToken: Requesting new token from Twitch...");
  const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(IGDB_CLIENT_ID)}&client_secret=${encodeURIComponent(IGDB_CLIENT_SECRET)}&grant_type=client_credentials`;
  const r = await fetch(url, { method: "POST" });
  if (!r.ok) {
    console.log("[DEBUG] getIgdbToken: Twitch auth failed with status", r.status);
    throw new Error(`IGDB auth failed (${r.status})`);
  }
  const j = await r.json();
  console.log("[DEBUG] getIgdbToken: Got token, expires in", j.expires_in, "seconds");
  igdbTokenCache = {
    token: j.access_token,
    expiresAt: now + (j.expires_in * 1000 || 0)
  };
  return igdbTokenCache.token;
}

const PORT = Number(process.env.PORT || 3020);

// === USERS MANAGEMENT ===
let usersData = [];
async function loadUsers() {
  try {
    const txt = await fsp.readFile(USERS_FILE, 'utf8');
    usersData = JSON.parse(txt);
  } catch {
    usersData = [];
  }
}
async function saveUsers() {
  await fsp.mkdir(path.dirname(USERS_FILE), { recursive: true });
  await fsp.writeFile(USERS_FILE, JSON.stringify(usersData, null, 2), 'utf8');
}
(async () => {
  await loadUsers();
})();

// === VIEWS TRACKING ===
let viewsData = {};
async function loadViews() {
  try {
    const txt = await fsp.readFile(VIEWS_FILE, 'utf8');
    viewsData = JSON.parse(txt);
  } catch {
    viewsData = {};
  }
}
async function saveViews() {
  await fsp.mkdir(path.dirname(VIEWS_FILE), { recursive: true });
  await fsp.writeFile(VIEWS_FILE, JSON.stringify(viewsData, null, 2), 'utf8');
}
loadViews();

// === RSS FEEDS MANAGEMENT ===
let feedsData = [];
const rssParser = new Parser();

async function loadFeeds() {
  try {
    const txt = await fsp.readFile(FEEDS_FILE, 'utf8');
    feedsData = JSON.parse(txt);
  } catch {
    feedsData = [];
  }
}

async function saveFeeds() {
  await fsp.mkdir(path.dirname(FEEDS_FILE), { recursive: true });
  await fsp.writeFile(FEEDS_FILE, JSON.stringify(feedsData, null, 2), 'utf8');
}

async function fetchFeedArticles(feedUrl, limit = 10) {
  try {
    // Validate URL format
    try {
      new URL(feedUrl);
    } catch {
      return { success: false, error: `Invalid URL format: ${feedUrl}` };
    }

    const feed = await rssParser.parseURL(feedUrl);
    const articles = (feed.items || []).slice(0, limit).map(item => ({
      title: item.title || 'Sans titre',
      link: item.link || '',
      description: item.content || item.summary || '',
      pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
      author: item.creator || item.author || 'Auteur inconnu',
      guid: item.guid || item.link || item.title,
      image: item.image?.url || item.image || null,
    }));
    return { success: true, articles, feedTitle: feed.title || 'RSS Feed' };
  } catch (err) {
    // Extract more meaningful error message
    let errorMsg = err.message;
    if (err.message.includes('404')) {
      errorMsg = `Feed not found (404): The RSS feed URL may be incorrect or the feed is no longer available. URL: ${feedUrl}`;
    } else if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED')) {
      errorMsg = `Unable to connect to feed: The domain may be unreachable. URL: ${feedUrl}`;
    } else if (err.message.includes('Expecting a RSS feed')) {
      errorMsg = `This URL does not contain a valid RSS feed. Make sure you're using the correct feed URL.`;
    }
    return { success: false, error: errorMsg };
  }
}

(async () => {
  await loadFeeds();
})();

// === CARDS MANAGEMENT (Fiches: jeux, films, séries, logiciels) ===
let cardsData = [];

async function loadCards() {
  try {
    const txt = await fsp.readFile(CARDS_FILE, 'utf8');
    cardsData = JSON.parse(txt);
  } catch {
    cardsData = [];
  }
}

async function saveCards() {
  await fsp.mkdir(path.dirname(CARDS_FILE), { recursive: true });
  await fsp.writeFile(CARDS_FILE, JSON.stringify(cardsData, null, 2), 'utf8');
}

function generateCardId() {
  return 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

(async () => {
  await loadCards();
})();

// === PARSE FRONTMATTER ===
function parseFrontmatter(txt) {
  const m = txt.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return { data: {}, content: txt };
  const fmText = m[1];
  const content = txt.slice(m[0].length).trim();
  const data = {};
  for (const line of fmText.split('\n')) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      let val = match[2].trim();
      // parse arrays
      if (val.startsWith('[') && val.endsWith(']')) {
        try {
          val = JSON.parse(val.replace(/'/g, '"'));
        } catch {
          val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
        }
      }
      // parse booleans
      else if (val === 'true') val = true;
      else if (val === 'false') val = false;
      // strip quotes
      else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (match[1] === "cardData" && typeof val === "string") {
        try {
          const jsonStr = val.replace(/\\"/g, '"');
          val = JSON.parse(jsonStr);
        } catch {}
      }
      data[match[1]] = val;
    }
  }
  return { data, content };
}

// === ROBOTS.TXT — Block all crawlers from admin ===
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /\n');
});

// === STATIC ADMIN UI ===
app.use(express.static(path.join(__dirname, "public")));
app.use("/tinymce", express.static(path.join(__dirname, "node_modules/tinymce")));
// Serve uploaded files so URLs like /uploads/<file> work from the admin server
app.use('/uploads', express.static(UPLOAD_DIR));

// === HELPERS ===
function slugify(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function escapeYaml(str) {
  return String(str || "").replace(/"/g, '\\"');
}

// Remove leading YAML/frontmatter from markdown content if present (copied from other posts)
function stripLeadingFrontmatter(md) {
  let s = String(md || "");
  // strip BOM
  s = s.replace(/^\uFEFF/, "");
  const re = /^[ \t]*---\s*$[\s\S]*?^[ \t]*---\s*(\r?\n)?/m;
  if (re.test(s)) {
    s = s.replace(re, "");
  }
  return s;
}

// Normalize a frontmatter block: remove uneven indentation and ensure standard '---' markers
function normalizeFrontmatterText(md) {
  const s = String(md || "");
  const lines = s.split(/\r?\n/);
  let start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*---\s*$/.test(lines[i])) {
      if (start === -1) start = i;
      else { end = i; break; }
    }
  }
  if (start === -1 || end === -1) return s;

  const fmLines = lines.slice(start + 1, end);
  // Trim each line and remove leading/trailing spaces; keep empty lines as-is
  const cleanFm = fmLines.map((l) => l.trim()).filter((l, idx, arr) => {
    // keep lines that are not purely empty in middle; allow empty only between keys
    return true;
  });

  const rest = lines.slice(end + 1).join("\n").replace(/^\s*\n/, "");
  const rebuilt = ['---', ...cleanFm, '---', '', rest].join('\n');
  return rebuilt;
}

async function writeFileAtomic(file, text) {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp_${path.basename(file)}_${Date.now()}`);
  await fsp.writeFile(tmp, text, "utf8");
  await fsp.rename(tmp, file);
}

function execp(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts }, (err, stdout, stderr) => {
      if (err) {
        return reject(
          new Error(`${cmd} ${args.join(" ")} failed: ${String(stderr || err.message)}`)
        );
      }
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

async function withDeployLock(fn) {
  let handle;
  try {
    handle = await fsp.open(DEPLOY_LOCK, "wx"); // fail si existe
    return await fn();
  } finally {
    try { if (handle) await handle.close(); } catch {}
    try { await fsp.unlink(DEPLOY_LOCK); } catch {}
  }
}

// === HTML -> Markdown ===
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
});

turndown.addRule("keepImages", {
  filter: ["img"],
  replacement: (content, node) => {
    const src = node.getAttribute("src") || "";
    const alt = node.getAttribute("alt") || "";
    return `![${alt}](${src})`;
  },
});

// Preserve iframes (YouTube, Twitch, etc.) as raw HTML in markdown
turndown.addRule("keepIframes", {
  filter: ["iframe"],
  replacement: (content, node) => {
    const attrs = [];
    for (const attr of node.attributes) {
      attrs.push(`${attr.name}="${attr.value}"`);
    }
    return `\n\n<iframe ${attrs.join(" ")}></iframe>\n\n`;
  },
});

// Preserve <video> tags as raw HTML in markdown
turndown.addRule("keepVideo", {
  filter: ["video"],
  replacement: (content, node) => {
    return `\n\n${node.outerHTML}\n\n`;
  },
});

// Preserve <embed> and <object> tags as raw HTML in markdown
turndown.addRule("keepEmbed", {
  filter: ["embed", "object"],
  replacement: (content, node) => {
    return `\n\n${node.outerHTML}\n\n`;
  },
});

function htmlToMarkdown(html) {
  try {
    return turndown.turndown(html || "");
  } catch {
    return (html || "").trim();
  }
}

// === AUTHENTICATION ENDPOINTS (NO JWT REQUIRED) ===
app.post("/api/auth/signup", verifyToken, async (req, res) => {
  try {
    // Only admins can create new users
    if (req.user.role !== 'admin') {
      return res.status(403).json({ ok: false, error: "Only admins can create users" });
    }
    
    const { username, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "Username and password required" });
    }
    
    // Check if user already exists
    const exists = usersData.find(u => u.username === username);
    if (exists) {
      return res.status(400).json({ ok: false, error: "User already exists" });
    }
    
    const hash = await bcryptjs.hash(password, 10);
    const user = {
      username,
      passwordHash: hash,
      role: role || 'membre',
      createdAt: new Date().toISOString()
    };
    usersData.push(user);
    await saveUsers();
    
    res.json({ ok: true, message: "User created successfully" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "Username and password required" });
    }
    
    const user = usersData.find(u => u.username === username);
    if (!user) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }
    
    const isValid = await bcryptjs.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }
    
    const token = jwt.sign({ username: user.username, role: user.role || 'membre' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, token });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/auth/logout", (req, res) => {
  // Token expiration is handled on client side by removing from localStorage
  res.json({ ok: true, message: "Logged out" });
});
// === USER MANAGEMENT ENDPOINTS (PROTECTED - ADMIN ONLY) ===

// List all users
app.get("/api/users", verifyToken, verifyAdmin, (req, res) => {
  try {
    const users = usersData.map(u => ({
      username: u.username,
      role: u.role || 'membre',
      createdAt: u.createdAt
    }));
    res.json({ ok: true, users });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Update user (role, password)
app.put("/api/users/:username", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { username } = req.params;
    const { role, password } = req.body;
    
    const user = usersData.find(u => u.username === username);
    if (!user) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }
    
    if (role) {
      if (!["admin", "editor", "membre"].includes(role)) {
        return res.status(400).json({ ok: false, error: "Invalid role" });
      }
      user.role = role;
    }
    
    if (password) {
      user.passwordHash = await bcryptjs.hash(password, 10);
    }
    
    await saveUsers();
    res.json({ ok: true, message: "User updated successfully" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Delete user
app.delete("/api/users/:username", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { username } = req.params;
    
    // Prevent deleting yourself
    if (username === req.user.username) {
      return res.status(400).json({ ok: false, error: "Cannot delete your own account" });
    }
    
    const index = usersData.findIndex(u => u.username === username);
    if (index === -1) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }
    
    // Prevent deleting the last admin
    const userToDelete = usersData[index];
    if (userToDelete.role === 'admin') {
      const adminCount = usersData.filter(u => u.role === 'admin').length;
      if (adminCount <= 1) {
        return res.status(400).json({ ok: false, error: "Cannot delete the last admin user" });
      }
    }
    
    usersData.splice(index, 1);
    await saveUsers();
    res.json({ ok: true, message: "User deleted successfully" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});
// === UPLOAD IMAGES (safe) ===
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        await fsp.mkdir(UPLOAD_DIR, { recursive: true });
        cb(null, UPLOAD_DIR);
      } catch (e) {
        cb(e);
      }
    },
    filename: (req, file, cb) => {
      const extFromName = path.extname(file.originalname || "").toLowerCase();
      const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extFromName)
        ? extFromName
        : "";

      const base = path
        .basename(file.originalname || "image", extFromName)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 40) || "image";

      cb(null, `${base}-${Date.now()}${safeExt}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Type de fichier non autorisé (jpg/png/webp/gif uniquement)."));
    }
    cb(null, true);
  },
});

app.post("/api/upload", verifyToken, verifyEditor, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded" });
    
    const inputPath = req.file.path;
    const filename = req.file.filename;
    
    // Compresser l'image (resize max 1200px de large, quality 85%)
    try {
      await sharp(inputPath)
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(inputPath + '.webp');
      
      // Remplacer l'original par la version compressée en webp
      const newFilename = filename.replace(/\.[^.]+$/, '') + '.webp';
      const destPath = path.join(UPLOAD_DIR, newFilename);
      await fsp.rename(inputPath + '.webp', destPath);
      await fsp.unlink(inputPath).catch(() => {}); // Supprimer l'original
      
      // Backup dans data/uploads/
      await fsp.copyFile(destPath, path.join(BACKUP_UPLOAD_DIR, newFilename)).catch(err =>
        console.error("Backup upload failed:", err.message)
      );
      
      res.json({ ok: true, url: `/uploads/${newFilename}` });
    } catch (compressErr) {
      // Si la compression échoue, garder l'original
      console.error("Compression failed, keeping original:", compressErr.message);
      // Backup l'original aussi
      await fsp.copyFile(inputPath, path.join(BACKUP_UPLOAD_DIR, filename)).catch(err =>
        console.error("Backup upload failed:", err.message)
      );
      res.json({ ok: true, url: `/uploads/${filename}` });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Gestion erreurs Multer + autres
app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ ok: false, error: "Image trop lourde (limite serveur atteinte)." });
  }
  if (err) {
    return res.status(400).json({ ok: false, error: String(err.message || err) });
  }
  next();
});

// === DEPLOY ===
async function runDeploy({ install = false } = {}) {
  const env = { ...process.env };

  return withDeployLock(async () => {
    if (install) {
      await execp("pnpm", ["install", "--frozen-lockfile"], { cwd: BLOG_ROOT, env });
    }

    await execp("pnpm", ["build"], { cwd: BLOG_ROOT, env });

    // Sync dist -> /var/www/blog (sans toucher uploads)
    const dist = path.join(BLOG_ROOT, "dist");
    await execp("bash", ["-lc", `rsync -rv --delete --exclude 'uploads/' '${dist}/' '${DEPLOY_DIR}/'`], {
      cwd: BLOG_ROOT,
      env,
    });

    // version marker
    let commit = "unknown";
    try {
      const r = await execp("git", ["rev-parse", "--short", "HEAD"], { cwd: BLOG_ROOT, env });
      commit = r.stdout.trim() || "unknown";
    } catch {}

    const stamp = `${new Date().toISOString()} ${commit}\n`;
    await fsp.writeFile(path.join(DEPLOY_DIR, "version.txt"), stamp, "utf8");

    return { status: "deployed", commit };
  });
}

app.post("/api/deploy", verifyToken, verifyEditor, async (req, res) => {
  try {
    const install = req.body?.install === true || req.body?.install === "true";
    const r = await runDeploy({ install });
    res.json({ ok: true, result: r });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// === FIX EXISTING POSTS FRONTMATTER ===
app.post('/api/fix-frontmatter', async (req, res) => {
  try {
    const files = await fsp.readdir(BLOG_CONTENT_DIR);
    const mdFiles = files.filter((f) => f.endsWith('.md'));
    const fixed = [];
    for (const f of mdFiles) {
      const p = path.join(BLOG_CONTENT_DIR, f);
      let txt = await fsp.readFile(p, 'utf8');
      const normalized = normalizeFrontmatterText(txt);
      if (normalized !== String(txt)) {
        await writeFileAtomic(p, normalized);
        fixed.push(f);
      }
    }
    res.json({ ok: true, fixed });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// === ADD TIME TO EXISTING pubDate FIELDS ===
app.post('/api/fix-pubdates', async (req, res) => {
  try {
    const files = await fsp.readdir(BLOG_CONTENT_DIR);
    const mdFiles = files.filter((f) => f.endsWith('.md'));
    const updated = [];
    for (const f of mdFiles) {
      const p = path.join(BLOG_CONTENT_DIR, f);
      let txt = await fsp.readFile(p, 'utf8');

      // find pubDate line in the first frontmatter block
      const fmMatch = txt.match(/^[ \t]*---\s*\n([\s\S]*?)\n[ \t]*---/m);
      if (!fmMatch) continue;
      const fm = fmMatch[1];
      const pubMatch = fm.match(/(^|\n)\s*pubDate:\s*(\S+)\s*(\n|$)/);
      if (!pubMatch) continue;
      const val = pubMatch[2];
      // if value already contains a T (time), skip
      if (val.includes('T')) continue;

      // derive time from file mtime to keep some sensible ordering
      const st = await fsp.stat(p);
      const mtimeIso = st.mtime.toISOString().slice(0, 19) + 'Z';

      const newFm = fm.replace(pubMatch[0], `\npubDate: ${mtimeIso}\n`);
      const newTxt = txt.replace(fmMatch[0], `---\n${newFm}\n---`);
      await writeFileAtomic(p, newTxt);
      updated.push({ file: f, pubDate: mtimeIso });
    }
    res.json({ ok: true, updated });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// === CREATE/UPDATE POST ===
app.post("/api/post", verifyToken, verifyEditor, async (req, res) => {
  try {
    const { title, slug, tags, html, mode, deploy, cover, youtube, category, cardData, pubDate: existingPubDate } = req.body || {};
    if (!title) return res.status(400).json({ ok: false, error: "Missing title" });

    // slug strict
    const s = slug ? slugify(String(slug)) : slugify(title);
    if (!s) return res.status(400).json({ ok: false, error: "Missing slug" });

    const tagList = Array.isArray(tags)
      ? tags.map((t) => String(t).trim()).filter(Boolean)
      : String(tags || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);

    // Keep existing pubDate if provided (edit mode), otherwise use current time (new post)
    const pubDate = existingPubDate || (new Date().toISOString().slice(0, 19) + 'Z');

    // Convert HTML -> Markdown and strip any leading frontmatter the user may have pasted
    let mdBody = htmlToMarkdown(String(html || ""));
    mdBody = stripLeadingFrontmatter(mdBody).trim() + "\n";

    // Helper to sanitize YAML string values (escape quotes, strip newlines)
    function safeVal(v) {
      return escapeYaml(String(v || "")).replace(/\r?\n/g, " ");
    }

    // Server-side validations to avoid generating invalid frontmatter
    if (!title || !String(title).trim()) {
      return res.status(400).json({ ok: false, error: "Title is required" });
    }

    if (!s || !String(s).trim()) {
      return res.status(400).json({ ok: false, error: "Slug generation failed" });
    }

    // Build frontmatter lines explicitly to avoid accidental indentation/issues
    const fmLines = ["---"];
    fmLines.push(`title: "${safeVal(title)}"`);
    fmLines.push(`slug: "${safeVal(s)}"`);
    // write pubDate as an unquoted YAML date (Astro expects `date` type)
    fmLines.push(`pubDate: ${pubDate}`);
    // Add author from authenticated user
    fmLines.push(`author: "${safeVal(req.user.username)}"`);

    if (String(youtube || "").trim()) {
      fmLines.push(`youtube: "${safeVal(youtube)}"`);
    } else if (String(cover || "").trim()) {
      fmLines.push(`cover: "${safeVal(cover)}"`);
    }

    if (String(category || "").trim()) {
      fmLines.push(`category: "${safeVal(category)}"`);
    }
    if (cardData && typeof cardData === "object") {
      const json = JSON.stringify(cardData);
      fmLines.push(`cardData: "${escapeYaml(json)}"`);
    }

    fmLines.push(`tags: [${tagList.map((t) => `"${safeVal(t)}"`).join(", ")}]`);
    fmLines.push(`draft: ${mode === "draft" ? "true" : "false"}`);
    fmLines.push("---\n");

    const frontmatter = fmLines.join("\n") + "\n\n";

    const outFile = path.join(BLOG_CONTENT_DIR, `${s}.md`);
    await writeFileAtomic(outFile, frontmatter + mdBody);

    let deployResult = null;
    if (deploy === true || deploy === "true") {
      deployResult = await runDeploy();
    }

    res.json({ ok: true, file: outFile, deploy: deployResult });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get("/api/film/search", verifyToken, verifyEditor, async (req, res) => {
    try {
      const query = String(req.query.query || "").trim();
      if (!query) return res.status(400).json({ ok: false, error: "Missing query" });
      if (!TMDB_API_KEY) {
        return res.status(400).json({ ok: false, error: "TMDB_API_KEY is not configured" });
      }
      const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=fr-FR&include_adult=false&page=1&query=${encodeURIComponent(query)}`;
      const searchRes = await fetch(searchUrl);
      if (!searchRes.ok) {
        return res.status(502).json({ ok: false, error: `TMDB search failed (${searchRes.status})` });
      }
      const searchJson = await searchRes.json();
      const results = (searchJson.results || []).slice(0, 5).map((r) => ({
        id: r.id,
        title: r.title,
        releaseDate: r.release_date || "",
      }));
      res.json({ ok: true, results });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
});

app.get("/api/film/lookup", verifyToken, verifyEditor, async (req, res) => {
    try {
      const title = String(req.query.title || "").trim();
      const id = String(req.query.id || "").trim();
      if (!title && !id) return res.status(400).json({ ok: false, error: "Missing title or id" });
      if (!TMDB_API_KEY) {
        return res.status(400).json({ ok: false, error: "TMDB_API_KEY is not configured" });
      }

      let movieId = id;
      let first = null;
      if (!movieId) {
        const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=fr-FR&include_adult=false&page=1&query=${encodeURIComponent(title)}`;
        const searchRes = await fetch(searchUrl);
        if (!searchRes.ok) {
          return res.status(502).json({ ok: false, error: `TMDB search failed (${searchRes.status})` });
        }
        const searchJson = await searchRes.json();
        first = (searchJson.results || [])[0];
        if (!first?.id) {
          return res.status(404).json({ ok: false, error: "Film not found" });
        }
        movieId = String(first.id);
      }

      const detailsUrl = `https://api.themoviedb.org/3/movie/${movieId}?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=fr-FR`;
      const creditsUrl = `https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=fr-FR`;

      const [detailsRes, creditsRes] = await Promise.all([fetch(detailsUrl), fetch(creditsUrl)]);
      if (!detailsRes.ok) {
        return res.status(502).json({ ok: false, error: `TMDB details failed (${detailsRes.status})` });
      }
      const details = await detailsRes.json();
      const credits = creditsRes.ok ? await creditsRes.json() : { crew: [] };

      const director = (credits.crew || []).find((c) => c.job === "Director")?.name || "";
      const genre = (details.genres || []).map((g) => g.name).join(", ");
      const rating = typeof details.vote_average === "number" ? details.vote_average.toFixed(1) : "";

      // Download poster (jaquette) and backdrop (couverture)
      let poster = "";
      let backdrop = "";
      if (details.poster_path) {
        poster = await getOrCreateTmdbImage(details.poster_path, "poster");
      }
      if (details.backdrop_path) {
        backdrop = await getOrCreateTmdbImage(details.backdrop_path, "backdrop");
      }
      
      // Get additional images and videos
      const images = await getTmdbMediaImages(movieId, "movie", 8);
      const videos = await getTmdbVideos(movieId, "movie");
      console.log("[DEBUG] film/lookup: poster=", poster, "backdrop=", backdrop, "images=", images.length, "videos=", videos.length);

      res.json({
        ok: true,
        film: {
          tmdbId: movieId,
          title: details.title || first?.title || title,
          releaseDate: details.release_date || first?.release_date || "",
          director,
          duration: details.runtime ? String(details.runtime) : "",
          genre,
          rating,
          synopsis: details.overview || first?.overview || "",
          poster,    // Jaquette (vertical poster)
          backdrop,  // Couverture (horizontal backdrop for article cover)
          images,    // Gallery images
          videos     // Trailers and clips
        }
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
});

// === SERIE SEARCH (TMDB) ===
app.get("/api/serie/search", verifyToken, verifyEditor, async (req, res) => {
    try {
      const query = String(req.query.query || "").trim();
      if (!query) return res.status(400).json({ ok: false, error: "Missing query" });
      if (!TMDB_API_KEY) {
        return res.status(400).json({ ok: false, error: "TMDB_API_KEY is not configured" });
      }
      const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=fr-FR&include_adult=false&page=1&query=${encodeURIComponent(query)}`;
      const searchRes = await fetch(searchUrl);
      if (!searchRes.ok) {
        return res.status(502).json({ ok: false, error: `TMDB search failed (${searchRes.status})` });
      }
      const searchJson = await searchRes.json();
      const results = (searchJson.results || []).slice(0, 5).map((r) => ({
        id: r.id,
        name: r.name,
        releaseDate: r.first_air_date || "",
      }));
      res.json({ ok: true, results });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
});

// === SERIE LOOKUP (TMDB) ===
app.get("/api/serie/lookup", verifyToken, verifyEditor, async (req, res) => {
    try {
      const title = String(req.query.title || "").trim();
      const id = String(req.query.id || "").trim();
      if (!title && !id) return res.status(400).json({ ok: false, error: "Missing title or id" });
      if (!TMDB_API_KEY) {
        return res.status(400).json({ ok: false, error: "TMDB_API_KEY is not configured" });
      }

      let seriesId = id;
      let first = null;
      if (!seriesId) {
        const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=fr-FR&include_adult=false&page=1&query=${encodeURIComponent(title)}`;
        const searchRes = await fetch(searchUrl);
        if (!searchRes.ok) {
          return res.status(502).json({ ok: false, error: `TMDB search failed (${searchRes.status})` });
        }
        const searchJson = await searchRes.json();
        first = (searchJson.results || [])[0];
        if (!first?.id) {
          return res.status(404).json({ ok: false, error: "Serie not found" });
        }
        seriesId = String(first.id);
      }

      const detailsUrl = `https://api.themoviedb.org/3/tv/${seriesId}?api_key=${encodeURIComponent(TMDB_API_KEY)}&language=fr-FR`;
      // Pour les séries, "credits" nous donne le casting, mais les créateurs sont souvent dans "created_by" du détail
      
      const detailsRes = await fetch(detailsUrl);
      if (!detailsRes.ok) {
        return res.status(502).json({ ok: false, error: `TMDB details failed (${detailsRes.status})` });
      }
      const details = await detailsRes.json();

      // Creators
      const creators = (details.created_by || []).map(c => c.name).join(", ");
      
      const genre = (details.genres || []).map((g) => g.name).join(", ");
      const rating = typeof details.vote_average === "number" ? details.vote_average.toFixed(1) : "";

      // Download poster (jaquette) and backdrop (couverture)
      let poster = "";
      let backdrop = "";
      if (details.poster_path) {
        poster = await getOrCreateTmdbImage(details.poster_path, "poster");
      }
      if (details.backdrop_path) {
        backdrop = await getOrCreateTmdbImage(details.backdrop_path, "backdrop");
      }
      
      // Get additional images and videos
      const images = await getTmdbMediaImages(seriesId, "tv", 8);
      const videos = await getTmdbVideos(seriesId, "tv");
      console.log("[DEBUG] serie/lookup: poster=", poster, "backdrop=", backdrop, "images=", images.length, "videos=", videos.length);

      res.json({
        ok: true,
        serie: {
          tmdbId: seriesId,
          name: details.name || first?.name || title,
          firstAirDate: details.first_air_date || first?.first_air_date || "",
          creators,
          seasons: details.number_of_seasons || 1,
          episodes: details.number_of_episodes || 0,
          genre,
          rating,
          synopsis: details.overview || first?.overview || "",
          poster,    // Jaquette (vertical)
          backdrop,  // Couverture (horizontal)
          status: details.status,
          images,    // Gallery images
          videos     // Trailers and clips
        }
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    port: PORT,
    blogContentDir: BLOG_CONTENT_DIR,
    uploadsDir: UPLOAD_DIR,
    deployDir: DEPLOY_DIR,
  });
});

// === RSS FEEDS ENDPOINTS ===

// List all RSS feeds
app.get("/api/rss/feeds", verifyToken, verifyEditor, (req, res) => {
  try {
    res.json({ ok: true, feeds: feedsData });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// === GAME LOOKUP (IGDB) ===
app.get("/api/game/search", verifyToken, verifyEditor, async (req, res) => {
  try {
    const query = String(req.query.query || "").trim();
    if (!query) return res.status(400).json({ ok: false, error: "Missing query" });
    const token = await getIgdbToken();

    const body = `search "${query.replace(/"/g, "")}"; fields name,first_release_date; limit 5;`;
    const r = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": IGDB_CLIENT_ID,
        "Authorization": `Bearer ${token}`
      },
      body
    });
    if (!r.ok) return res.status(502).json({ ok: false, error: `IGDB search failed (${r.status})` });
    const j = await r.json();
    const results = (j || []).slice(0, 5).map((g) => ({
      id: g.id,
      name: g.name,
      releaseDate: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : ""
    }));
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get("/api/game/lookup", verifyToken, verifyEditor, async (req, res) => {
  try {
    const id = String(req.query.id || "").trim();
    console.log("[DEBUG] game/lookup: id =", id);
    if (!id) return res.status(400).json({ ok: false, error: "Missing id" });
    const token = await getIgdbToken();
    console.log("[DEBUG] game/lookup: token obtained, length =", token?.length);

    const body = `fields name,first_release_date,genres.name,platforms.name,involved_companies.company.name,involved_companies.publisher,involved_companies.developer,summary,aggregated_rating,cover.image_id,artworks.image_id,screenshots.image_id,videos.video_id,videos.name; where id = ${id}; limit 1;`;
    console.log("[DEBUG] game/lookup: IGDB query =", body);
    const r = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": IGDB_CLIENT_ID,
        "Authorization": `Bearer ${token}`
      },
      body
    });
    if (!r.ok) {
      const errText = await r.text();
      console.log("[DEBUG] game/lookup: IGDB error response =", errText);
      return res.status(502).json({ ok: false, error: `IGDB lookup failed (${r.status}): ${errText}` });
    }
    const j = await r.json();
    const g = (j || [])[0];
    if (!g) return res.status(404).json({ ok: false, error: "Game not found" });

    const companies = g.involved_companies || [];
    const publisher = companies.find((c) => c.publisher)?.company?.name || "";
    const developer = companies.find((c) => c.developer)?.company?.name || "";

    const localization = await getIgdbFrenchLocalization(id, token);
    console.log("[DEBUG] game/lookup: localization =", localization);
    
    const hasFrenchName = !!localization?.name?.trim();
    const hasFrenchSummary = !!localization?.summary?.trim();

    let localizedName = g.name || "";
    let localizedSummary = ""; // Laisse vide si pas de français
    
    if (hasFrenchName) {
      localizedName = localization.name.trim();
    }
    
    if (hasFrenchSummary) {
      localizedSummary = localization.summary.trim();
    }
    // Sinon localizedSummary reste vide
    console.log("[DEBUG] game/lookup: localization =", localization);
    console.log("[DEBUG] game/lookup: g.cover?.image_id =", g.cover?.image_id);
    console.log("[DEBUG] game/lookup: g.artworks =", g.artworks);
    console.log("[DEBUG] game/lookup: g.screenshots =", g.screenshots);
    
    let cover = "";
    if (g.cover?.image_id) {
      try {
        console.log("[DEBUG] game/lookup: Calling getOrCreateIgdbCover with:", g.cover.image_id);
        cover = await getOrCreateIgdbCover(g.cover.image_id);
        console.log("[DEBUG] game/lookup: Cover result:", cover);
      } catch (e) {
        console.log("[DEBUG] game/lookup: Cover download error:", e.message);
        cover = "";
      }
    }

    // Download first artwork (preferred) or fallback to first screenshot for article cover
    let screenshot = "";
    const artworkId = g.artworks && g.artworks.length > 0 ? g.artworks[0].image_id : "";
    const screenshotId = g.screenshots && g.screenshots.length > 0 ? g.screenshots[0].image_id : "";

    const heroImageId = artworkId || screenshotId;
    if (heroImageId) {
      try {
        console.log("[DEBUG] game/lookup: Downloading hero image:", heroImageId);
        screenshot = await getOrCreateIgdbCover(heroImageId);
        console.log("[DEBUG] game/lookup: Hero image result:", screenshot);
      } catch (e) {
        console.log("[DEBUG] game/lookup: Hero image download error:", e.message);
      }
    }

    const artworks = await getIgdbMediaImages(g.artworks, 8);
    const screenshots = await getIgdbMediaImages(g.screenshots, 8);
    const videos = (g.videos || [])
      .map((v) => {
        const site = String(v.site || "").toLowerCase();
        const videoId = v.video_id || "";
        if (!videoId) return null;
        if (site === "youtube") {
          return {
            site: "YouTube",
            name: v.name || "",
            url: `https://www.youtube.com/watch?v=${videoId}`,
            embed: `https://www.youtube.com/embed/${videoId}`,
            thumb: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
          };
        }
        return {
          site: v.site || "",
          name: v.name || "",
          url: videoId
        };
      })
      .filter(Boolean);

    console.log("[DEBUG] game/lookup: Final game object:", {
      name: localizedName,
      cover,
      screenshot,
      artworks: artworks.length,
      screenshots: screenshots.length,
      videos: videos.length
    });
    res.json({
      ok: true,
      game: {
        name: localizedName,
        releaseDate: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : "",
        consoles: (g.platforms || []).map((p) => p.name).join(", "),
        publisher,
        developer,
        genre: (g.genres || []).map((ge) => ge.name).join(", "),
        description: localizedSummary,
        descriptionLang: hasFrenchSummary ? "fr" : "",
        rating: typeof g.aggregated_rating === "number" ? g.aggregated_rating.toFixed(1) : "",
        cover,
        screenshot,
        artworks,
        screenshots,
        videos
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Add a new RSS feed
app.post("/api/rss/feeds", verifyToken, verifyEditor, async (req, res) => {
  try {
    const { url, name } = req.body;
    if (!url) return res.status(400).json({ ok: false, error: "URL is required" });

    // Validate by trying to fetch the feed
    const result = await fetchFeedArticles(url, 1);
    if (!result.success) {
      return res.status(400).json({ ok: false, error: `Invalid RSS feed: ${result.error}` });
    }

    // Check for duplicates
    if (feedsData.some(f => f.url === url)) {
      return res.status(400).json({ ok: false, error: "This feed is already added" });
    }

    const feed = {
      id: Date.now().toString(),
      url,
      name: name || result.feedTitle,
      addedAt: new Date().toISOString(),
      lastFetched: null,
    };

    feedsData.push(feed);
    await saveFeeds();
    res.json({ ok: true, feed });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Delete a RSS feed
app.delete("/api/rss/feeds/:id", verifyToken, verifyEditor, async (req, res) => {
  try {
    const { id } = req.params;
    const index = feedsData.findIndex(f => f.id === id);
    if (index === -1) {
      return res.status(404).json({ ok: false, error: "Feed not found" });
    }
    feedsData.splice(index, 1);
    await saveFeeds();
    res.json({ ok: true, deleted: id });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Get articles from a specific feed
app.get("/api/rss/feeds/:id/articles", verifyToken, verifyEditor, async (req, res) => {
  try {
    const { id } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    const feed = feedsData.find(f => f.id === id);
    if (!feed) {
      return res.status(404).json({ ok: false, error: "Feed not found" });
    }

    const result = await fetchFeedArticles(feed.url, limit);
    if (!result.success) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    // Update lastFetched timestamp
    feed.lastFetched = new Date().toISOString();
    await saveFeeds();

    res.json({ ok: true, articles: result.articles, feedTitle: result.feedTitle });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Get articles from all feeds (aggregated)
app.get("/api/rss/articles", verifyToken, verifyEditor, async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    const allArticles = [];

    for (const feed of feedsData) {
      const result = await fetchFeedArticles(feed.url, 10);
      if (result.success) {
        allArticles.push(
          ...result.articles.map(a => ({ ...a, feedName: feed.name, feedId: feed.id }))
        );
      }
    }

    // Sort by date (newest first)
    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    res.json({ ok: true, articles: allArticles.slice(0, limit) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Create a draft post from an RSS article
app.post("/api/rss/create-from-article", verifyToken, verifyEditor, async (req, res) => {
  try {
    const { title, link, description, feedName } = req.body;
    if (!title || !description) {
      return res.status(400).json({ ok: false, error: "Title and description are required" });
    }

    const slug = slugify(title);
    if (!slug) return res.status(400).json({ ok: false, error: "Invalid title" });

    const pubDate = new Date().toISOString().slice(0, 19) + 'Z';

    // Build markdown from description (usually HTML)
    let mdBody = htmlToMarkdown(String(description || ""));
    mdBody = stripLeadingFrontmatter(mdBody).trim() + "\n";

    // Add source attribution
    if (link) {
      mdBody = `**Source:** [${feedName}](${link})\n\n${mdBody}`;
    }

    function safeVal(v) {
      return escapeYaml(String(v || "")).replace(/\r?\n/g, " ");
    }

    const fmLines = ["---"];
    fmLines.push(`title: "${safeVal(title)}"`);
    fmLines.push(`slug: "${safeVal(slug)}"`);
    fmLines.push(`pubDate: ${pubDate}`);
    fmLines.push(`author: "${safeVal(req.user.username)}"`);
    fmLines.push(`tags: ["rss", "${safeVal(feedName)}"]`);
    fmLines.push(`draft: true`);
    fmLines.push("---\n");

    const frontmatter = fmLines.join("\n") + "\n\n";
    const outFile = path.join(BLOG_CONTENT_DIR, `${slug}.md`);

    // Check if post already exists
    try {
      await fsp.stat(outFile);
      return res.status(400).json({ ok: false, error: "A post with this slug already exists" });
    } catch {
      // File doesn't exist, proceed
    }

    await writeFileAtomic(outFile, frontmatter + mdBody);
    res.json({ ok: true, message: "Draft post created", slug, file: outFile });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// === CARDS API (Fiches: jeux, films, séries, logiciels) ===

// List all cards
app.get("/api/cards", verifyToken, verifyEditor, async (req, res) => {
  try {
    const typeFilter = req.query.type;
    let cards = cardsData;
    if (typeFilter) {
      cards = cards.filter(c => c.type === typeFilter);
    }
    // Sort by createdAt descending (newest first)
    cards = cards.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ ok: true, cards });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Get single card by ID
app.get("/api/card/:id", verifyToken, verifyEditor, async (req, res) => {
  try {
    const card = cardsData.find(c => c.id === req.params.id);
    if (!card) {
      return res.status(404).json({ ok: false, error: "Card not found" });
    }
    res.json({ ok: true, card });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Create new card
app.post("/api/card", verifyToken, verifyEditor, async (req, res) => {
  try {
    const { type, data } = req.body;
    if (!type || !['game', 'film', 'serie', 'software'].includes(type)) {
      return res.status(400).json({ ok: false, error: "Invalid card type. Must be: game, film, serie, or software" });
    }
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ ok: false, error: "Missing card data" });
    }
    
    // Validate required fields based on type
    if (type === 'game' && !data.name) {
      return res.status(400).json({ ok: false, error: "Game name is required" });
    }
    if (type === 'film' && !data.title) {
      return res.status(400).json({ ok: false, error: "Film title is required" });
    }
    if (type === 'serie' && !data.title) {
      return res.status(400).json({ ok: false, error: "Serie title is required" });
    }
    if (type === 'software' && !data.name) {
      return res.status(400).json({ ok: false, error: "Software name is required" });
    }

    const card = {
      id: generateCardId(),
      type,
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user.username
    };
    
    cardsData.push(card);
    await saveCards();
    
    res.json({ ok: true, card });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Update card
app.put("/api/card/:id", verifyToken, verifyEditor, async (req, res) => {
  try {
    const idx = cardsData.findIndex(c => c.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ ok: false, error: "Card not found" });
    }
    
    const { data } = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ ok: false, error: "Missing card data" });
    }
    
    // Keep id, type, createdAt, createdBy but update everything else
    const existing = cardsData[idx];
    cardsData[idx] = {
      ...existing,
      ...data,
      id: existing.id,
      type: existing.type,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.username
    };
    
    await saveCards();
    res.json({ ok: true, card: cardsData[idx] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Delete card
app.delete("/api/card/:id", verifyToken, verifyEditor, async (req, res) => {
  try {
    const idx = cardsData.findIndex(c => c.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ ok: false, error: "Card not found" });
    }
    
    const deleted = cardsData.splice(idx, 1)[0];
    await saveCards();
    
    res.json({ ok: true, deleted: deleted.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Search cards by name/title
app.get("/api/cards/search", verifyToken, verifyEditor, async (req, res) => {
  try {
    const { q, type } = req.query;
    if (!q) {
      return res.status(400).json({ ok: false, error: "Missing search query 'q'" });
    }
    
    const query = q.toLowerCase();
    let results = cardsData.filter(c => {
      const name = (c.name || c.title || '').toLowerCase();
      return name.includes(query);
    });
    
    if (type) {
      results = results.filter(c => c.type === type);
    }
    
    res.json({ ok: true, cards: results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// === CHECK AUTH STATUS ===
app.get("/api/auth/check", verifyToken, (req, res) => {
  res.json({ ok: true, username: req.user.username, role: req.user.role });
});

// === LIST ALL POSTS (PROTECTED) ===
app.get("/api/posts", verifyToken, verifyEditor, async (req, res) => {
  try {
    const files = await fsp.readdir(BLOG_CONTENT_DIR);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    const posts = [];
    for (const f of mdFiles) {
      const p = path.join(BLOG_CONTENT_DIR, f);
      const txt = await fsp.readFile(p, 'utf8');
      const { data } = parseFrontmatter(txt);
      const slug = data.slug || f.replace(/\.md$/, '');
      posts.push({
        slug,
        title: data.title || slug,
        pubDate: data.pubDate || null,
        tags: data.tags || [],
        draft: !!data.draft,
        cover: data.cover || null,
        youtube: data.youtube || null,
        category: data.category || null,
        views: viewsData[slug] || 0,
      });
    }
    res.json({ ok: true, posts });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// === GET SINGLE POST (for editing) ===
app.get("/api/post/:slug", verifyToken, verifyEditor, async (req, res) => {
  try {
    const slug = req.params.slug;
    const p = path.join(BLOG_CONTENT_DIR, `${slug}.md`);
    const txt = await fsp.readFile(p, 'utf8');
    const { data, content } = parseFrontmatter(txt);
    res.json({ ok: true, post: { ...data, slug, content, views: viewsData[slug] || 0 } });
  } catch (e) {
    if (e.code === 'ENOENT') {
      return res.status(404).json({ ok: false, error: 'Post not found' });
    }
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// === DELETE POST ===
app.delete("/api/post/:slug", verifyToken, verifyEditor, async (req, res) => {
  try {
    const slug = req.params.slug;
    const p = path.join(BLOG_CONTENT_DIR, `${slug}.md`);
    await fsp.unlink(p);
    // also remove views data
    delete viewsData[slug];
    await saveViews();
    res.json({ ok: true, deleted: slug });
  } catch (e) {
    if (e.code === 'ENOENT') {
      return res.status(404).json({ ok: false, error: 'Post not found' });
    }
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// === INCREMENT VIEW COUNT (can be called from public site) ===
app.post("/api/view/:slug", async (req, res) => {
  try {
    const slug = req.params.slug;
    viewsData[slug] = (viewsData[slug] || 0) + 1;
    await saveViews();
    res.json({ ok: true, views: viewsData[slug] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ============================================================
// CONTACT FORM (public endpoint - no auth required)
// ============================================================
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "danypetit.be@gmail.com";
const CONTACT_FILE = path.join(__dirname, "data", "contact_messages.json");

async function loadContactMessages() {
  try {
    const data = await fsp.readFile(CONTACT_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveContactMessages(messages) {
  await fsp.writeFile(CONTACT_FILE, JSON.stringify(messages, null, 2));
}

// Rate limiting for contact form (simple in-memory)
const contactRateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 3; // 3 messages per hour per IP

app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    
    // Validation
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ ok: false, error: "Tous les champs sont requis" });
    }
    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: "Email invalide" });
    }
    
    if (message.length > 5000) {
      return res.status(400).json({ ok: false, error: "Message trop long (max 5000 caractères)" });
    }
    
    // Simple rate limiting by IP
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = contactRateLimit.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    
    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + RATE_LIMIT_WINDOW;
    }
    
    if (record.count >= RATE_LIMIT_MAX) {
      return res.status(429).json({ ok: false, error: "Trop de messages envoyés. Réessaie plus tard." });
    }
    
    record.count++;
    contactRateLimit.set(ip, record);
    
    // Save message to file
    const messages = await loadContactMessages();
    const newMessage = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name: name.trim().slice(0, 100),
      email: email.trim().slice(0, 200),
      subject: subject.trim().slice(0, 200),
      message: message.trim().slice(0, 5000),
      ip,
      createdAt: new Date().toISOString(),
      read: false
    };
    messages.push(newMessage);
    await saveContactMessages(messages);
    
    console.log(`[CONTACT] New message from ${email}: ${subject}`);
    
    res.json({ ok: true, message: "Message envoyé avec succès !" });
  } catch (e) {
    console.error("[CONTACT] Error:", e);
    res.status(500).json({ ok: false, error: "Erreur lors de l'envoi du message" });
  }
});

// Admin endpoint to view contact messages
app.get("/api/contact/messages", verifyToken, verifyEditor, async (req, res) => {
  try {
    const messages = await loadContactMessages();
    res.json({ ok: true, messages: messages.reverse() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Admin endpoint to delete a contact message
app.delete("/api/contact/:id", verifyToken, verifyEditor, async (req, res) => {
  try {
    const { id } = req.params;
    const messages = await loadContactMessages();
    const idx = messages.findIndex(m => m.id === id);
    if (idx === -1) return res.status(404).json({ ok: false, error: "Message non trouvé" });
    messages.splice(idx, 1);
    await saveContactMessages(messages);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Admin endpoint to mark message as read
app.put("/api/contact/:id/read", verifyToken, verifyEditor, async (req, res) => {
  try {
    const { id } = req.params;
    const messages = await loadContactMessages();
    const msg = messages.find(m => m.id === id);
    if (!msg) return res.status(404).json({ ok: false, error: "Message non trouvé" });
    msg.read = true;
    await saveContactMessages(messages);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ===========================================
// === PARTNERS API (Kinguin, etc.) ===
// ===========================================

async function loadPartners() {
  try {
    const data = await fsp.readFile(PARTNERS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return { kinguin: { enabled: false, apiKey: "", affiliateId: "", displayInFooter: true } };
  }
}

async function savePartners(partners) {
  await fsp.writeFile(PARTNERS_FILE, JSON.stringify(partners, null, 2), "utf-8");
}

// Get partners config (admin only)
app.get("/api/partners", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const partners = await loadPartners();
    // Mask API keys for security (show only last 4 chars)
    const masked = JSON.parse(JSON.stringify(partners));
    if (masked.kinguin?.apiKey) {
      const key = masked.kinguin.apiKey;
      masked.kinguin.apiKey = key.length > 4 ? '•'.repeat(key.length - 4) + key.slice(-4) : key;
    }
    res.json({ ok: true, partners: masked });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Update partners config (admin only)
app.put("/api/partners", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { kinguin } = req.body;
    const current = await loadPartners();

    if (kinguin) {
      // If API key looks masked, keep the old one
      if (kinguin.apiKey && kinguin.apiKey.includes('•')) {
        kinguin.apiKey = current.kinguin?.apiKey || '';
      }
      current.kinguin = { ...current.kinguin, ...kinguin };
    }

    await savePartners(current);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Public endpoint to get partner display info (for blog footer)
app.get("/api/partners/public", async (req, res) => {
  try {
    const partners = await loadPartners();
    res.json({
      ok: true,
      kinguin: {
        enabled: partners.kinguin?.enabled || false,
        displayInFooter: partners.kinguin?.displayInFooter || false,
        affiliateId: partners.kinguin?.affiliateId || ""
      }
    });
  } catch (e) {
    res.json({ ok: true, kinguin: { enabled: false, displayInFooter: false } });
  }
});

// Test Kinguin API connection
app.get("/api/kinguin/test", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const partners = await loadPartners();
    const { apiKey } = partners.kinguin || {};

    if (!apiKey) {
      return res.json({ ok: false, error: "Clé API non configurée" });
    }

    // Test the Kinguin API with a simple search
    const response = await fetch("https://gateway.kinguin.net/esa/api/v1/products?name=zelda&limit=1", {
      headers: {
        "X-Api-Key": apiKey,
        "Accept": "application/json"
      }
    });

    if (response.ok) {
      const data = await response.json();
      res.json({ ok: true, message: "API fonctionnelle", results: data.results?.length || 0 });
    } else {
      const errorText = await response.text();
      res.json({ ok: false, error: `Erreur API: ${response.status} - ${errorText}` });
    }
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});

// Search games on Kinguin
app.get("/api/kinguin/search", verifyToken, verifyEditor, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ ok: false, error: "Query requise" });

    const partners = await loadPartners();
    const { apiKey, affiliateId } = partners.kinguin || {};

    if (!apiKey || !partners.kinguin?.enabled) {
      return res.status(400).json({ ok: false, error: "Kinguin non configuré ou désactivé" });
    }

    const response = await fetch(`https://gateway.kinguin.net/esa/api/v1/products?name=${encodeURIComponent(query)}&limit=10&sortBy=price&sortType=asc`, {
      headers: {
        "X-Api-Key": apiKey,
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Kinguin API error: ${response.status}`);
    }

    const data = await response.json();
    const results = (data.results || []).map(p => ({
      id: p.productId,
      name: p.name,
      platform: p.platform,
      price: p.price,
      coverImage: p.coverImage,
      releaseDate: p.releaseDate,
      // Build affiliate link
      buyLink: affiliateId 
        ? `https://www.kinguin.net/category/${p.productId}?r=${affiliateId}`
        : `https://www.kinguin.net/category/${p.productId}`
    }));

    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Get Kinguin product details
app.get("/api/kinguin/product/:id", verifyToken, verifyEditor, async (req, res) => {
  try {
    const { id } = req.params;
    const partners = await loadPartners();
    const { apiKey, affiliateId } = partners.kinguin || {};

    if (!apiKey || !partners.kinguin?.enabled) {
      return res.status(400).json({ ok: false, error: "Kinguin non configuré ou désactivé" });
    }

    const response = await fetch(`https://gateway.kinguin.net/esa/api/v1/products/${id}`, {
      headers: {
        "X-Api-Key": apiKey,
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Kinguin API error: ${response.status}`);
    }

    const p = await response.json();
    const product = {
      id: p.productId,
      name: p.name,
      platform: p.platform,
      price: p.price,
      originalPrice: p.originalPrice,
      coverImage: p.coverImage,
      screenshots: p.screenshots || [],
      releaseDate: p.releaseDate,
      description: p.description,
      buyLink: affiliateId 
        ? `https://www.kinguin.net/category/${p.productId}?r=${affiliateId}`
        : `https://www.kinguin.net/category/${p.productId}`
    };

    res.json({ ok: true, product });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

async function bootstrap() {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });

  app.listen(PORT, "127.0.0.1", () => {
    console.log("blog-admin on :" + PORT);
  });
}

bootstrap().catch((err) => {
  console.error("BOOTSTRAP FAILED:", err);
  process.exit(1);
});