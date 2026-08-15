// Client minimal pour la vérification côté serveur des transactions Kkiapay.
//
// ⚠️ IMPORTANT : vérifier l'URL et le format exacts sur https://docs.kkiapay.me
// avant mise en production — les API de paiement changent parfois leurs contrats.
// Ce module isole cet appel dans un seul endroit pour que ce soit facile à corriger.
//
// Principe non négociable : on ne crédite JAMAIS un wallet sur la seule foi du
// frontend ("le widget a dit que ça a marché"). On rappelle toujours Kkiapay
// depuis le serveur, avec la clé privée, pour confirmer que l'argent est bien arrivé.

async function verifyKkiapayTransaction(transactionId) {
  if (!transactionId) throw new Error('transactionId manquant');

  const url = process.env.KKIAPAY_VERIFY_URL || 'https://api.kkiapay.me/api/v1/transactions/status';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.KKIAPAY_PUBLIC_KEY,
      'x-private-key': process.env.KKIAPAY_PRIVATE_KEY,
    },
    body: JSON.stringify({ transactionId }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Kkiapay a répondu ${response.status} : ${text}`);
  }

  const data = await response.json();

  // Le champ exact peut varier selon la version de l'API Kkiapay (ex. "status" vs "state")
  // — à ajuster après vérification en sandbox. On normalise ici pour le reste du code.
  const isSuccess = data.status === 'SUCCESS' || data.state === 'SUCCESS';

  return {
    success: isSuccess,
    amount: data.amount,
    transactionId: data.transactionId || transactionId,
    raw: data, // conservé pour debug/logs, ne pas exposer tel quel au frontend
  };
}

module.exports = { verifyKkiapayTransaction };
