-- Colonnes nécessaires au moteur de matching chauffeur — oubliées lors de la
-- première construction, jamais appliquées sur la base déjà en ligne.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_position GEOGRAPHY(POINT, 4326);
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_online_position ON users USING GIST (current_position) WHERE is_online = true;

ALTER TABLE rides ADD COLUMN IF NOT EXISTS candidate_driver_id UUID REFERENCES users(id);
ALTER TABLE rides ADD COLUMN IF NOT EXISTS offer_expires_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS declined_driver_ids UUID[] DEFAULT '{}';
ALTER TABLE rides ADD COLUMN IF NOT EXISTS guarantee_free BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS guarantee_zones (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    country_id      CHAR(2) REFERENCES countries(id),
    zone_name       VARCHAR(100) NOT NULL,
    center_position GEOGRAPHY(POINT, 4326) NOT NULL,
    radius_km       NUMERIC(6,2) NOT NULL,
    max_minutes      NUMERIC(4,1) NOT NULL,
    active          BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT now()
);
