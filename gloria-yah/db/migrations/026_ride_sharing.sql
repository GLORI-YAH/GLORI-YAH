-- Partage de course (04/09) : deux passagers allant dans une direction proche
-- partagent la même course avec un même pilote, associés automatiquement par
-- le système (pas besoin de se connaître) — pas de majoration pour le
-- passager seul, mais le passager qui choisit de partager paie moins que
-- s'il était seul.
--
-- Formule confirmée par l'utilisateur : le prix total de la course partagée =
-- prix normal du trajet le plus cher des deux × 1,2, divisé par le nombre de
-- passagers. Exemple : trajet seul à 500F -> partagé à deux, total 600F,
-- 300F chacun.

ALTER TABLE rides ADD COLUMN share_requested BOOLEAN DEFAULT false;
ALTER TABLE rides ADD COLUMN is_shared BOOLEAN DEFAULT false;

-- Un second passager (et, plus tard, éventuellement plus) rejoint la course
-- principale (rides) sans dupliquer tout le reste (pilote, véhicule, statut) —
-- chacun garde son propre point de départ/arrivée, qui peuvent différer
-- légèrement de ceux du premier passager.
CREATE TABLE ride_shares (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id             UUID NOT NULL REFERENCES rides(id),
    passenger_id        UUID NOT NULL REFERENCES users(id),
    pickup_point        GEOGRAPHY(POINT, 4326) NOT NULL,
    destination_point   GEOGRAPHY(POINT, 4326) NOT NULL,
    price_share         NUMERIC(10,2) NOT NULL,
    joined_at           TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ride_shares_ride ON ride_shares(ride_id);
CREATE INDEX idx_ride_shares_passenger ON ride_shares(passenger_id);
