-- ⚠️ TARIFS DE DÉPART, PAS ENCORE CALIBRÉS AVEC L'UTILISATEUR ⚠️
-- Contrairement à la gamme Moto (recalibrée le 25/08 sur des points cibles
-- donnés explicitement), ces tarifs de livraison sont des valeurs de départ
-- raisonnables dérivées par simple proportion avec les gammes course
-- existantes (LIVRAISON_MOTO calée sur les ratios pays de MOTO, LIVRAISON_VOITURE
-- sur les ratios pays d'ESSENTIEL). À AJUSTER avant tout lancement public —
-- voir le chat pour la méthode de calcul utilisée.

INSERT INTO fare_rules (country_id, service_tier, base_fee, city_radius_km, cost_per_km_city, cost_per_km_suburb, cost_per_min, minimum_fare, commission_rate, included_km) VALUES
('BJ', 'LIVRAISON_MOTO', 100, 15, 50, 110, 0, 100, 0.05, 2),
('SN', 'LIVRAISON_MOTO', 160, 15, 80, 175, 0, 160, 0.05, 2),
('TG', 'LIVRAISON_MOTO', 320, 15, 160, 350, 0, 320, 0.05, 2),
('CI', 'LIVRAISON_MOTO', 100, 15, 50, 110, 0, 100, 0.05, 2),
('NE', 'LIVRAISON_MOTO', 100, 15, 50, 110, 0, 100, 0.05, 2),
('ML', 'LIVRAISON_MOTO', 100, 15, 50, 110, 0, 100, 0.05, 2),
('BF', 'LIVRAISON_MOTO', 100, 15, 50, 110, 0, 100, 0.05, 2),
('GW', 'LIVRAISON_MOTO', 100, 15, 50, 110, 0, 100, 0.05, 2),

('BJ', 'LIVRAISON_VOITURE', 300, 15, 60, 120, 10, 500, 0.08, 2),
('SN', 'LIVRAISON_VOITURE', 480, 15, 95, 190, 15, 800, 0.08, 2),
('TG', 'LIVRAISON_VOITURE', 960, 15, 190, 385, 30, 1600, 0.08, 2),
('CI', 'LIVRAISON_VOITURE', 300, 15, 60, 120, 10, 500, 0.08, 2),
('NE', 'LIVRAISON_VOITURE', 300, 15, 60, 120, 10, 500, 0.08, 2),
('ML', 'LIVRAISON_VOITURE', 300, 15, 60, 120, 10, 500, 0.08, 2),
('BF', 'LIVRAISON_VOITURE', 300, 15, 60, 120, 10, 500, 0.08, 2),
('GW', 'LIVRAISON_VOITURE', 300, 15, 60, 120, 10, 500, 0.08, 2);
