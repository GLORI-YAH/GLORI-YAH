-- Recalibrage Kloboto (30/08/2026) — même trajet de référence (23 km / 20 min).
-- Ancien résultat : 2070 FCFA (plus cher que Yango, à l'inverse d'Essentiel).
-- Cible donnée par l'utilisateur : 1700 FCFA.
-- Comme pour la Moto, tarif ville/banlieue unifié en un seul prix au km (même
-- logique carburant que l'utilisateur a appliquée à la Moto).
-- Propagation aux autres pays : mêmes ratios déjà utilisés pour le Kloboto
-- (SN ×1.567, TG ×3.133, CI/NE/ML/BF/GW ×1 par rapport au Bénin — voir 013).

UPDATE fare_rules SET
  base_fee = 150, cost_per_km_city = 69, cost_per_km_suburb = 69, cost_per_min = 5, minimum_fare = 150
WHERE country_id = 'BJ' AND service_tier = 'KLOBOTO';

UPDATE fare_rules SET
  base_fee = 235, cost_per_km_city = 108, cost_per_km_suburb = 108, cost_per_min = 8, minimum_fare = 235
WHERE country_id = 'SN' AND service_tier = 'KLOBOTO';

UPDATE fare_rules SET
  base_fee = 470, cost_per_km_city = 216, cost_per_km_suburb = 216, cost_per_min = 16, minimum_fare = 470
WHERE country_id = 'TG' AND service_tier = 'KLOBOTO';

UPDATE fare_rules SET
  base_fee = 150, cost_per_km_city = 69, cost_per_km_suburb = 69, cost_per_min = 5, minimum_fare = 150
WHERE country_id IN ('CI', 'NE', 'ML', 'BF', 'GW') AND service_tier = 'KLOBOTO';
