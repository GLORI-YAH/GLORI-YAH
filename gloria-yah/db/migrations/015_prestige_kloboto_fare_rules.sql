-- ⚠️ TARIFS DE DÉPART, PAS ENCORE CALIBRÉS AVEC L'UTILISATEUR ⚠️
-- Même logique que pour la Livraison (013) : valeurs de départ raisonnables,
-- PRESTIGE calée proportionnellement sur les ratios pays de SIGNATURE (même
-- économie : véhicule premium), KLOBOTO calée sur les ratios pays de MOTO
-- (même économie : deux/trois-roues). À AJUSTER avant tout lancement public.

INSERT INTO fare_rules (country_id, service_tier, base_fee, city_radius_km, cost_per_km_city, cost_per_km_suburb, cost_per_min, minimum_fare, commission_rate, included_km) VALUES
('BJ', 'PRESTIGE', 900, 15, 110, 250, 45, 2200, 0.08, 2),
('SN', 'PRESTIGE', 1425, 15, 175, 400, 70, 3500, 0.08, 2),
('TG', 'PRESTIGE', 2850, 15, 350, 800, 140, 7000, 0.08, 2),
('CI', 'PRESTIGE', 900, 15, 110, 250, 45, 2200, 0.08, 2),
('NE', 'PRESTIGE', 900, 15, 110, 250, 45, 2200, 0.08, 2),
('ML', 'PRESTIGE', 900, 15, 110, 250, 45, 2200, 0.08, 2),
('BF', 'PRESTIGE', 900, 15, 110, 250, 45, 2200, 0.08, 2),
('GW', 'PRESTIGE', 900, 15, 110, 250, 45, 2200, 0.08, 2),

('BJ', 'KLOBOTO', 150, 15, 60, 130, 5, 150, 0.06, 2),
('SN', 'KLOBOTO', 235, 15, 95, 205, 8, 235, 0.06, 2),
('TG', 'KLOBOTO', 470, 15, 190, 410, 15, 470, 0.06, 2),
('CI', 'KLOBOTO', 150, 15, 60, 130, 5, 150, 0.06, 2),
('NE', 'KLOBOTO', 150, 15, 60, 130, 5, 150, 0.06, 2),
('ML', 'KLOBOTO', 150, 15, 60, 130, 5, 150, 0.06, 2),
('BF', 'KLOBOTO', 150, 15, 60, 130, 5, 150, 0.06, 2),
('GW', 'KLOBOTO', 150, 15, 60, 130, 5, 150, 0.06, 2);
