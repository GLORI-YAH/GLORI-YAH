// Client minimal pour la vérification côté serveur des transactions FedaPay
// (Togo, Côte d'Ivoire, Sénégal, Niger — zone FCFA hors Bénin).
//
// ⚠️ IMPORTANT : vérifier l'URL et le format exacts sur https://docs.fedapay.com
// avant mise en production — les API de paiement changent parfois leurs contrats.
//
// Même principe non négociable que pour Kkiapay : on ne crédite JAMAIS un wallet
// sur la seule foi du frontend — on revérifie toujours depuis le serveur.

async function verifyFedaPayTransaction(transactionId) {
  if (!transactionId) throw new Error('transactionId manquant');

  const baseUrl = process.env.FEDAPAY_ENV === 'live'
    ? 'https://api.fedapay.com/v1'
    : 'https://sandbox-api.fedapay.com/v1';

  const response = await fetch(`${baseUrl}/transactions/${transactionId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${process.env.FEDAPAY_SECRET_KEY}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`FedaPay a répondu ${response.status} : ${text}`);
  }

  const data = await response.json();
  const transaction = data.transaction || data['v1/transaction'] || data;

  // FedaPay utilise le statut "approved" pour une transaction confirmée —
  // à revérifier dans leur doc actuelle, les noms de statuts évoluent parfois.
  const isSuccess = transaction.status === 'approved';

  return {
    success: isSuccess,
    amount: transaction.amount,
    transactionId: transaction.id || transactionId,
    raw: transaction,
  };
}

module.exports = { verifyFedaPayTransaction };
