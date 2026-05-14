#!/usr/bin/env bash
# Lancement quotidien du bot de découverte — appelé par cron
set -euo pipefail

cd /srv/web/stumbleclone
/usr/bin/node bot/index.js --source=all --limit=50
