const db = require('../db/database');

const ACHIEVEMENTS = [
  { id: 'founder',          icon: '🏆', rarity: 'legendary' },
  { id: 'early_bird',       icon: '🐦', rarity: 'rare'      },
  { id: 'verified',         icon: '✅', rarity: 'common'    },
  { id: 'complete_profile', icon: '✨', rarity: 'common'    },
  { id: 'first_stumble',    icon: '🚀', rarity: 'common'    },
  { id: 'explorer_10',      icon: '🔍', rarity: 'common'    },
  { id: 'explorer_50',      icon: '🗺️', rarity: 'uncommon'  },
  { id: 'explorer_200',     icon: '🌍', rarity: 'rare'      },
  { id: 'explorer_1000',    icon: '⭐', rarity: 'legendary' },
  { id: 'first_comment',    icon: '💬', rarity: 'common'    },
  { id: 'commenter_10',     icon: '🗣️', rarity: 'uncommon'  },
  { id: 'first_submission', icon: '📤', rarity: 'common'    },
  { id: 'submitter_5',      icon: '🤝', rarity: 'uncommon'  },
  { id: 'voted_1',          icon: '🌟', rarity: 'common'    },
  { id: 'voted_10',         icon: '💫', rarity: 'uncommon'  },
  { id: 'voted_50',         icon: '🔥', rarity: 'rare'      },
  { id: 'voted_100',        icon: '👑', rarity: 'legendary' },
  { id: 'shared_1',         icon: '🔗', rarity: 'common'    },
  { id: 'shared_10',        icon: '📣', rarity: 'uncommon'  },
];

const stmtUser      = db.prepare('SELECT id, email_verified, avatar FROM users WHERE id = ?');
const stmtViews     = db.prepare('SELECT COUNT(*) AS n FROM views WHERE user_id = ?');
const stmtComments  = db.prepare('SELECT COUNT(*) AS n FROM comments WHERE user_id = ?');
const stmtSubs      = db.prepare('SELECT COUNT(*) AS n FROM sites WHERE submitted_by = ?');
const stmtApproved  = db.prepare("SELECT COUNT(*) AS n FROM sites WHERE submitted_by = ? AND status = 'approved'");
const stmtInterests = db.prepare('SELECT COUNT(*) AS n FROM user_interests WHERE user_id = ?');
const stmtShares    = db.prepare('SELECT COALESCE(shares_count, 0) AS n FROM users WHERE id = ?');
const stmtUpvotes   = db.prepare(`
  SELECT COALESCE(SUM(v.direction), 0) AS n
  FROM votes v
  JOIN sites s ON s.id = v.site_id
  WHERE s.submitted_by = ? AND v.direction = 1
`);
const stmtEarned    = db.prepare('SELECT achievement_id FROM user_achievements WHERE user_id = ?');
const stmtEarnedAll = db.prepare('SELECT achievement_id, earned_at FROM user_achievements WHERE user_id = ?');
const stmtInsert    = db.prepare(
  'INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, earned_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
);

function getUserStats(userId) {
  const user = stmtUser.get(userId);
  return {
    userId,
    emailVerified:    !!user?.email_verified,
    hasAvatar:        !!user?.avatar,
    viewsCount:       stmtViews.get(userId).n,
    commentsCount:    stmtComments.get(userId).n,
    submissionsCount: stmtSubs.get(userId).n,
    approvedCount:    stmtApproved.get(userId).n,
    interestsCount:   stmtInterests.get(userId).n,
    upvotesReceived:  stmtUpvotes.get(userId).n,
    sharesCount:      stmtShares.get(userId)?.n || 0,
  };
}

function meetsCondition(id, s) {
  switch (id) {
    case 'founder':          return s.userId <= 100;
    case 'early_bird':       return s.userId > 100 && s.userId <= 500;
    case 'verified':         return s.emailVerified;
    case 'complete_profile': return s.hasAvatar && s.interestsCount >= 3 && s.emailVerified;
    case 'first_stumble':    return s.viewsCount >= 1;
    case 'explorer_10':      return s.viewsCount >= 10;
    case 'explorer_50':      return s.viewsCount >= 50;
    case 'explorer_200':     return s.viewsCount >= 200;
    case 'explorer_1000':    return s.viewsCount >= 1000;
    case 'first_comment':    return s.commentsCount >= 1;
    case 'commenter_10':     return s.commentsCount >= 10;
    case 'first_submission': return s.submissionsCount >= 1;
    case 'submitter_5':      return s.approvedCount >= 5;
    case 'voted_1':          return s.upvotesReceived >= 1;
    case 'voted_10':         return s.upvotesReceived >= 10;
    case 'voted_50':         return s.upvotesReceived >= 50;
    case 'voted_100':        return s.upvotesReceived >= 100;
    case 'shared_1':         return s.sharesCount >= 1;
    case 'shared_10':        return s.sharesCount >= 10;
    default:                 return false;
  }
}

function checkAndGrant(userId) {
  try {
    const stats       = getUserStats(userId);
    const alreadyHave = new Set(stmtEarned.all(userId).map(r => r.achievement_id));
    const newlyEarned = [];
    for (const ach of ACHIEVEMENTS) {
      if (!alreadyHave.has(ach.id) && meetsCondition(ach.id, stats)) {
        stmtInsert.run(userId, ach.id);
        newlyEarned.push({ id: ach.id, icon: ach.icon, rarity: ach.rarity });
      }
    }
    return newlyEarned;
  } catch (e) {
    console.error('[achievements] checkAndGrant error:', e.message);
    return [];
  }
}

function getUserAchievements(userId) {
  const earned = new Map(
    stmtEarnedAll.all(userId).map(r => [r.achievement_id, r.earned_at])
  );
  return ACHIEVEMENTS.map(ach => ({
    ...ach,
    earned:   earned.has(ach.id),
    earnedAt: earned.get(ach.id) || null,
  }));
}

module.exports = { ACHIEVEMENTS, checkAndGrant, getUserAchievements };
