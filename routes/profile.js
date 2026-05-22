const express = require('express');
const db      = require('../db/database');
const { requireLogin } = require('../middleware/auth');
const { ACHIEVEMENTS } = require('../lib/achievements');

const router = express.Router();

const PER_PAGE = 20;

// ── Profil public ─────────────────────────────────────────────────────────────

const stmtUser = db.prepare(`
  SELECT id, username, avatar, language, created_at, bio,
    social_website, social_twitter, social_github, social_mastodon, social_linkedin, social_instagram
  FROM users WHERE username = ? AND is_banned = 0
`);
const stmtStats = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM views    WHERE user_id = u.id)                           AS discoveries,
    (SELECT COUNT(*) FROM sites    WHERE submitted_by = u.id AND status = 'approved') AS submissions,
    (SELECT COUNT(*) FROM comments WHERE user_id = u.id)                           AS comments,
    (SELECT COALESCE(SUM(v.direction),0) FROM votes v JOIN sites s ON s.id = v.site_id
       WHERE s.submitted_by = u.id AND v.direction = 1)                            AS upvotes
  FROM users u WHERE u.id = ?
`);
const stmtAchievements = db.prepare(
  'SELECT achievement_id, earned_at FROM user_achievements WHERE user_id = ? ORDER BY earned_at ASC'
);
const stmtSubmissions = db.prepare(`
  SELECT s.id, s.title, s.url, s.description, s.created_at,
    GROUP_CONCAT(c.emoji || ' ' || COALESCE(ct.name, c.name)) AS cats
  FROM sites s
  LEFT JOIN site_categories sc ON sc.site_id = s.id
  LEFT JOIN categories c ON c.id = sc.category_id
  LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
  WHERE s.submitted_by = ? AND s.status = 'approved'
  GROUP BY s.id
  ORDER BY s.created_at DESC
  LIMIT 9
`);

router.get('/u/:username', (req, res) => {
  const lang = res.locals.currentLang;
  const user = stmtUser.get(req.params.username);
  if (!user) {
    return res.status(404).render('profile', {
      title: req.t('profile_not_found_title'),
      notFound: true,
      profile: null,
      stats: null,
      achievements: [],
      submissions: [],
      isOwnProfile: false,
      ogTitle: 'StumbUpon.com',
      ogDescription: '',
      ogImage: null,
    });
  }

  const stats    = stmtStats.get(user.id);
  const earnedMap = new Map(stmtAchievements.all(user.id).map(r => [r.achievement_id, r.earned_at]));
  const achievements = ACHIEVEMENTS
    .filter(a => earnedMap.has(a.id))
    .map(a => ({ ...a, earnedAt: earnedMap.get(a.id) }));
  const submissions = stmtSubmissions.all(lang, user.id);

  const isOwnProfile = req.session.userId === user.id;
  const baseUrl = res.locals.baseUrl;
  const avatarUrl = user.avatar ? `${baseUrl}/avatars/${user.avatar}` : null;

  const ogTitle = req.t('profile_og_title', { username: user.username });
  const ogDesc  = req.t('profile_og_desc', {
    discoveries: stats.discoveries,
    submissions: stats.submissions,
    achievements: achievements.length,
  });

  res.render('profile', {
    title: user.username,
    notFound: false,
    profile: user,
    stats,
    achievements,
    submissions,
    isOwnProfile,
    avatarUrl,
    ogTitle,
    ogDescription: ogDesc,
    ogImage: avatarUrl || `${baseUrl}/og-image.png`,
    ogUrl: `${baseUrl}/u/${user.username}`,
    canonicalUrl: `${baseUrl}/u/${user.username}`,
    noindex: false,
  });
});

// ── Historique personnel ──────────────────────────────────────────────────────

const stmtHistoryCount = db.prepare('SELECT COUNT(*) AS n FROM views WHERE user_id = ?');
const stmtHistory = db.prepare(`
  SELECT s.id, s.title, s.url, s.description, v.viewed_at,
    GROUP_CONCAT(c.emoji || ' ' || COALESCE(ct.name, c.name)) AS cats
  FROM views v
  JOIN sites s ON s.id = v.site_id
  LEFT JOIN site_categories sc ON sc.site_id = s.id
  LEFT JOIN categories c ON c.id = sc.category_id
  LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
  WHERE v.user_id = ?
  GROUP BY s.id
  ORDER BY v.viewed_at DESC
  LIMIT ? OFFSET ?
`);

router.get('/history', requireLogin, (req, res) => {
  const userId = req.session.userId;
  const lang   = res.locals.currentLang;
  const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * PER_PAGE;

  const total      = stmtHistoryCount.get(userId).n;
  const totalPages = Math.ceil(total / PER_PAGE);
  const sites      = stmtHistory.all(lang, userId, PER_PAGE, offset);

  res.render('history', {
    title: req.t('history_title'),
    sites,
    page,
    totalPages,
    total,
  });
});

module.exports = router;
