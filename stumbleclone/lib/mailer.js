const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    // Mode développement : affiche l'email dans les logs uniquement
    transporter = {
      sendMail(opts) {
        console.log('\n📧 [DEV] Email simulé :');
        console.log('  To :', opts.to);
        console.log('  Subject :', opts.subject);
        console.log('  Text :', opts.text?.slice(0, 300));
        return Promise.resolve({ messageId: 'dev-mock' });
      },
    };
  }

  return transporter;
}

async function sendVerificationEmail(to, username, token, lang = 'fr') {
  const baseUrl = process.env.BASE_URL || 'http://localhost:4000';
  const link = `${baseUrl}/verify-email/${token}`;

  const subjects = {
    fr: 'Confirmez votre adresse email — StumbUpon.com',
    en: 'Confirm your email address — StumbUpon.com',
    nl: 'Bevestig uw e-mailadres — StumbUpon.com',
    de: 'Bestätigen Sie Ihre E-Mail-Adresse — StumbUpon.com',
  };

  const bodies = {
    fr: `Bonjour ${username},\n\nCliquez sur ce lien pour vérifier votre adresse email :\n${link}\n\nCe lien expire dans 24 heures.\n\nÀ bientôt sur StumbUpon.com !`,
    en: `Hello ${username},\n\nClick this link to verify your email address:\n${link}\n\nThis link expires in 24 hours.\n\nSee you on StumbUpon.com!`,
    nl: `Hallo ${username},\n\nKlik op deze link om uw e-mailadres te bevestigen:\n${link}\n\nDeze link vervalt na 24 uur.\n\nTot ziens op StumbUpon.com!`,
    de: `Hallo ${username},\n\nKlicken Sie auf diesen Link, um Ihre E-Mail-Adresse zu bestätigen:\n${link}\n\nDieser Link läuft nach 24 Stunden ab.\n\nBis bald auf StumbUpon.com!`,
  };

  const l = subjects[lang] ? lang : 'fr';

  await getTransporter().sendMail({
    from: process.env.SMTP_FROM || 'noreply@stumbleclone.local',
    to,
    subject: subjects[l],
    text: bodies[l],
  });
}

async function sendPasswordResetEmail(to, username, token, lang = 'fr') {
  const baseUrl = process.env.BASE_URL || 'http://localhost:4000';
  const link = `${baseUrl}/reset-password/${token}`;

  const subjects = {
    fr: 'Réinitialisation de mot de passe — StumbUpon.com',
    en: 'Password reset — StumbUpon.com',
    nl: 'Wachtwoord opnieuw instellen — StumbUpon.com',
    de: 'Passwort zurücksetzen — StumbUpon.com',
  };
  const bodies = {
    fr: `Bonjour ${username},\n\nTu as demandé à réinitialiser ton mot de passe.\n\nClique sur ce lien (valable 1 heure) :\n${link}\n\nSi tu n'as pas fait cette demande, ignore cet email.\n\nÀ bientôt sur StumbUpon.com !`,
    en: `Hello ${username},\n\nYou requested a password reset.\n\nClick this link (valid for 1 hour):\n${link}\n\nIf you didn't request this, ignore this email.\n\nSee you on StumbUpon.com!`,
    nl: `Hallo ${username},\n\nJe hebt een wachtwoordreset aangevraagd.\n\nKlik op deze link (geldig 1 uur):\n${link}\n\nAls je dit niet hebt aangevraagd, negeer dan deze e-mail.\n\nTot ziens op StumbUpon.com!`,
    de: `Hallo ${username},\n\nDu hast eine Passwortzurücksetzung beantragt.\n\nKlicke auf diesen Link (1 Stunde gültig):\n${link}\n\nWenn du dies nicht beantragt hast, ignoriere diese E-Mail.\n\nBis bald auf StumbUpon.com!`,
  };

  const l = subjects[lang] ? lang : 'fr';
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM || 'noreply@stumbleclone.local',
    to,
    subject: subjects[l],
    text: bodies[l],
  });
}

async function sendAdminAlert(subject, body) {
  const to = process.env.ADMIN_EMAIL || 'dany@danux.be';
  const baseUrl = process.env.BASE_URL || 'http://localhost:4000';
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM || 'noreply@stumble.danux.be',
    to,
    subject: `[StumbUpon.com] ${subject}`,
    text: `${body}\n\n—\n${baseUrl}`,
  });
}

async function sendDigestEmail(to, username, sites, lang = 'fr', unsubUrl) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:4000';

  const subjects = {
    fr: '🌀 Tes découvertes de la semaine — StumbUpon.com',
    en: '🌀 Your weekly discoveries — StumbUpon.com',
    nl: '🌀 Jouw ontdekkingen van deze week — StumbUpon.com',
    de: '🌀 Deine Entdeckungen der Woche — StumbUpon.com',
  };
  const intros = {
    fr: `Bonjour ${username},\n\nVoici ${sites.length} site${sites.length > 1 ? 's' : ''} sélectionné${sites.length > 1 ? 's' : ''} selon tes centres d'intérêt cette semaine :`,
    en: `Hello ${username},\n\nHere are ${sites.length} site${sites.length > 1 ? 's' : ''} picked for you this week:`,
    nl: `Hallo ${username},\n\nHier zijn ${sites.length} site${sites.length > 1 ? 's' : ''} die deze week voor jou zijn geselecteerd:`,
    de: `Hallo ${username},\n\n${sites.length > 1 ? 'Hier sind' : 'Hier ist'} ${sites.length} Website${sites.length > 1 ? 's' : ''}, die diese Woche für dich ausgewählt wurde${sites.length > 1 ? 'n' : ''}:`,
  };
  const footers = {
    fr: `Bonne exploration !\n\nL'équipe StumbUpon.com\n${baseUrl}\n\n—\nPour ne plus recevoir ces emails : ${unsubUrl || baseUrl + '/settings'}`,
    en: `Happy exploring!\n\nThe StumbUpon.com team\n${baseUrl}\n\n—\nTo unsubscribe: ${unsubUrl || baseUrl + '/settings'}`,
    nl: `Veel ontdekplezier!\n\nHet StumbUpon.com-team\n${baseUrl}\n\n—\nUitschrijven: ${unsubUrl || baseUrl + '/settings'}`,
    de: `Viel Spaß beim Entdecken!\n\nDas StumbUpon.com-Team\n${baseUrl}\n\n—\nAbmelden: ${unsubUrl || baseUrl + '/settings'}`,
  };

  const l = subjects[lang] ? lang : 'fr';

  const stumbleLink = (s) => `${baseUrl}/stumble/${s.id}`;

  const siteLines = sites.map((s, i) =>
    `${i + 1}. ${s.title}\n   ${s.cats || ''}\n   ${s.description || ''}\n   ${stumbleLink(s)}`
  ).join('\n\n');

  const text = `${intros[l]}\n\n${siteLines}\n\n${footers[l]}`;

  const siteHtml = sites.map(s => `
    <div style="margin-bottom:1.5rem;padding:1rem 1.25rem;background:#f9f9f9;border-radius:8px;border-left:3px solid #5c6bc0">
      <div style="font-size:0.78rem;color:#6b7280;margin-bottom:0.3rem">${escapeHtml(s.cats || '')}</div>
      <div style="font-size:1.05rem;font-weight:700;margin-bottom:0.3rem">
        <a href="${escapeHtml(stumbleLink(s))}" style="color:#3949ab;text-decoration:none">${escapeHtml(s.title)}</a>
      </div>
      <div style="font-size:0.9rem;color:#374151;margin-bottom:0.5rem">${escapeHtml(s.description || '')}</div>
      <a href="${escapeHtml(stumbleLink(s))}" style="font-size:0.8rem;color:#5c6bc0;font-family:monospace">${escapeHtml(baseUrl)}/stumble/${s.id}</a>
    </div>`).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f5f5f3;margin:0;padding:2rem 1rem">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:2rem;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <div style="text-align:center;margin-bottom:1.75rem">
      <span style="font-size:2rem">🌀</span>
      <h1 style="font-size:1.3rem;font-weight:800;color:#18181b;margin:0.5rem 0 0">StumbUpon.com</h1>
    </div>
    <p style="color:#374151;margin-bottom:1.5rem">${escapeHtml(intros[l]).replace(/\n/g, '<br>')}</p>
    ${siteHtml}
    <hr style="border:none;border-top:1px solid #e4e4e7;margin:1.5rem 0"/>
    <p style="font-size:0.8rem;color:#9ca3af;text-align:center">
      ${l === 'fr' ? 'Bonne exploration' : l === 'en' ? 'Happy exploring' : l === 'nl' ? 'Veel plezier' : 'Viel Spaß'} !<br><br>
      <a href="${unsubUrl || baseUrl + '/settings'}" style="color:#6b7280">
        ${l === 'fr' ? 'Se désabonner' : l === 'en' ? 'Unsubscribe' : l === 'nl' ? 'Uitschrijven' : 'Abmelden'}
      </a>
    </p>
  </div>
</body></html>`;

  await getTransporter().sendMail({
    from: process.env.SMTP_FROM || 'noreply@stumble.danux.be',
    to,
    subject: subjects[l],
    text,
    html,
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendAdminAlert, sendDigestEmail };
