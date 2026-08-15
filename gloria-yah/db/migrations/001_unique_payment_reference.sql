-- Empêche qu'une même transaction de paiement (Kkiapay/FedaPay) crédite le wallet deux fois,
-- même si /wallet/topup/verify est appelé plusieurs fois (double-clic, retry réseau, etc.)
-- "reference" stocke l'identifiant de transaction du fournisseur de paiement (ex. Kkiapay transactionId).

CREATE UNIQUE INDEX IF NOT EXISTS uniq_wallet_txn_reference
  ON wallet_transactions (reference)
  WHERE reference IS NOT NULL AND type = 'TOPUP';
