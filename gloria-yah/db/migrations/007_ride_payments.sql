CREATE TABLE IF NOT EXISTS ride_payments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id         UUID REFERENCES rides(id),
    gateway         VARCHAR(20) NOT NULL,
    transaction_id  VARCHAR(100) UNIQUE NOT NULL,
    amount          NUMERIC(10,2) NOT NULL,
    status          VARCHAR(20) DEFAULT 'PENDING',
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ride_payments_ride ON ride_payments(ride_id);
