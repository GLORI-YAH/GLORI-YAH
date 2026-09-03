-- Protection contre une fraude connue dans les VTC : un pilote arrive chez le
-- passager puis lui demande d'annuler la commande sur l'appli pour payer
-- directement en espèces (hors plateforme) — le pilote évite ainsi la
-- commission GLORI-YAH. Demande explicite de l'utilisateur (02/09/2026) :
-- "tu dois trouver le moyen d'empêcher tout ça".
--
-- Principe : la raison d'annulation devient obligatoire pour le passager,
-- avec une option qui nomme précisément ce comportement. Si un pilote
-- accumule plusieurs signalements de ce type, il est automatiquement bloqué
-- (comme le blocage KYC déjà existant) en attendant une revue humaine —
-- suivre seulement les signalements sans conséquence réelle ne "prévient"
-- rien, il faut une vraie sanction automatique.

ALTER TABLE rides ADD COLUMN cancellation_reason VARCHAR(50);
ALTER TABLE rides ADD COLUMN cancelled_by UUID REFERENCES users(id);

-- Permet à un admin de "blanchir" un pilote après revue humaine (les
-- signalements antérieurs à cette date ne comptent plus dans le blocage
-- automatique) — sans jamais supprimer l'historique réel des signalements.
ALTER TABLE users ADD COLUMN fraud_flags_cleared_at TIMESTAMPTZ;
