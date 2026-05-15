#!/usr/bin/env bash
# Lancement périodique du bot de découverte — appelé par cron toutes les 2h
set -euo pipefail

cd /srv/web/stumbleclone
/usr/bin/node bot/index.js --source=all --limit=30 --seeds=5
