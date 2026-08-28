-- Recalibrage complet de la gamme Moto (25/08/2026) sur 4 points cibles donnés
-- par l'utilisateur pour le Bénin, propagé aux autres pays selon le même écart
-- proportionnel que pour Essentiel/Signature. 2 km inclus dans le forfait de
-- base (comme Yango), 0 tarif à la minute (choix de l'utilisateur), minimum de
-- course = tarif de base (couvre les 2 km inclus).

INSERT INTO fare_rules (country_id, service_tier, base_fee, city_radius_km, cost_per_km_city, cost_per_km_suburb, cost_per_min, minimum_fare, commission_rate) VALUES
('BJ', 'MOTO', 70, 15, 42, 105, 0, 70, 0.05),
('SN', 'MOTO', 110, 15, 70, 125, 0, 110, 0.05),
('TG', 'MOTO', 220, 15, 135, 335, 0, 220, 0.05),
('CI', 'MOTO', 70, 15, 42, 105, 0, 70, 0.05),
('NE', 'MOTO', 70, 15, 42, 105, 0, 70, 0.05),
('ML', 'MOTO', 70, 15, 42, 105, 0, 70, 0.05),
('BF', 'MOTO', 70, 15, 42, 105, 0, 70, 0.05),
('GW', 'MOTO', 70, 15, 42, 105, 0, 70, 0.05);

UPDATE fare_rules SET included_km = 2 WHERE service_tier = 'MOTO';
