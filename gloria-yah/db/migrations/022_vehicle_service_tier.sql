-- CORRECTIF STRUCTUREL MAJEUR (audit du 31/08/2026) : le moteur de matching
-- ne filtrait jusqu'ici NI par gamme de véhicule NI par pays — un passager
-- demandant "Prestige" (4x4) pouvait recevoir n'importe quel pilote en ligne,
-- même un pilote moto. La table vehicles n'avait tout simplement aucune
-- colonne pour savoir quelle gamme un véhicule sert.
--
-- Ajout de la colonne + rattrapage des véhicules déjà existants sur une base
-- de best-effort (déduit du type déclaré à l'inscription) — à vérifier/
-- corriger manuellement pour les véhicules déjà enregistrés si le déduction
-- automatique ne correspond pas à la réalité.
ALTER TABLE vehicles ADD COLUMN service_tier service_tier;

-- Déduction automatique pour les véhicules déjà en base, à partir de leur
-- type déclaré (colonne "make"/"model" ne permet pas de déduire la gamme
-- fiablement) — impossible de deviner avec certitude, donc on laisse NULL
-- volontairement. Un véhicule NULL ne sera proposé pour AUCUNE course tant
-- qu'un admin ne lui assigne pas une gamme explicitement (voir nouvel
-- endpoint PATCH /admin/vehicles/:id/service-tier) — plus sûr qu'une
-- déduction automatique potentiellement fausse.
