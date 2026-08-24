-- ============================================================
-- GLORI-YAH — Schéma PostgreSQL / PostGIS consolidé
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE exploitation_mode AS ENUM ('MODE_A_PROPRIETAIRE', 'MODE_B_EMPLOYE', 'MODE_C_ASSIGNE');
CREATE TYPE user_role         AS ENUM ('PASSAGER', 'CHAUFFEUR', 'PROPRIETAIRE', 'ADMIN');
CREATE TYPE ride_status       AS ENUM ('REQUESTED', 'MATCHED', 'ONGOING', 'COMPLETED', 'CANCELLED');
CREATE TYPE payment_method    AS ENUM ('CASH', 'KKIAPAY', 'FEDAPAY', 'OTHER_GATEWAY');
CREATE TYPE kyc_status        AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE wallet_txn_type   AS ENUM ('COMMISSION_DEBIT', 'TOPUP', 'PAYOUT', 'ADJUSTMENT');
CREATE TYPE service_tier      AS ENUM ('ESSENTIEL', 'SIGNATURE', 'CORPORATE');

-- ---------- PAYS ----------
CREATE TABLE countries (
    id              CHAR(2) PRIMARY KEY,
    name            VARCHAR(60) NOT NULL,
    currency_code   CHAR(3) NOT NULL,
    is_xof_zone     BOOLEAN DEFAULT true,
    launch_status   VARCHAR(20) DEFAULT 'PLANNED',
    default_payment_gateways TEXT[]
);

INSERT INTO countries (id, name, currency_code, is_xof_zone, launch_status, default_payment_gateways) VALUES
('BJ', 'Bénin',         'XOF', true,  'LAUNCHING', ARRAY['KKIAPAY','FEDAPAY']),
('TG', 'Togo',          'XOF', true,  'LAUNCHING', ARRAY['FEDAPAY']),
('CI', 'Côte d''Ivoire','XOF', true,  'LAUNCHING', ARRAY['FEDAPAY']),
('SN', 'Sénégal',       'XOF', true,  'LAUNCHING', ARRAY['FEDAPAY']),
('NE', 'Niger',         'XOF', true,  'PLANNED',   ARRAY['FEDAPAY']),
('ML', 'Mali',          'XOF', true,  'PLANNED',   ARRAY['FEDAPAY']),
('BF', 'Burkina Faso',  'XOF', true,  'PLANNED',   ARRAY['FEDAPAY']),
('GW', 'Guinée-Bissau', 'XOF', true,  'PLANNED',   ARRAY[]::TEXT[]),
('GH', 'Ghana',         'GHS', false, 'PLANNED',   ARRAY[]::TEXT[]),
('GN', 'Guinée',        'GNF', false, 'PLANNED',   ARRAY[]::TEXT[]),
('SL', 'Sierra Leone',  'SLL', false, 'PLANNED',   ARRAY[]::TEXT[]),
('LR', 'Liberia',       'LRD', false, 'PLANNED',   ARRAY[]::TEXT[]),
('GM', 'Gambie',        'GMD', false, 'PLANNED',   ARRAY[]::TEXT[]),
('CV', 'Cap-Vert',      'CVE', false, 'PLANNED',   ARRAY[]::TEXT[]);

-- ---------- UTILISATEURS ----------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number    VARCHAR(20) UNIQUE NOT NULL,
    full_name       VARCHAR(150) NOT NULL,
    email           VARCHAR(150),
    password_hash   TEXT NOT NULL,
    role            user_role NOT NULL,
    rating_avg      NUMERIC(2,1) DEFAULT 5.0,
    driver_photo_url TEXT,
    country_id      CHAR(2) REFERENCES countries(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE kyc_documents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    doc_type        VARCHAR(50) NOT NULL,
    file_url        TEXT NOT NULL,
    status          kyc_status DEFAULT 'PENDING',
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    expires_at      DATE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ---------- VÉHICULES ----------
CREATE TABLE vehicles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id            UUID REFERENCES users(id),
    plate_number        VARCHAR(20) UNIQUE NOT NULL,
    make                VARCHAR(50),
    model               VARCHAR(50),
    year                INT,
    color               VARCHAR(30),
    photo_url           TEXT,
    photo_verified      BOOLEAN DEFAULT false,
    photo_updated_at    TIMESTAMPTZ,
    exploitation_mode   exploitation_mode NOT NULL,
    assigned_driver_id  UUID REFERENCES users(id),
    technical_visit_ok  BOOLEAN DEFAULT false,
    insurance_doc_url   TEXT,
    kyc_status          kyc_status DEFAULT 'PENDING',
    country_id          CHAR(2) REFERENCES countries(id),
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE vehicle_change_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id      UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    changed_field   VARCHAR(30) NOT NULL,
    old_value       TEXT,
    new_value       TEXT,
    changed_by      UUID REFERENCES users(id),
    changed_at      TIMESTAMPTZ DEFAULT now()
);

-- ---------- TÉLÉMÉTRIE GPS EXTERNE ----------
CREATE TABLE vehicle_telemetry (
    id                  BIGSERIAL PRIMARY KEY,
    vehicle_id          UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    external_device_id  VARCHAR(100),
    provider             VARCHAR(50),
    position            GEOGRAPHY(POINT, 4326) NOT NULL,
    altitude            NUMERIC(6,2),
    speed_kmh           NUMERIC(5,2),
    heading             NUMERIC(5,2),
    engine_on           BOOLEAN,
    battery_level       NUMERIC(5,2),
    recorded_at         TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_telemetry_vehicle_time ON vehicle_telemetry (vehicle_id, recorded_at DESC);

-- ---------- TARIFICATION ----------
CREATE TABLE fare_rules (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    country_id      CHAR(2) REFERENCES countries(id),
    service_tier    service_tier NOT NULL DEFAULT 'ESSENTIEL',
    base_fee        NUMERIC(10,2) NOT NULL,
    included_km     NUMERIC(6,2) DEFAULT 2,     -- distance incluse dans le tarif minimum (ex. 2 km chez Yango)
    included_min    NUMERIC(6,2) DEFAULT 4.9,   -- durée incluse dans le tarif minimum
    city_radius_km  NUMERIC(6,2) DEFAULT 15,    -- au-delà, le tarif "banlieue" s'applique
    cost_per_km_city    NUMERIC(10,2) NOT NULL, -- F/km à l'intérieur de city_radius_km
    cost_per_km_suburb  NUMERIC(10,2) NOT NULL, -- F/km au-delà de city_radius_km
    cost_per_min    NUMERIC(10,2) NOT NULL,
    minimum_fare    NUMERIC(10,2) NOT NULL,
    commission_rate NUMERIC(4,3) DEFAULT 0.08,
    active          BOOLEAN DEFAULT true
);

-- Coefficients calibrés sur les tarifs publics Yango Cotonou (consultés le 13/08/2026 :
-- Économie = base 300F/53F km ville/130F km banlieue/25F min ;
-- Comfort  = base 450F/69F km ville/169F km banlieue/32F min)
-- GLORI-YAH Essentiel : coefficients choisis par le porteur du projet (13/08/2026),
-- battent Yango Économie sur les 4 métriques (base, ville, banlieue, minute).
-- ⚠️ À surveiller après lancement : à 50F/km ville, la marge chauffeur nette après
-- commission peut être fine sur les trajets longs en ville avec beaucoup de trafic
-- (le coût carburant seul tourne autour de 72-87F/km en conduite urbaine) — suivre
-- le revenu net chauffeur réel avant de considérer ce chiffre comme définitif.
-- GLORI-YAH Signature se positionne volontairement AU-DESSUS de Yango Comfort
-- (justifié par chauffeurs certifiés/véhicules inspectés — Signature ne joue pas la carte du prix).
-- À RE-VALIDER périodiquement : Yango peut changer ses tarifs (affichés valides jusqu'au 18/08/2026).
INSERT INTO fare_rules (country_id, service_tier, base_fee, city_radius_km, cost_per_km_city, cost_per_km_suburb, cost_per_min, minimum_fare, commission_rate) VALUES
('BJ', 'ESSENTIEL', 250, 15, 50, 100, 20, 450, 0.08),
('BJ', 'SIGNATURE', 600, 15, 75, 175, 35, 1500, 0.08);

-- Sénégal : calibré sur le vrai tarif public Yango Dakar (consulté le 16/08/2026,
-- valide jusqu'au 18/08/2026) : Économie = base 490F/95F km ville/150F km banlieue/25F min.
-- GLORI-YAH Essentiel bat ces 4 métriques, comme au Bénin.
INSERT INTO fare_rules (country_id, service_tier, base_fee, city_radius_km, cost_per_km_city, cost_per_km_suburb, cost_per_min, minimum_fare, commission_rate) VALUES
('SN', 'ESSENTIEL', 400, 15, 85, 120, 20, 400, 0.08),
('SN', 'SIGNATURE', 950, 15, 130, 210, 35, 1300, 0.08);

-- Togo : Gozem (né au Togo) facture en moyenne ~240F/km en taxi-voiture à Lomé
-- (source Petit Futé, consulté 16/08/2026 — moyenne de marché, pas une grille
-- officielle décomposée comme Yango Bénin/Sénégal). GLORI-YAH applique une
-- réduction d'environ 33% sur ce prix au km (240F -> 160F/km), puis reconstruit
-- une formule complète (base/ville/banlieue/minute) en gardant les mêmes
-- proportions internes que la grille Bénin. Signature au-dessus d'Essentiel,
-- suivant le même principe qu'ailleurs.
INSERT INTO fare_rules (country_id, service_tier, base_fee, city_radius_km, cost_per_km_city, cost_per_km_suburb, cost_per_min, minimum_fare, commission_rate) VALUES
('TG', 'ESSENTIEL', 800, 15, 160, 320, 64, 1440, 0.08),
('TG', 'SIGNATURE', 1900, 15, 240, 560, 110, 4800, 0.08);

-- ⚠️ Côte d'Ivoire, Niger, Mali, Burkina Faso, Guinée-Bissau : AUCUNE grille
-- tarifaire officielle fiable de la concurrence n'a été trouvée pour ces pays au
-- 16/08/2026 (Côte d'Ivoire : seulement un prix minimum ~550F et des fourchettes
-- de blog, pas assez précis ; les autres : rien trouvé du tout). Par défaut, ces
-- pays partagent la même zone monétaire XOF/UEMOA que le Bénin et une économie
-- globalement comparable — on reprend donc PROVISOIREMENT les coefficients Bénin
-- comme point de départ. À REMPLACER par de vraies données de marché locales
-- avant tout lancement réel dans un de ces pays.
INSERT INTO fare_rules (country_id, service_tier, base_fee, city_radius_km, cost_per_km_city, cost_per_km_suburb, cost_per_min, minimum_fare, commission_rate) VALUES
('CI', 'ESSENTIEL', 250, 15, 50, 100, 20, 450, 0.08), ('CI', 'SIGNATURE', 600, 15, 75, 175, 35, 1500, 0.08),
('NE', 'ESSENTIEL', 250, 15, 50, 100, 20, 450, 0.08), ('NE', 'SIGNATURE', 600, 15, 75, 175, 35, 1500, 0.08),
('ML', 'ESSENTIEL', 250, 15, 50, 100, 20, 450, 0.08), ('ML', 'SIGNATURE', 600, 15, 75, 175, 35, 1500, 0.08),
('BF', 'ESSENTIEL', 250, 15, 50, 100, 20, 450, 0.08), ('BF', 'SIGNATURE', 600, 15, 75, 175, 35, 1500, 0.08),
('GW', 'ESSENTIEL', 250, 15, 50, 100, 20, 450, 0.08), ('GW', 'SIGNATURE', 600, 15, 75, 175, 35, 1500, 0.08);

-- Ghana, Guinée, Sierra Leone, Liberia, Gambie, Cap-Vert : PAS de fare_rules ici.
-- Ces pays sont hors zone FCFA (devises GHS/GNF/SLL/LRD/GMD/CVE) et aucune donnée
-- de marché locale fiable et récente n'a été trouvée — inventer des coefficients
-- dans une devise non maîtrisée serait irresponsable. Le frontend affiche déjà un
-- message clair à l'utilisateur si un de ces pays est sélectionné (voir index.html).

-- ---------- COURSES ----------
CREATE TABLE rides (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    passenger_id        UUID REFERENCES users(id),
    driver_id           UUID REFERENCES users(id),
    vehicle_id          UUID REFERENCES vehicles(id),
    fare_rule_id        UUID REFERENCES fare_rules(id),
    country_id          CHAR(2) REFERENCES countries(id),
    currency_code       CHAR(3) DEFAULT 'XOF',
    service_tier        service_tier NOT NULL DEFAULT 'ESSENTIEL',
    pickup_point        GEOGRAPHY(POINT, 4326) NOT NULL,
    destination_point   GEOGRAPHY(POINT, 4326) NOT NULL,
    status              ride_status DEFAULT 'REQUESTED',
    distance_km         NUMERIC(8,2),
    duration_min        NUMERIC(8,2),
    estimate_price       NUMERIC(10,2),
    meter_final_price    NUMERIC(10,2),
    final_price          NUMERIC(10,2),
    surge_applied        BOOLEAN DEFAULT false,
    payment_method       payment_method,
    vehicle_check_confirmed    BOOLEAN DEFAULT false,
    vehicle_check_confirmed_at TIMESTAMPTZ,
    rain_flag            BOOLEAN DEFAULT false, -- auto-déclaré par le chauffeur (MVP) ; à remplacer par une vraie API météo
    requested_at        TIMESTAMPTZ DEFAULT now(),
    started_at          TIMESTAMPTZ,
    completed_at         TIMESTAMPTZ,
    cancelled_at         TIMESTAMPTZ
);
CREATE INDEX idx_rides_passenger ON rides(passenger_id);
CREATE INDEX idx_rides_driver ON rides(driver_id);
CREATE INDEX idx_rides_status ON rides(status);

CREATE TABLE ride_meter_ticks (
    id           BIGSERIAL PRIMARY KEY,
    ride_id      UUID REFERENCES rides(id) ON DELETE CASCADE,
    position     GEOGRAPHY(POINT, 4326) NOT NULL,
    elapsed_min  NUMERIC(6,2) NOT NULL,
    distance_km  NUMERIC(8,3) NOT NULL,
    running_price NUMERIC(10,2) NOT NULL,
    recorded_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_meter_ticks_ride ON ride_meter_ticks(ride_id, recorded_at);

-- ---------- ÉVALUATIONS ----------
CREATE TABLE ratings (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id     UUID REFERENCES rides(id) ON DELETE CASCADE,
    rater_id    UUID REFERENCES users(id),
    rated_id    UUID REFERENCES users(id),
    score       SMALLINT CHECK (score BETWEEN 1 AND 5),
    comment     TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ---------- WALLET / FINANCE ----------
CREATE TABLE wallets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    balance         NUMERIC(12,2) DEFAULT 0,
    negative_floor  NUMERIC(12,2) DEFAULT -1000,
    is_blocked      BOOLEAN DEFAULT false,
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE wallet_transactions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id       UUID REFERENCES wallets(id) ON DELETE CASCADE,
    ride_id         UUID REFERENCES rides(id),
    type            wallet_txn_type NOT NULL,
    amount          NUMERIC(12,2) NOT NULL,
    gateway         VARCHAR(30),
    reference       VARCHAR(100),
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_wallet_txn_wallet ON wallet_transactions(wallet_id, created_at DESC);

-- Empêche qu'une même transaction de paiement (Kkiapay/FedaPay) crédite le wallet deux fois
CREATE UNIQUE INDEX uniq_wallet_txn_reference
  ON wallet_transactions (reference)
  WHERE reference IS NOT NULL AND type = 'TOPUP';

CREATE TABLE payouts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id       UUID REFERENCES wallets(id),
    amount          NUMERIC(12,2) NOT NULL,
    phone_number    VARCHAR(20) NOT NULL,
    gateway         VARCHAR(30) NOT NULL,
    status          VARCHAR(20) DEFAULT 'PENDING',
    requested_at    TIMESTAMPTZ DEFAULT now(),
    processed_at    TIMESTAMPTZ
);

-- ---------- CORPORATE ----------
CREATE TABLE corporate_accounts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name    VARCHAR(200) NOT NULL,
    billing_email   VARCHAR(150),
    monthly_cap     NUMERIC(12,2),
    travel_policy   JSONB,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE corporate_members (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    corporate_account_id UUID REFERENCES corporate_accounts(id) ON DELETE CASCADE,
    user_id             UUID REFERENCES users(id),
    cost_center         VARCHAR(100),
    role                VARCHAR(30) DEFAULT 'EMPLOYEE'
);

-- ---------- SOS / SÉCURITÉ ----------
CREATE TABLE sos_alerts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id         UUID REFERENCES rides(id),
    triggered_by    UUID REFERENCES users(id),
    position        GEOGRAPHY(POINT, 4326),
    reason          VARCHAR(50),
    status          VARCHAR(20) DEFAULT 'OPEN',
    handled_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

CREATE TABLE emergency_contacts (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(150),
    phone       VARCHAR(20)
);

ALTER TABLE users ADD COLUMN is_online BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN current_position GEOGRAPHY(POINT, 4326);
ALTER TABLE users ADD COLUMN location_updated_at TIMESTAMPTZ;
CREATE INDEX idx_users_online_position ON users USING GIST (current_position) WHERE is_online = true;

-- Colonnes de matching sur les courses : à qui l'offre est proposée, et jusqu'à quand
ALTER TABLE rides ADD COLUMN candidate_driver_id UUID REFERENCES users(id);
ALTER TABLE rides ADD COLUMN offer_expires_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN declined_driver_ids UUID[] DEFAULT '{}';
ALTER TABLE rides ADD COLUMN guarantee_free BOOLEAN DEFAULT false;

-- Zones de garantie "pilote en moins de X minutes ou la course est offerte" —
-- UNIQUEMENT là où la densité réelle de véhicules le permet (jamais activée
-- partout par défaut : c'est une promesse commerciale, pas un réglage technique anodin).
CREATE TABLE guarantee_zones (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    country_id      CHAR(2) REFERENCES countries(id),
    zone_name       VARCHAR(100) NOT NULL,
    center_position GEOGRAPHY(POINT, 4326) NOT NULL,
    radius_km       NUMERIC(6,2) NOT NULL,
    max_minutes      NUMERIC(4,1) NOT NULL,
    active          BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE guarantee_zones IS 'Activer uniquement dans les zones où le nombre réel de véhicules disponibles justifie la promesse';

-- Vérification par code envoyé par SMS (remplace/complète le mot de passe pour
-- l'inscription et la connexion passager, comme Gozem/Yango)
CREATE TABLE otp_verifications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number    VARCHAR(20) NOT NULL,
    code_hash       TEXT NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    verified        BOOLEAN DEFAULT false,
    attempts        SMALLINT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_otp_phone ON otp_verifications(phone_number, created_at DESC);

CREATE TABLE liability_coverage (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exploitation_mode   exploitation_mode NOT NULL,
    incident_type       VARCHAR(50) NOT NULL,
    responsible_party   VARCHAR(50) NOT NULL,
    coverage_detail     TEXT
);
