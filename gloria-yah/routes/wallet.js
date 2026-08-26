const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { verifyKkiapayTransaction } = require('../services/kkiapay');
const { verifyFedaPayTransaction } = require('../services/fedapay');

const router = express.Router();

// Pays où Kkiapay est confirmé disponible (Bénin, Togo, Côte d'Ivoire, Sénégal).
// Niger : sources contradictoires sur la couverture Kkiapay — laissé en FedaPay
// seul pour l'instant, à revérifier avant d'ajouter Kkiapay là-bas aussi.
const KKIAPAY_COUNTRIES = ['BJ', 'TG', 'CI', 'SN'];

function availableGateways(countryId) {
  return KKIAPAY_COUNTRIES.includes(countryId) ? ['KKIAPAY', 'FEDAPAY'] : ['FEDAPAY'];
}

// GET /api/v1/wallet/gateways/:country_id — quelles passerelles proposer pour ce pays
router.get('/gateways/:country_id', (req, res) => {
  res.json({ gateways: availableGateways(req.params.country_id) });
});

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
// Étape 1 : prépare le paiement — choisit automatiquement Kkiapay (Bénin) ou
// FedaPay (autres pays) selon le pays du chauffeur. Aucune écriture en base ici.
router.post('/topup/init', requireAuth, async (req, res) => {
  const { amount, country_id, gateway } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount invalide' });

  const allowed = availableGateways(country_id || 'BJ');
  const chosenGateway = gateway || allowed[0]; // par défaut, la première proposée pour ce pays

  if (!allowed.includes(chosenGateway)) {
    return res.status(400).json({ error: `${chosenGateway} n'est pas disponible pour ce pays. Options : ${allowed.join(', ')}` });
  }

  if (chosenGateway === 'KKIAPAY') {
    return res.json({
      gateway: 'KKIAPAY',
      public_key: process.env.KKIAPAY_PUBLIC_KEY,
      sandbox: process.env.KKIAPAY_SANDBOX === 'true',
      amount,
    });
  }

  // FedaPay : la transaction doit être créée côté serveur avant d'ouvrir le
  // widget (contrairement à Kkiapay qui l'initie côté client).
  try {
    const baseUrl = process.env.FEDAPAY_ENV === 'live'
      ? 'https://api.fedapay.com/v1'
      : 'https://sandbox-api.fedapay.com/v1';

    const response = await fetch(`${baseUrl}/transactions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.FEDAPAY_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: 'Recharge wallet GLORI-YAH',
        amount,
        currency: { iso: 'XOF' },
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`FedaPay a répondu ${response.status} : ${text}`);
    }

    const data = await response.json();
    const transaction = data.transaction || data['v1/transaction'] || data;

    res.json({
      gateway: 'FEDAPAY',
      transaction_id: transaction.id,
      payment_url: transaction.payment_url || transaction['payment_url'],
      amount,
    });
  } catch (err) {
    console.error('Échec de création de transaction FedaPay :', err.message);
    res.status(502).json({ error: 'Impossible de préparer le paiement FedaPay. Réessaie ou contacte le support.' });
  }
});

// POST /api/v1/wallet/topup/verify
// Étape 2 (LA SEULE qui crédite réellement le wallet) : reçoit le transactionId
// et la passerelle utilisée, revérifie DEPUIS LE SERVEUR avant tout crédit.
router.post('/topup/verify', requireAuth, async (req, res) => {
  const { user_id, transaction_id, gateway } = req.body;
  if (!user_id || !transaction_id || !gateway) {
    return res.status(400).json({ error: 'user_id, transaction_id et gateway sont requis' });
  }
  if (!['KKIAPAY', 'FEDAPAY'].includes(gateway)) {
    return res.status(400).json({ error: 'gateway doit être KKIAPAY ou FEDAPAY' });
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
    verification = gateway === 'KKIAPAY'
      ? await verifyKkiapayTransaction(transaction_id)
      : await verifyFedaPayTransaction(transaction_id);
  } catch (err) {
    console.error(`Échec de vérification ${gateway} :`, err.message);
    return res.status(502).json({ error: `Impossible de vérifier la transaction auprès de ${gateway}. Aucun crédit effectué.` });
  }

  if (!verification.success) {
    return res.status(402).json({ error: `Transaction non confirmée par ${gateway}. Aucun crédit effectué.`, details: verification.raw });
  }

  // Sécurité supplémentaire : le montant réellement payé (renvoyé par la passerelle)
  // fait foi, jamais un montant fourni par le frontend.
  const amount = Number(verification.amount);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE wallets SET
         balance = balance + $2,
         is_blocked = (balance + $2 <= negative_floor),
         updated_at = now()
       WHERE id = $1`,
      [wallet.id, amount]
    );
    const txResult = await client.query(
      `INSERT INTO wallet_transactions (wallet_id, type, amount, gateway, reference)
       VALUES ($1, 'TOPUP', $2, $3, $4)
       RETURNING id, type, amount, gateway, created_at`,
      [wallet.id, amount, gateway, transaction_id]
    );
    await client.query('COMMIT');
    res.json(txResult.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      const dup = await pool.query(`SELECT id, type, amount, gateway, created_at FROM wallet_transactions WHERE reference = $1`, [transaction_id]);
      return res.json({ already_processed: true, transaction: dup.rows[0] });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors du crédit du wallet' });
  } finally {
    client.release();
  }
});

// POST /api/v1/webhooks/kkiapay — filet de sécurité Kkiapay
router.post('/webhooks/kkiapay', async (req, res) => {
  const transactionId = req.body.transactionId || req.body.data?.transactionId;
  if (!transactionId) return res.status(400).json({ error: 'transactionId manquant dans le webhook' });

  try {
    const verification = await verifyKkiapayTransaction(transactionId);
    if (!verification.success) return res.status(200).json({ ignored: true });
    res.status(200).json({ received: true, note: 'Webhook reçu — association transactionId -> user_id à implémenter.' });
  } catch (err) {
    console.error('Erreur webhook Kkiapay :', err.message);
    res.status(500).json({ error: 'Erreur de traitement du webhook' });
  }
});

// POST /api/v1/webhooks/fedapay — filet de sécurité FedaPay
router.post('/webhooks/fedapay', async (req, res) => {
  const transactionId = req.body.entity?.id || req.body.transaction_id;
  if (!transactionId) return res.status(400).json({ error: 'transactionId manquant dans le webhook' });

  // NOTE PRODUCTION : FedaPay signe ses webhooks — vérifier la signature ici
  // (voir doc officielle) avant de faire confiance au contenu du payload.

  try {
    const verification = await verifyFedaPayTransaction(transactionId);
    if (!verification.success) return res.status(200).json({ ignored: true });
    res.status(200).json({ received: true, note: 'Webhook reçu — association transactionId -> user_id à implémenter.' });
  } catch (err) {
    console.error('Erreur webhook FedaPay :', err.message);
    res.status(500).json({ error: 'Erreur de traitement du webhook' });
  }
});

module.exports = router;
