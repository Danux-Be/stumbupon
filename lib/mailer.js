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
    fr: 'Confirmez votre adresse email — StumbleClone',
    en: 'Confirm your email address — StumbleClone',
    nl: 'Bevestig uw e-mailadres — StumbleClone',
    de: 'Bestätigen Sie Ihre E-Mail-Adresse — StumbleClone',
  };

  const bodies = {
    fr: `Bonjour ${username},\n\nCliquez sur ce lien pour vérifier votre adresse email :\n${link}\n\nCe lien expire dans 24 heures.\n\nÀ bientôt sur StumbleClone !`,
    en: `Hello ${username},\n\nClick this link to verify your email address:\n${link}\n\nThis link expires in 24 hours.\n\nSee you on StumbleClone!`,
    nl: `Hallo ${username},\n\nKlik op deze link om uw e-mailadres te bevestigen:\n${link}\n\nDeze link vervalt na 24 uur.\n\nTot ziens op StumbleClone!`,
    de: `Hallo ${username},\n\nKlicken Sie auf diesen Link, um Ihre E-Mail-Adresse zu bestätigen:\n${link}\n\nDieser Link läuft nach 24 Stunden ab.\n\nBis bald auf StumbleClone!`,
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
    fr: 'Réinitialisation de mot de passe — StumbleClone',
    en: 'Password reset — StumbleClone',
    nl: 'Wachtwoord opnieuw instellen — StumbleClone',
    de: 'Passwort zurücksetzen — StumbleClone',
  };
  const bodies = {
    fr: `Bonjour ${username},\n\nTu as demandé à réinitialiser ton mot de passe.\n\nClique sur ce lien (valable 1 heure) :\n${link}\n\nSi tu n'as pas fait cette demande, ignore cet email.\n\nÀ bientôt sur StumbleClone !`,
    en: `Hello ${username},\n\nYou requested a password reset.\n\nClick this link (valid for 1 hour):\n${link}\n\nIf you didn't request this, ignore this email.\n\nSee you on StumbleClone!`,
    nl: `Hallo ${username},\n\nJe hebt een wachtwoordreset aangevraagd.\n\nKlik op deze link (geldig 1 uur):\n${link}\n\nAls je dit niet hebt aangevraagd, negeer dan deze e-mail.\n\nTot ziens op StumbleClone!`,
    de: `Hallo ${username},\n\nDu hast eine Passwortzurücksetzung beantragt.\n\nKlicke auf diesen Link (1 Stunde gültig):\n${link}\n\nWenn du dies nicht beantragt hast, ignoriere diese E-Mail.\n\nBis bald auf StumbleClone!`,
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
    subject: `[StumbleClone] ${subject}`,
    text: `${body}\n\n—\n${baseUrl}`,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendAdminAlert };
