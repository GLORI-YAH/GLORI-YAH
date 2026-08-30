-- Ajoute la colonne pour stocker le tracé réel de l'itinéraire (polyline encodée
-- Google Directions), calculé une seule fois à la création de la course.
-- NULL si le calcul Google a échoué (repli sur l'estimation Haversine) — dans ce
-- cas, le frontend continue de tracer une ligne droite entre départ et destination.
ALTER TABLE rides ADD COLUMN route_polyline TEXT;
