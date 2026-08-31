-- Ajout de 4 nouveaux pays hors zone XOF (30/08/2026), sur demande utilisateur.
-- Important : aucun de ces pays n'utilise le Franc CFA Ouest-Africain (XOF)
-- déjà en place pour BJ/TG/CI/SN/NE/ML/BF/GW :
--   - RDC (CD)       : Franc congolais (CDF)
--   - Mauritanie (MR): Ouguiya (MRU)
--   - Tchad (TD)     : Franc CFA d'Afrique CENTRALE (XAF) — banque centrale
--                      différente (BEAC) de celle de la zone XOF (BCEAO),
--                      malgré le nom "CFA" commun aux deux.
--   - Guinée (GN)    : Franc guinéen (GNF) — existait déjà en base en statut
--                      PLANNED, on l'active ici au même titre que les 3 autres.
--
-- ⚠️ AUCUNE grille tarifaire (fare_rules) n'est insérée pour ces 4 pays dans
-- cette migration — je n'ai aucune donnée réelle (prix carburant local, prix
-- concurrent local) pour calibrer des tarifs justes dans ces monnaies très
-- différentes (le risque de proposer des prix absurdes en inventant un taux
-- de conversion est trop grand). Tant qu'aucune fare_rule n'existe pour un
-- pays/gamme donné, l'API refuse proprement la course avec un message clair
-- ("Aucune grille tarifaire active") — donc rien ne casse, l'app est juste
-- indisponible dans ces pays jusqu'à calibration, comme prévu.
--
-- Statut "LAUNCHING" mis directement (sur confirmation de l'utilisateur que
-- Kkiapay/FedaPay couvrent le Mobile Money dans ces pays) — à vérifier par un
-- vrai paiement test avant tout lancement public.

INSERT INTO countries (id, name, currency_code, is_xof_zone, launch_status, default_payment_gateways) VALUES
('CD', 'RD Congo',   'CDF', false, 'LAUNCHING', ARRAY['KKIAPAY','FEDAPAY']),
('MR', 'Mauritanie', 'MRU', false, 'LAUNCHING', ARRAY['KKIAPAY','FEDAPAY']),
('TD', 'Tchad',      'XAF', false, 'LAUNCHING', ARRAY['KKIAPAY','FEDAPAY']);

UPDATE countries SET launch_status = 'LAUNCHING', default_payment_gateways = ARRAY['KKIAPAY','FEDAPAY']
WHERE id = 'GN';
