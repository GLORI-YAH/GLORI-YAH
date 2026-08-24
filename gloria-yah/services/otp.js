// Vérification par code SMS — comme Gozem/Yango : plus besoin de mot de passe,
// juste le numéro de téléphone + un code reçu par SMS.
//
// ⚠️ Nécessite un compte Africa's Talking (https://africastalking.com) — Bénin
// confirmé dans leur couverture. Vérifier le tarif réel au moment de la mise en
// service, il dépend du volume et peut évoluer.

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

  if (!process.env.AFRICASTALKING_API_KEY) {
    // Pas de clé configurée : on ne bloque pas le développement local, mais on
    // le dit clairement plutôt que d'échouer silencieusement.
    console.warn(`[OTP] AFRICASTALKING_API_KEY manquante — code généré mais NON envoyé par SMS : ${code} (visible uniquement dans les logs serveur, pour test local)`);
    return { sent: false, reason: 'SMS gateway non configurée (AFRICASTALKING_API_KEY manquante)' };
  }

  const response = await fetch('https://api.africastalking.com/version1/messaging', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'apiKey': process.env.AFRICASTALKING_API_KEY,
    },
    body: new URLSearchParams({
      username: process.env.AFRICASTALKING_USERNAME || 'sandbox',
      to: phoneNumber,
      message: `Votre code GLORI-YAH : ${code} (valide ${OTP_EXPIRY_MINUTES} minutes)`,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Échec d'envoi SMS Africa's Talking : ${response.status} ${text}`);
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
