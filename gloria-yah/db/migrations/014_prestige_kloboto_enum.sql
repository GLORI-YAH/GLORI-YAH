-- Ajout de deux nouvelles gammes véhicule (demande utilisateur, photos fournies) :
--  - PRESTIGE : 4x4 haut de gamme, au-dessus de Signature
--  - KLOBOTO  : tricycle (Bajaj), nom de marque déjà utilisé par l'utilisateur
--
-- Note : le service_tier 'CORPORATE' existant dans le schéma désigne un modèle
-- de FACTURATION entreprise (table corporate_accounts), pas un type de véhicule
-- physique — donc PRESTIGE est une vraie nouvelle gamme, pas une réutilisation
-- de CORPORATE malgré le nom "4x4 pour usage corporate" évoqué à l'oral.
--
-- ALTER TYPE ... ADD VALUE ne peut pas être utilisé dans la même transaction
-- qu'une requête qui utilise déjà cette valeur — fichier séparé du suivant,
-- même précaution que pour MOTO (009/010) et LIVRAISON (012/013).
ALTER TYPE service_tier ADD VALUE IF NOT EXISTS 'PRESTIGE';
ALTER TYPE service_tier ADD VALUE IF NOT EXISTS 'KLOBOTO';
