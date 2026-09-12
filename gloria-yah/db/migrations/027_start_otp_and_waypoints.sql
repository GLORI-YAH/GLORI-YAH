-- Ajouts (05/09) suite au tri des idées Apporio Infolabs :
--  1) Code OTP à 4 chiffres que le passager donne au pilote avant que celui-ci
--     puisse démarrer la course — évite qu'un mauvais passager monte dans le
--     véhicule par erreur ou par fraude. Généré à l'acceptation de l'offre par
--     le pilote (donc dès le statut MATCHED), jamais renvoyé au pilote via
--     l'API (seul le passager le voit dans son app), vérifié côté serveur
--     avant d'accepter la transition ONGOING.
--  2) Arrêts intermédiaires (multi-arrêts) : liste optionnelle de points que
--     le pilote doit traverser dans l'ordre entre le départ et la destination
--     finale, stockée en JSONB (souple, pas besoin d'une table séparée pour
--     un usage encore simple). Chaque arrêt : {lat, lng, label}.

ALTER TABLE rides ADD COLUMN start_otp VARCHAR(4);
ALTER TABLE rides ADD COLUMN waypoints JSONB DEFAULT '[]'::jsonb;
