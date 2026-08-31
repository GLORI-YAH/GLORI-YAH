-- Recalibrage Moto (30/08/2026), sur demande explicite de l'utilisateur après
-- comparaison avec de vrais prix Yango (captures d'écran, trajet Abomey-Calavi
-- → Cocotiers Cotonou) :
--   - Objectif : ne plus être en dessous de Yango en temps normal (pour que les
--     pilotes gagnent autant, sans jamais majorer le passager en heure de
--     pointe/weekend — l'absorption reste sur la commission, mécanisme déjà en place).
--   - Simplification demandée : UN SEUL tarif au km, ville = banlieue (le
--     carburant coûte pareil peu importe la zone) — suppression de la
--     distinction cost_per_km_city / cost_per_km_suburb pour la Moto.
--   - Deux repères cibles donnés par l'utilisateur, à partir desquels ce tarif
--     est dérivé mathématiquement (pas une simple estimation) :
--       5 km  -> ne doit pas dépasser 300 FCFA (obtenu : 297 FCFA)
--       23 km -> reste à 1456 FCFA (obtenu : 1449 FCFA, quasi identique)
--   - Propagation aux autres pays : même ratio proportionnel déjà utilisé pour
--     les précédents recalibrages Moto (SN ×1.571, TG ×3.143, CI/NE/ML/BF/GW ×1).

UPDATE fare_rules SET
  base_fee = 105, cost_per_km_city = 64, cost_per_km_suburb = 64, cost_per_min = 0, minimum_fare = 105
WHERE country_id = 'BJ' AND service_tier = 'MOTO';

UPDATE fare_rules SET
  base_fee = 165, cost_per_km_city = 100, cost_per_km_suburb = 100, cost_per_min = 0, minimum_fare = 165
WHERE country_id = 'SN' AND service_tier = 'MOTO';

UPDATE fare_rules SET
  base_fee = 330, cost_per_km_city = 200, cost_per_km_suburb = 200, cost_per_min = 0, minimum_fare = 330
WHERE country_id = 'TG' AND service_tier = 'MOTO';

UPDATE fare_rules SET
  base_fee = 105, cost_per_km_city = 64, cost_per_km_suburb = 64, cost_per_min = 0, minimum_fare = 105
WHERE country_id IN ('CI', 'NE', 'ML', 'BF', 'GW') AND service_tier = 'MOTO';
