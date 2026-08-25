const pool = require('../db/pool');

const REFERRAL_MILESTONE = 150; // filleuls actifs nécessaires
const REFERRAL_REWARD_FCFA = 1500; // valeur de la course gratuite offerte au parrain

/** Génère un code de parrainage court et lisible (ex. "GY-7K2QX9") */
function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans caractères ambigus (0/O, 1/I)
  let code = 'GY-';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/**
 * Compte les filleuls "actifs" d'un utilisateur : inscrits avec son code ET
 * ayant terminé au moins une course.
 */
async function countActiveReferrals(userId) {
  const result = await pool.query(
    `SELECT COUNT(DISTINCT u.id) AS active_count
     FROM users u
     WHERE u.referred_by = $1
       AND EXISTS (SELECT 1 FROM rides r WHERE r.passenger_id = u.id AND r.status = 'COMPLETED')`,
    [userId]
  );
  return Number(result.rows[0].active_count);
}

/**
 * Vérifie si un palier de parrainage vient d'être atteint et, si oui, attribue
 * la course gratuite (crédit) au parrain. Appelé à chaque clôture de course.
 * Idempotent : ne récompense pas deux fois le même palier de 150.
 */
async function checkAndRewardReferrer(passengerId) {
  const passenger = await pool.query('SELECT referred_by FROM users WHERE id = $1', [passengerId]);
  const referrerId = passenger.rows[0]?.referred_by;
  if (!referrerId) return null; // ce passager n'a pas été parrainé, rien à faire

  const referrer = await pool.query(
    'SELECT referral_milestones_rewarded FROM users WHERE id = $1 FOR UPDATE',
    [referrerId]
  );
  const alreadyRewarded = Number(referrer.rows[0]?.referral_milestones_rewarded || 0);

  const activeCount = await countActiveReferrals(referrerId);
  const milestonesReached = Math.floor(activeCount / REFERRAL_MILESTONE);

  if (milestonesReached > alreadyRewarded) {
    const newMilestones = milestonesReached - alreadyRewarded;
    await pool.query(
      `UPDATE users SET
         free_ride_credit_fcfa = free_ride_credit_fcfa + $2,
         referral_milestones_rewarded = $3
       WHERE id = $1`,
      [referrerId, REFERRAL_REWARD_FCFA * newMilestones, milestonesReached]
    );
    return { rewarded: true, referrerId, activeCount, milestone: milestonesReached * REFERRAL_MILESTONE };
  }

  return { rewarded: false, referrerId, activeCount };
}

module.exports = { generateReferralCode, countActiveReferrals, checkAndRewardReferrer, REFERRAL_MILESTONE, REFERRAL_REWARD_FCFA };
