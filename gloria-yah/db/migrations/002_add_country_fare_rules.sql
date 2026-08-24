-- Ajoute les grilles tarifaires des nouveaux pays sans toucher aux tables existantes.
-- Sûr à exécuter plusieurs fois : ON CONFLICT DO NOTHING évite les doublons si
-- ce script est relancé par erreur.

ALTER TABLE fare_rules ADD CONSTRAINT uniq_country_tier UNIQUE (country_id, service_tier);

INSERT INTO fare_rules (country_id, service_tier, base_fee, city_radius_km, cost_per_km_city, cost_per_km_suburb, cost_per_min, minimum_fare, commission_rate) VALUES
('SN', 'ESSENTIEL', 400, 15, 85, 120, 20, 400, 0.08),
('SN', 'SIGNATURE', 950, 15, 130, 210, 35, 1300, 0.08),
('TG', 'ESSENTIEL', 800, 15, 160, 320, 64, 1440, 0.08),
('TG', 'SIGNATURE', 1900, 15, 240, 560, 110, 4800, 0.08),
('CI', 'ESSENTIEL', 250, 15, 50, 100, 20, 450, 0.08),
('CI', 'SIGNATURE', 600, 15, 75, 175, 35, 1500, 0.08),
('NE', 'ESSENTIEL', 250, 15, 50, 100, 20, 450, 0.08),
('NE', 'SIGNATURE', 600, 15, 75, 175, 35, 1500, 0.08),
('ML', 'ESSENTIEL', 250, 15, 50, 100, 20, 450, 0.08),
('ML', 'SIGNATURE', 600, 15, 75, 175, 35, 1500, 0.08),
('BF', 'ESSENTIEL', 250, 15, 50, 100, 20, 450, 0.08),
('BF', 'SIGNATURE', 600, 15, 75, 175, 35, 1500, 0.08),
('GW', 'ESSENTIEL', 250, 15, 50, 100, 20, 450, 0.08),
('GW', 'SIGNATURE', 600, 15, 75, 175, 35, 1500, 0.08)
ON CONFLICT (country_id, service_tier) DO NOTHING;
