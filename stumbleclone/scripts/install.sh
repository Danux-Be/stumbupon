#!/usr/bin/env bash
# Script d'installation/déploiement — à exécuter avec sudo
# Usage : sudo bash /srv/web/stumbleclone/scripts/install.sh
set -euo pipefail

echo "=== 1. Service systemd ==="
cp /srv/web/stumbleclone/scripts/stumble.service /etc/systemd/system/stumble.service
systemctl daemon-reload
systemctl enable stumble
systemctl restart stumble
echo "✅ stumble.service actif"
systemctl status stumble --no-pager

echo ""
echo "=== 2. Cron — sauvegarde quotidienne à 2h ==="
CRON_LINE="0 2 * * * /srv/web/stumbleclone/scripts/backup.sh >> /var/log/stumble-backup.log 2>&1"
CRONTAB_FILE="/etc/cron.d/stumble-backup"
echo "# Sauvegarde quotidienne de stumble.db" > "$CRONTAB_FILE"
echo "$CRON_LINE" >> "$CRONTAB_FILE"
chmod 644 "$CRONTAB_FILE"
echo "✅ Cron sauvegarde installé dans $CRONTAB_FILE"

echo ""
echo "=== 2b. Cron — bot de découverte à 8h et 15h ==="
mkdir -p /srv/web/stumbleclone/logs
chmod +x /srv/web/stumbleclone/scripts/bot-run.sh
(crontab -u dany -l 2>/dev/null | grep -v stumble-bot; \
 echo "# Bot StumbleClone — 8h et 15h"; \
 echo "0 8  * * * /srv/web/stumbleclone/scripts/bot-run.sh >> /srv/web/stumbleclone/logs/bot.log 2>&1"; \
 echo "0 15 * * * /srv/web/stumbleclone/scripts/bot-run.sh >> /srv/web/stumbleclone/logs/bot.log 2>&1") | crontab -u dany -
echo "✅ Cron bot installé (crontab dany)"

echo ""
echo "=== 3. Caddy — bloc stumble.danux.be ==="
CADDYFILE="/etc/caddy/Caddyfile"
# Remplace le bloc minimal par une version avec headers, compression et logs
python3 - "$CADDYFILE" <<'PYEOF'
import sys, re

path = sys.argv[1]
with open(path) as f:
    content = f.read()

old = """stumble.danux.be {
\treverse_proxy 127.0.0.1:4000
}"""

new = """stumble.danux.be {
\tencode gzip zstd
\theader {
\t\tX-Content-Type-Options "nosniff"
\t\tX-Frame-Options "SAMEORIGIN"
\t\tReferrer-Policy "strict-origin-when-cross-origin"
\t\tStrict-Transport-Security "max-age=31536000; includeSubDomains"
\t\t-Server
\t}
\t@static path *.css *.js *.woff *.woff2 *.ico *.svg *.png *.jpg *.webp
\theader @static Cache-Control "public, max-age=31536000, immutable"
\tlog {
\t\toutput file /var/log/caddy/stumble-access.log
\t\tformat json
\t}
\treverse_proxy 127.0.0.1:4000
}"""

if old in content:
    content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)
    print("✅ Bloc stumble.danux.be mis à jour")
else:
    print("⚠️  Bloc non trouvé tel quel — vérifie manuellement le Caddyfile")
PYEOF

caddy validate --config "$CADDYFILE" && systemctl reload caddy && echo "✅ Caddy rechargé" || echo "⚠️  Erreur Caddy — config non appliquée"

echo ""
echo "=== 4. SESSION_SECRET ==="
echo "⚠️  Pense à remplacer SESSION_SECRET dans /srv/web/stumbleclone/.env :"
echo "   node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""

echo ""
echo "🎉 Installation terminée !"
