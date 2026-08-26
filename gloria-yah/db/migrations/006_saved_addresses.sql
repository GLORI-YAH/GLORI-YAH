CREATE TABLE IF NOT EXISTS saved_addresses (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    label       VARCHAR(50) NOT NULL,
    address_text VARCHAR(255) NOT NULL,
    position    GEOGRAPHY(POINT, 4326) NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_addresses_user ON saved_addresses(user_id);
