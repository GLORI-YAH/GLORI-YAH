-- Ajout de la Livraison (colis) comme extension de l'infrastructure course
-- existante — même logique que Yango/Uber : la livraison réutilise le
-- matching, le suivi GPS, le tracé réel, le paiement et la commission déjà
-- construits pour les courses passagers, plutôt que de dupliquer un système
-- parallèle.
--
-- Deux gammes séparées (comme pour les courses) car leurs coûts et leur
-- vitesse diffèrent nettement : LIVRAISON_MOTO (rapide, colis léger) et
-- LIVRAISON_VOITURE (plus lent, colis volumineux).
--
-- ALTER TYPE ... ADD VALUE ne peut pas être utilisé dans la même transaction
-- qu'une requête qui utilise déjà cette valeur — d'où la séparation en deux
-- fichiers de migration, comme pour l'ajout de MOTO (009 puis 010).
ALTER TYPE service_tier ADD VALUE IF NOT EXISTS 'LIVRAISON_MOTO';
ALTER TYPE service_tier ADD VALUE IF NOT EXISTS 'LIVRAISON_VOITURE';

-- Une livraison n'a pas de "passager" au sens propre, mais un destinataire à
-- contacter et un colis à décrire — colonnes nullables, utilisées uniquement
-- quand service_tier est une des deux gammes livraison.
ALTER TABLE rides ADD COLUMN recipient_name VARCHAR(150);
ALTER TABLE rides ADD COLUMN recipient_phone VARCHAR(20);
ALTER TABLE rides ADD COLUMN package_description VARCHAR(300);
