-- Recalibrage Essentiel (30/08/2026) — même démarche que la Moto : cible
-- donnée par l'utilisateur sur le trajet réel Abomey-Calavi → Cocotiers
-- Cotonou (23 km / 20 min), comparé à Yango Éco sur ce même trajet.
-- Ancien résultat sur ce trajet : 2100 FCFA. Cible : 2700 FCFA.
-- Facteur multiplicatif appliqué à tous les coefficients : ×1,29.
-- Contrairement à la Moto, la distinction ville/banlieue est CONSERVÉE ici
-- (l'utilisateur ne l'a demandée supprimée que pour la Moto et le Kloboto).
-- Propagation aux autres pays : mêmes ratios déjà utilisés (SN ×1.6, TG ×3.2,
-- CI/NE/ML/BF/GW ×1 par rapport au Bénin).

UPDATE fare_rules SET
  base_fee = 321, cost_per_km_city = 64, cost_per_km_suburb = 129, cost_per_min = 26, minimum_fare = 580
WHERE country_id = 'BJ' AND service_tier = 'ESSENTIEL';

UPDATE fare_rules SET
  base_fee = 514, cost_per_km_city = 102, cost_per_km_suburb = 206, cost_per_min = 42, minimum_fare = 928
WHERE country_id = 'SN' AND service_tier = 'ESSENTIEL';

UPDATE fare_rules SET
  base_fee = 1027, cost_per_km_city = 205, cost_per_km_suburb = 413, cost_per_min = 83, minimum_fare = 1856
WHERE country_id = 'TG' AND service_tier = 'ESSENTIEL';

UPDATE fare_rules SET
  base_fee = 321, cost_per_km_city = 64, cost_per_km_suburb = 129, cost_per_min = 26, minimum_fare = 580
WHERE country_id IN ('CI', 'NE', 'ML', 'BF', 'GW') AND service_tier = 'ESSENTIEL';
