const db = require('../db/database');

const stmtInsert = db.prepare(
  'INSERT INTO notifications (user_id, type, actor_id, site_id) VALUES (?, ?, ?, ?)'
);
const stmtDeleteFollow = db.prepare(
  'DELETE FROM notifications WHERE user_id=? AND type=? AND actor_id=?'
);

function createNotification(userId, type, actorId, siteId = null) {
  if (!userId || userId === actorId) return;
  if (type === 'follow') {
    // Re-follow : supprimer l'ancienne notif avant d'en créer une nouvelle
    stmtDeleteFollow.run(userId, type, actorId);
  }
  stmtInsert.run(userId, type, actorId || null, siteId || null);
}

module.exports = { createNotification };
