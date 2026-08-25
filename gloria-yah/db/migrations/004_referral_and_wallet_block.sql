ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(10) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_ride_credit_fcfa NUMERIC(10,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_milestones_rewarded INT DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
