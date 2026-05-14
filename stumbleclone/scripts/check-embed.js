#!/usr/bin/env node
// Re-vérifie can_embed pour tous les sites approved avec can_embed IS NULL
// Usage : node scripts/check-embed.js [--concurrency=10] [--limit=N]
require('dotenv').config();
const db = require('../db/database');

const CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '10');
const LIMIT       = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');
const TIMEOUT_MS  = 8_000;
const UA = 'StumbleCloneBot/1.0 (embed-check)';

const updateEmbed = db.prepare('UPDATE sites SET can_embed = ? WHERE id = ?');

async function checkEmbed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    clearTimeout(timer);

    if (!res.ok) return 0;

    // Lire juste assez pour récupérer les headers (body ignoré)
    res.body?.cancel().catch(() => {});

    const xfo = res.headers.get('x-frame-options') || '';
    if (/deny|sameorigin/i.test(xfo)) return 0;

    const csp = res.headers.get('content-security-policy') || '';
    if (/frame-ancestors\s+['"]?none['"]?/i.test(csp)) return 0;
    if (/frame-ancestors/i.test(csp) && !/frame-ancestors[^;]*\*/i.test(csp)) return 0;

    return 1;
  } catch {
    clearTimeout(timer);
    return 0;
  }
}

async function main() {
  let query = "SELECT id, url FROM sites WHERE status='approved' AND can_embed IS NULL ORDER BY id";
  if (LIMIT > 0) query += ` LIMIT ${LIMIT}`;
  const sites = db.prepare(query).all();

  if (!sites.length) {
    console.log('✅ Aucun site avec can_embed NULL — rien à faire.');
    return;
  }

  console.log(`🔍 ${sites.length} sites à vérifier (concurrence: ${CONCURRENCY})…\n`);

  let done = 0, embeddable = 0, blocked = 0;

  // Traitement par lots
  for (let i = 0; i < sites.length; i += CONCURRENCY) {
    const batch = sites.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (s) => {
      const val = await checkEmbed(s.url);
      return { id: s.id, url: s.url, val };
    }));

    for (const { id, url, val } of results) {
      updateEmbed.run(val, id);
      done++;
      if (val === 1) embeddable++;
      else blocked++;
      const pct = Math.round(done / sites.length * 100);
      process.stdout.write(`\r  ${done}/${sites.length} (${pct}%) — ✅ ${embeddable} OK  🚫 ${blocked} bloqués   `);
    }
  }

  console.log(`\n\n✅ Terminé : ${embeddable} sites embarquables, ${blocked} bloqués/inaccessibles.`);
}

main().catch(err => { console.error(err); process.exit(1); });
