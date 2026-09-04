-- Permet à l'admin de rendre un pilote spécifique gratuit (0%) ou de lui
-- appliquer un taux de commission personnalisé, à sa guise (promotion,
-- partenariat, compte VIP...), sans toucher à la grille tarifaire générale.
-- NULL = comportement normal (utilise le taux de la grille tarifaire du pays/gamme).
ALTER TABLE users ADD COLUMN commission_override NUMERIC(4,3);
COMMENT ON COLUMN users.commission_override IS 'Taux de commission personnalisé pour ce pilote (0 = gratuit) — NULL = taux normal de la grille tarifaire';
