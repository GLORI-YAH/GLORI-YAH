-- Tarifs Prestige (4x4 haut de gamme), calculés à partir de l'écart de
-- consommation carburant réel avec Signature (30/08/2026) :
--   - Prix essence officiel Bénin : 725 FCFA/L (grille mai 2026)
--   - Signature (berline) : ~12 L/100km -> 87 FCFA/km carburant
--   - Prestige (gros 4x4) : ~16 L/100km -> 116 FCFA/km carburant
--   - Écart : ×1,33, appliqué à tous les coefficients de Signature
--   - Ajusté ensuite par l'utilisateur pour retomber sur 5100 FCFA (au lieu de
--     4904 FCFA du calcul brut) sur le trajet de référence 23 km / 20 min.
-- Propagation aux autres pays : mêmes ratios que Signature (SN ×1,583, TG
-- ×3,167, CI/NE/ML/BF/GW ×1 par rapport au Bénin).
--
-- CORRECTIF : la migration 015 a déjà créé les lignes PRESTIGE (valeurs de
-- départ), donc UPDATE ici, pas INSERT (sinon conflit avec la contrainte
-- unique country_id+service_tier).

UPDATE fare_rules SET base_fee = 825, cost_per_km_city = 104, cost_per_km_suburb = 243, cost_per_min = 49, minimum_fare = 2075
WHERE country_id = 'BJ' AND service_tier = 'PRESTIGE';

UPDATE fare_rules SET base_fee = 1306, cost_per_km_city = 165, cost_per_km_suburb = 385, cost_per_min = 78, minimum_fare = 3285
WHERE country_id = 'SN' AND service_tier = 'PRESTIGE';

UPDATE fare_rules SET base_fee = 2613, cost_per_km_city = 329, cost_per_km_suburb = 770, cost_per_min = 155, minimum_fare = 6572
WHERE country_id = 'TG' AND service_tier = 'PRESTIGE';

UPDATE fare_rules SET base_fee = 825, cost_per_km_city = 104, cost_per_km_suburb = 243, cost_per_min = 49, minimum_fare = 2075
WHERE country_id IN ('CI', 'NE', 'ML', 'BF', 'GW') AND service_tier = 'PRESTIGE';
