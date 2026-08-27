// Programme de fidélité passager — lancement pour attirer/retenir la clientèle.
//
// Règle fixée par l'utilisateur (25 août 2026) : chaque course dont le prix
// dépasse 2000 FCFA rapporte immédiatement 100 FCFA de crédit "course gratuite"
// au passager (montant fixe, peu importe si la course fait 2001F ou 10 000F).
// Ça s'additionne sans limite tant que la promotion dure — 10 grosses courses
// donnent donc naturellement 1000 FCFA de crédit cumulé.
//
// ⚠️ PROMOTION LIMITÉE DANS LE TEMPS : s'arrête après 3 mois (décision explicite
// de l'utilisateur, pour maîtriser le coût pendant que GLORI-YAH est encore une
// jeune startup). Passé cette date, plus aucun crédit fidélité n'est accordé —
// à réévaluer avec l'utilisateur avant l'échéance si la promo doit continuer.

const LOYALTY_QUALIFYING_MIN_FCFA = 2000;
const LOYALTY_REWARD_FCFA = 100;

// Date de fin fixée en dur pour que ce soit visible et facile à changer —
// 3 mois à partir du 25 août 2026 (jour de la décision).
const LOYALTY_PROGRAM_END_DATE = new Date('2026-11-25T23:59:59Z');

function isLoyaltyProgramActive() {
  return new Date() < LOYALTY_PROGRAM_END_DATE;
}

/**
 * À appeler à chaque clôture de course. Retourne le montant crédité (0 si la
 * course ne qualifie pas, ou si la promotion est terminée) — ne fait jamais
 * l'ajout en base elle-même, pour laisser l'appelant l'inclure dans sa propre
 * transaction (cohérence avec le reste de la clôture de course).
 */
function computeLoyaltyReward(ridePriceForDriver) {
  if (!isLoyaltyProgramActive()) return 0;
  if (Number(ridePriceForDriver) <= LOYALTY_QUALIFYING_MIN_FCFA) return 0;
  return LOYALTY_REWARD_FCFA;
}

module.exports = {
  computeLoyaltyReward,
  isLoyaltyProgramActive,
  LOYALTY_QUALIFYING_MIN_FCFA,
  LOYALTY_REWARD_FCFA,
  LOYALTY_PROGRAM_END_DATE,
};
