-- Zones géographiques avec commission ajustée (ex. "Aéroport" à commission
-- réduite pour inciter les pilotes à s'y rendre) — cohérent avec la promesse
-- "Zéro Majoration" déjà établie : ces zones ne touchent JAMAIS au prix
-- passager, seulement à la part que GLORI-YAH prélève au pilote dans la zone.
CREATE TABLE pricing_zones (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(100) NOT NULL,
    country_id          CHAR(2) REFERENCES countries(id),
    center_lat          NUMERIC(10,6) NOT NULL,
    center_lng          NUMERIC(10,6) NOT NULL,
    radius_km           NUMERIC(6,2) NOT NULL,
    zone_commission_rate NUMERIC(4,3) NOT NULL,
    active              BOOLEAN DEFAULT true,
    created_at          TIMESTAMPTZ DEFAULT now()
);
