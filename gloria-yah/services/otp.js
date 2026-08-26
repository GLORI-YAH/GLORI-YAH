// Vérification par code SMS — comme Gozem/Yango : plus besoin de mot de passe,
// juste le numéro de téléphone + un code reçu par SMS.
//
// ⚠️ Nécessite un compte Twilio (https://twilio.com) — compte d'essai gratuit
// (100 SMS offerts), envoie de vrais SMS immédiatement (contrairement à Africa's
// Talking dont le SMS "Sandbox" est documenté "bientôt disponible" au 25/08/2026).
// LIMITE DE L'ESSAI : seuls les numéros "vérifiés" dans la console Twilio peuvent
// recevoir un SMS tant que le compte n'est pas passé en payant — chaque numéro de
// test doit être ajouté et validé une fois dans le tableau de bord Twilio.

const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 chiffres
}

/**
 * Envoie un code de vérification par SMS au numéro donné, et l'enregistre
 * (hashé, jamais en clair) en base pour vérification ultérieure.
 */
async function sendOtp(phoneNumber) {
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await pool.query(
    `INSERT INTO otp_verifications (phone_number, code_hash, expires_at) VALUES ($1, $2, $3)`,
    [phoneNumber, codeHash, expiresAt]
  );

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.warn(`[OTP] Identifiants Twilio manquants — code généré mais NON envoyé par SMS : ${code} (visible uniquement dans les logs serveur, pour test local)`);
    return {
      sent: false,
      reason: 'Passerelle SMS non configurée (TWILIO_ACCOUNT_SID/AUTH_TOKEN manquants)',
      dev_code: code, // ⚠️ UNIQUEMENT en mode dégradé sans passerelle réelle — jamais exposé si Twilio est configuré
    };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      To: phoneNumber,
      From: process.env.TWILIO_PHONE_NUMBER,
      Body: `Votre code GLORI-YAH : ${code} (valide ${OTP_EXPIRY_MINUTES} minutes)`,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Échec d'envoi SMS Twilio : ${response.status} ${text}`);
  }

  return { sent: true };
}

/**
 * Vérifie le code fourni par l'utilisateur contre le dernier code envoyé à ce
 * numéro. Limite le nombre de tentatives pour éviter le brute-force.
 */
async function verifyOtp(phoneNumber, code) {
  const result = await pool.query(
    `SELECT id, code_hash, expires_at, verified, attempts
     FROM otp_verifications
     WHERE phone_number = $1
     ORDER BY created_at DESC LIMIT 1`,
    [phoneNumber]
  );
  const record = result.rows[0];
  if (!record) return { valid: false, reason: 'Aucun code envoyé à ce numéro' };
  if (record.verified) return { valid: false, reason: 'Ce code a déjà été utilisé' };
  if (new Date(record.expires_at) < new Date()) return { valid: false, reason: 'Code expiré, redemande-en un' };
  if (record.attempts >= OTP_MAX_ATTEMPTS) return { valid: false, reason: 'Trop de tentatives, redemande un code' };

  const match = await bcrypt.compare(code, record.code_hash);
  if (!match) {
    await pool.query(`UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = $1`, [record.id]);
    return { valid: false, reason: 'Code incorrect' };
  }

  await pool.query(`UPDATE otp_verifications SET verified = true WHERE id = $1`, [record.id]);
  return { valid: true };
}

module.exports = { sendOtp, verifyOtp };
