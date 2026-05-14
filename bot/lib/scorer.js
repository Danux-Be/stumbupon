/**
 * Calcule un score de qualité (0–100) pour un site candidat.
 * Plus le score est élevé, meilleure est la qualité perçue.
 * Seuil d'approbation automatique : >= 70.
 */
function scoreCandidate({ url, enriched, sourceScore = 0, categoryCount = 0 }) {
  let score = 30; // base neutre

  const { title, language, riskScore } = enriched;

  // HTTPS
  try {
    if (new URL(url).protocol === 'https:') score += 20;
  } catch { /* noop */ }

  // Titre bien formé
  if (title && title.length >= 5 && title.length <= 150) score += 15;

  // Langue supportée
  if (language && ['fr', 'en', 'nl', 'de'].includes(language)) score += 10;

  // Catégories détectées
  if (categoryCount >= 2) score += 10;
  else if (categoryCount === 1) score += 5;

  // Signal de popularité de la source (HN score normalisé, max +10)
  if (sourceScore > 0) score += Math.min(10, Math.floor(sourceScore / 100));

  // Pénalité basée sur le risk_score (riskScore élevé = mauvais signe)
  if (riskScore !== undefined) {
    score -= Math.floor(riskScore / 10);
  }

  return Math.max(0, Math.min(100, score));
}

module.exports = { scoreCandidate };
