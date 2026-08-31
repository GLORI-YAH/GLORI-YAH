-- Tarifs RDC (Kinshasa), calibrés sur la grille tarifaire OFFICIELLE Yango
-- Kinshasa (yango.com/fr_int/kinshasa/tariff/*, consultée le 30/08/2026,
-- valable jusqu'au 01.09.2026 pour Éco/Moto/3pneus — la page Confort affichait
-- une date de validité déjà dépassée (04.08.2026), donc ces chiffres Signature
-- sont peut-être légèrement obsolètes, à revérifier).
--
-- ⚠️ Contrairement au Bénin, la structure "ville/banlieue" de Kinshasa est
-- QUASI IDENTIQUE entre les deux zones chez Yango pour Éco et Confort (même
-- tarif partout) — donc cost_per_km_city = cost_per_km_suburb pour ces gammes.
-- Seuls Moto et 3pneus ont un tarif banlieue légèrement différent.
--
-- ⚠️ Aucune donnée réelle trouvée pour Livraison et Prestige à Kinshasa — ces
-- gammes restent volontairement SANS grille tarifaire pour la RDC (l'API
-- refusera proprement toute demande sur ces gammes-là, comme prévu).
-- Monnaie : Franc congolais (CDF) — pas de conversion, prix natifs Yango.

INSERT INTO fare_rules (country_id, service_tier, base_fee, city_radius_km, cost_per_km_city, cost_per_km_suburb, cost_per_min, minimum_fare, commission_rate, included_km) VALUES
('CD', 'MOTO',      2400, 15, 535,    565,    110,    2400, 0.05, 1),
('CD', 'ESSENTIEL', 3200, 15, 650,    650,    135,    3200, 0.08, 1.1),
('CD', 'SIGNATURE', 3687, 15, 606.51, 606.51, 227.52, 3687, 0.08, 1),
('CD', 'KLOBOTO',   250,  15, 235,    470,    50,     250,  0.06, 0.4);
