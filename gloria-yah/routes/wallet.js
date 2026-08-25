const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { verifyKkiapayTransaction } = require('../services/kkiapay');

const router = express.Router();

// GET /api/v1/wallet/:user_id
router.get('/:user_id', requireAuth, async (req, res) => {
  const walletResult = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [req.params.user_id]);
  const wallet = walletResult.rows[0];
  if (!wallet) return res.status(404).json({ error: 'Wallet introuvable' });

  const txResult = await pool.query(
    `SELECT type, amount, gateway, reference, created_at
     FROM wallet_transactions WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [wallet.id]
  );

  res.json({ ...wallet, recent_transactions: txResult.rows });
});

// POST /api/v1/wallet/topup/init
// Étape 1 : le frontend appelle cette route pour récupérer ce dont il a besoin pour
// ouvrir le widget de paiement Kkiapay côté client. Aucune écriture en base ici —
// on ne fait QUE préparer le paiement, jamais créditer.
router.post('/topup/init', requireAuth, async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount invalide' });

  res.json({
    public_key: process.env.KKIAPAY_PUBLIC_KEY,
    sandbox: process.env.KKIAPAY_SANDBOX === 'true',
    amount,
    // Le frontend utilise ces infos pour ouvrir openKkiapayWidget({...}) et récupère
    // un transactionId dans le callback "success" — ce transactionId est ensuite
    // envoyé à /topup/verify ci-dessous, jamais fait confiance tel quel.
  });
});

// POST /api/v1/wallet/topup/verify
// Étape 2 (LA SEULE qui crédite réellement le wallet) : on reçoit le transactionId
// renvoyé par le widget Kkiapay, et on rappelle Kkiapay DEPUIS LE SERVEUR pour
// confirmer que l'argent est bien arrivé, avant toute écriture en base.
router.post('/topup/verify', requireAuth, async (req, res) => {
  const { user_id, transaction_id } = req.body;
  if (!user_id || !transaction_id) {
    return res.status(400).json({ error: 'user_id et transaction_id sont requis' });
  }

  const walletResult = await pool.query('SELECT id, balance FROM wallets WHERE user_id = $1', [user_id]);
  const wallet = walletResult.rows[0];
  if (!wallet) return res.status(404).json({ error: 'Wallet introuvable' });

  // Idempotence : si cette transaction a déjà été traitée (retry réseau, double-clic),
  // on renvoie le résultat existant au lieu de créditer une deuxième fois.
  const existing = await pool.query(
    `SELECT id, type, amount, gateway, created_at FROM wallet_transactions WHERE reference = $1`,
    [transaction_id]
  );
  if (existing.rows[0]) {
    return res.json({ already_processed: true, transaction: existing.rows[0] });
  }

  let verification;
  try {
    verification = await verifyKkiapayTransaction(transaction_id);
  } catch (err) {
    console.error('Échec de vérification Kkiapay :', err.message);
    return res.status(502).json({ error: 'Impossible de vérifier la transaction auprès de Kkiapay. Aucun crédit effectué.' });
  }

  if (!verification.success) {
    return res.status(402).json({ error: 'Transaction non confirmée par Kkiapay. Aucun crédit effectué.', details: verification.raw });
  }

  // Sécurité supplémentaire : le montant réellement payé (renvoyé par Kkiapay) fait foi,
  // jamais un montant fourni par le frontend.
  const amount = Number(verification.amount);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE wallets SET
         balance = balance + $2,
         is_blocked = (balance + $2 <= negative_floor), -- débloque si le nouveau solde repasse au-dessus du plafond
         updated_at = now()
       WHERE id = $1`,
      [wallet.id, amount]
    );
    const txResult = await client.query(
      `INSERT INTO wallet_transactions (wallet_id, type, amount, gateway, reference)
       VALUES ($1, 'TOPUP', $2, 'KKIAPAY', $3)
       RETURNING id, type, amount, gateway, created_at`,
      [wallet.id, amount, transaction_id]
    );
    await client.query('COMMIT');
    res.json(txResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      // Un appel concurrent a créé la même référence entre-temps — pas une erreur réelle.
      const dup = await pool.query(`SELECT id, type, amount, gateway, created_at FROM wallet_transactions WHERE reference = $1`, [transaction_id]);
      return res.json({ already_processed: true, transaction: dup.rows[0] });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors du crédit du wallet' });
  } finally {
    client.release();
  }
});

// POST /api/v1/webhooks/kkiapay — notification asynchrone envoyée par Kkiapay elle-même
// (filet de sécurité si le frontend ne rappelle jamais /topup/verify, ex. app fermée
// juste après paiement). Réutilise exactement la même logique de vérification.
router.post('/webhooks/kkiapay', async (req, res) => {
  const transactionId = req.body.transactionId || req.body.data?.transactionId;
  if (!transactionId) return res.status(400).json({ error: 'transactionId manquant dans le webhook' });

  // NOTE PRODUCTION : Kkiapay signe ses webhooks — vérifier la signature ici
  // (voir doc officielle) avant de faire confiance au contenu du payload.

  try {
    const verification = await verifyKkiapayTransaction(transactionId);
    if (!verification.success) return res.status(200).json({ ignored: true }); // on accuse réception sans créditer

    // Le user_id doit être retrouvé via vos propres métadonnées de transaction
    // (Kkiapay permet de passer des données custom à la création du paiement) —
    // non implémenté ici faute de connaître le format exact que vous choisirez.
    res.status(200).json({ received: true, note: 'Webhook reçu — association transactionId -> user_id à implémenter.' });
  } catch (err) {
    console.error('Erreur webhook Kkiapay :', err.message);
    res.status(500).json({ error: 'Erreur de traitement du webhook' });
  }
});

module.exports = router;
