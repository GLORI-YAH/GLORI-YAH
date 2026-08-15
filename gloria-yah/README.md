# GLORIA-YAH — Backend + Frontend MVP

Plateforme VTC taxi-compteur (Bénin et Afrique de l'Ouest). Ce dépôt contient un **premier squelette fonctionnel**, pas un produit fini — voir "Ce qui n'est PAS fait" en bas de ce fichier.

## Stack
- Backend : Node.js + Express + PostgreSQL/PostGIS
- Frontend : HTML/CSS/JS vanilla (3 pages : passager, chauffeur, admin)
- Auth : JWT (bcrypt pour les mots de passe)

## Installation

```bash
# 1. Installer les dépendances
npm install

# 2. Configurer l'environnement
cp .env.example .env
# éditer .env : DATABASE_URL, JWT_SECRET (obligatoires pour démarrer)

# 3. Créer la base PostgreSQL (avec l'extension PostGIS disponible)
createdb gloria_yah

# 4. Appliquer le schéma
npm run db:init

# 5. Démarrer le serveur
npm start
# ou en développement (redémarrage auto) :
npm run dev
```

Le serveur démarre sur `http://localhost:3000`. Les 3 pages sont servies directement :
- `http://localhost:3000/index.html` — réservation passager (estimation + Prix Plafond Garanti)
- `http://localhost:3000/chauffeur.html` — wallet + déclaration véhicule (photo/plaque/couleur)
- `http://localhost:3000/admin.html` — KPIs + validation véhicules

## Créer un premier compte admin

Il n'y a volontairement pas de route publique pour créer un admin (risque de sécurité).
Après inscription d'un compte normal via `/api/v1/auth/register`, passer son rôle à `ADMIN` directement en base :

```sql
UPDATE users SET role = 'ADMIN' WHERE phone_number = '+229XXXXXXXX';
```

## Tester rapidement l'API (curl)

```bash
# Estimation de prix (public, sans auth)
curl -X POST http://localhost:3000/api/v1/rides/estimate \
  -H "Content-Type: application/json" \
  -d '{"pickup":{"lat":6.3703,"lng":2.3912},"destination":{"lat":6.3617,"lng":2.0847},"service_tier":"ESSENTIEL","country_id":"BJ"}'

# Inscription
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"+22990000000","full_name":"Test Passager","password":"motdepasse","role":"PASSAGER","country_id":"BJ"}'
```

## Ce qui est réellement implémenté

- Inscription/connexion (JWT, mots de passe hashés)
- Estimation de prix + création de course, avec grille tarifaire par pays/gamme
- **Prix Plafond Garanti** réellement calculé côté serveur : `final_price = MIN(estimate_price, meter_final_price)`, appliqué à la clôture de course (`POST /rides/:id/complete`)
- Compteur temps réel (`POST /rides/:id/meter/tick`) alimentant le calcul ci-dessus
- Débit automatique de la commission plateforme sur le wallet chauffeur à la clôture
- Déclaration véhicule avec photo/plaque/couleur (base de sécurité), journal de modification (`vehicle_change_log`)
- Fiche "safety-card" consultable par le passager avant embarquement
- Dashboard admin minimal : KPIs, validation des véhicules, alertes SOS ouvertes
- Schéma multi-pays (13 pays d'Afrique de l'Ouest) avec devises et passerelles de paiement par pays

## Paiement Kkiapay — flux réel implémenté

Le crédit direct (`POST /wallet/topup`) a été retiré. Le flux est maintenant :

1. `POST /wallet/topup/init` — le serveur renvoie la clé publique Kkiapay + le montant (aucune écriture en base).
2. Le frontend ouvre `openKkiapayWidget(...)` — le SDK Kkiapay gère le paiement (MTN, Moov, carte...).
3. Au succès, le frontend envoie le `transactionId` reçu à `POST /wallet/topup/verify`.
4. **Le serveur rappelle Kkiapay lui-même** (`services/kkiapay.js`, avec la clé privée) pour confirmer la transaction — le wallet n'est crédité **que** si Kkiapay confirme un statut `SUCCESS`, et le montant crédité est celui renvoyé par Kkiapay, jamais celui fourni par le frontend.
5. Un index unique sur `wallet_transactions.reference` empêche tout double-crédit si `/verify` est appelé deux fois (double-clic, retry réseau).
6. `POST /wallet/webhooks/kkiapay` existe comme filet de sécurité si le frontend ne rappelle jamais `/verify` — squelette présent, l'association `transactionId → user_id` reste à compléter selon les métadonnées que tu choisiras de passer à Kkiapay à l'initiation du paiement.

⚠️ **Avant mise en production** : vérifier l'URL exacte et le format de réponse de l'API de vérification Kkiapay sur `https://docs.kkiapay.me` (indiqué en commentaire dans `services/kkiapay.js`), tester en sandbox, et implémenter la vérification de signature du webhook.

**FedaPay (Togo/CI/Sénégal/Niger...) suit le même principe mais n'est pas encore codé** — même pattern à dupliquer : `services/fedapay.js` + `/wallet/topup/verify` adapté, à faire quand ce pays sera prioritaire.

## Commission adaptative (pluie / week-end / embouteillage) — le prix passager ne bouge JAMAIS

Pour compenser le chauffeur dans les conditions difficiles sans jamais toucher au prix passager (ce qui casserait la politique "Zéro Majoration"), GLORIA-YAH réduit sa propre commission plutôt que d'augmenter le tarif :

| Condition | Commission plateforme |
|---|---|
| Normale | 8% |
| Week-end (samedi/dimanche) | 5% |
| Pluie déclarée par le chauffeur | 4% |
| Embouteillage important (durée réelle ≥ 1,5x l'estimation) | 5% |
| Plusieurs conditions à la fois | la **plus basse** applicable (jamais cumulées) |

- Détection week-end : automatique (jour de la semaine au moment de la clôture).
- Détection embouteillage : automatique, à partir du dernier tick du compteur comparé à la durée estimée initiale — aucune saisie manuelle requise.
- Détection pluie : **auto-déclarative côté chauffeur** pour ce MVP (`POST /rides/:id/conditions {"rain": true}`). ⚠️ À remplacer en production par une vraie API météo géolocalisée (ex. déclenchement automatique si l'API confirme de la pluie sur la zone de prise en charge) — l'auto-déclaration ouvre la porte à des abus si elle reste la seule source de vérité.

Logique centralisée dans `services/pricing.js::computeCommissionRate()`, appliquée dans `routes/rides.js` à la clôture de course (`POST /rides/:id/complete`).

## Ce qui n'est PAS fait — à ne pas perdre de vue

- **Pas de moteur de routing réel.** La distance est calculée à vol d'oiseau × 1.3 (approximation) — à remplacer par Mapbox Directions API ou équivalent pour une distance/ETA fiables.
- **Pas d'upload de fichier réel** (photo véhicule/chauffeur, documents KYC) — les routes attendent une URL déjà hébergée ; à brancher sur un service de stockage (S3, Firebase Storage, etc.).
- **Pas de notifications push/SMS réelles** (matching chauffeur, alerte SOS, changement de statut de course) — actuellement uniquement stocké en base.
- **Pas d'assistant IA.** Les endpoints `/assistant/chat`, `/demand/heatmap`, `/admin/copilot/query` du concept ne sont pas implémentés ici.
- **Pas de facturation Corporate automatisée** (les tables existent, la génération de facture PDF/CSV n'est pas codée).
- **Pas de tests automatisés.**
- **Pas de vérification de plaque en direct pendant la course** (l'app ne fait que stocker la confirmation du passager, pas de reconnaissance automatique).
- **Sécurité à durcir avant production** : rate limiting, validation d'entrée plus stricte, CORS restreint à ton domaine, secrets réels en `.env`, HTTPS obligatoire.
- **Coefficients tarifaires illustratifs** (voir `db/schema.sql`, table `fare_rules`) — à valider avant tout lancement réel.
- **CGU non liées techniquement** — le fichier CGU livré précédemment reste un document à part, pas encore intégré comme écran d'acceptation obligatoire à l'inscription.

## Prochaines étapes logiques
1. ~~Brancher Kkiapay réellement~~ — fait (voir section ci-dessus). Reste : tester en sandbox réel, compléter le webhook, dupliquer le pattern pour FedaPay.
2. Brancher un vrai moteur de routing (distance/ETA fiables).
3. Ajouter l'écran d'acceptation des CGU à l'inscription.
4. Ajouter l'upload de fichiers réel (photo véhicule/chauffeur, documents KYC).
5. Implémenter le matching chauffeur (aujourd'hui, `driver_id` doit être assigné manuellement via `PATCH /rides/:id/status`).
