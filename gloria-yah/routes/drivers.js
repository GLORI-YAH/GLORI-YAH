const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Documents obligatoires avant qu'un pilote puisse recevoir la moindre course.
// Basé sur ce qu'on avait vu chez Yango Pro (permis recto + selfie).
const REQUIRED_KYC_DOC_TYPES = ['PERMIS', 'SELFIE'];

// POST /api/v1/drivers/online — le pilote se déclare disponible ou non
router.post('/online', requireAuth, requireRole('CHAUFFEUR'), async (req, res) => {
  const { online } = req.body;

  if (online) {
    // KYC obligatoire : impossible de passer en ligne tant que le permis et le
    // selfie n'ont pas été soumis ET vérifiés par l'admin.
    const verified = await pool.query(
      `SELECT doc_type FROM kyc_documents WHERE user_id = $1 AND status = 'VERIFIED'`,
      [req.user.id]
    );
    const verifiedTypes = verified.rows.map(r => r.doc_type);
    const missing = REQUIRED_KYC_DOC_TYPES.filter(t => !verifiedTypes.includes(t));
    if (missing.length > 0) {
      return res.status(403).json({
        error: 'Documents KYC manquants ou pas encore vérifiés — impossible de passer en ligne.',
        missing_documents: missing,
      });
    }
  }

  await pool.query('UPDATE users SET is_online = $2 WHERE id = $1', [req.user.id, !!online]);
  res.json({ is_online: !!online });
});

// POST /api/v1/drivers/location — le pilote pousse sa position en direct
// (à appeler périodiquement depuis l'app pilote, ex. toutes les 10-15 secondes)
router.post('/location', requireAuth, requireRole('CHAUFFEUR'), async (req, res) => {
  const { lat, lng } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat et lng sont requis' });

  await pool.query(
    `UPDATE users SET current_position = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
                       location_updated_at = now()
     WHERE id = $1`,
    [req.user.id, lng, lat]
  );
  res.json({ updated: true });
});

// GET /api/v1/drivers/pending-offer — le pilote vérifie s'il a une course à lui proposer
// MVP : basé sur l'interrogation périodique (polling) par l'app pilote toutes les
// quelques secondes. Une vraie notification push serait plus efficace en production
// (moins de latence, moins de charge serveur) — à prévoir dans une itération future.
router.get('/pending-offer', requireAuth, requireRole('CHAUFFEUR'), async (req, res) => {
  const result = await pool.query(
    `SELECT id, estimate_price, distance_km, duration_min, offer_expires_at, service_tier,
            package_description,
            ST_Y(destination_point::geometry) AS dest_lat, ST_X(destination_point::geometry) AS dest_lng
     FROM rides
     WHERE candidate_driver_id = $1 AND status = 'REQUESTED' AND offer_expires_at > now()
     ORDER BY requested_at ASC LIMIT 1`,
    [req.user.id]
  );

  if (!result.rows[0]) return res.json({ offer: null });
  res.json({ offer: result.rows[0] });
});

// GET /api/v1/drivers/active-ride — retrouve la course en cours du pilote (si il en a une),
// utile pour ré-afficher automatiquement l'écran de suivi après une reconnexion
// (fermeture accidentelle de l'app, redémarrage du téléphone, coupure réseau).
router.get('/active-ride', requireAuth, requireRole('CHAUFFEUR'), async (req, res) => {
  const result = await pool.query(
    `SELECT id FROM rides WHERE driver_id = $1 AND status IN ('MATCHED', 'ONGOING') LIMIT 1`,
    [req.user.id]
  );
  res.json({ ride_id: result.rows[0]?.id || null });
});

// GET /api/v1/drivers/kyc/status — l'état de chaque document requis, pour afficher
// une checklist claire au pilote (soumis / en attente / vérifié / rejeté).
router.get('/kyc/status', requireAuth, requireRole('CHAUFFEUR'), async (req, res) => {
  const result = await pool.query(
    `SELECT DISTINCT ON (doc_type) doc_type, status, created_at, reviewed_at
     FROM kyc_documents WHERE user_id = $1
     ORDER BY doc_type, created_at DESC`,
    [req.user.id]
  );
  const byType = Object.fromEntries(result.rows.map(r => [r.doc_type, { status: r.status, submitted_at: r.created_at, reviewed_at: r.reviewed_at }]));

  const documents = REQUIRED_KYC_DOC_TYPES.map(docType => ({
    doc_type: docType,
    status: byType[docType]?.status || 'NON_SOUMIS',
    submitted_at: byType[docType]?.submitted_at || null,
  }));

  const allVerified = documents.every(d => d.status === 'VERIFIED');
  res.json({ documents, all_verified: allVerified });
});

// POST /api/v1/drivers/kyc/upload — soumission (ou resoumission après rejet) d'un document.
// NOTE MVP : comme pour la photo véhicule, le fichier est stocké en base64 directement
// dans file_url (pas de vrai service de stockage cloud type S3/Firebase Storage branché
// pour l'instant) — à remplacer avant un vrai passage à l'échelle.
router.post('/kyc/upload', requireAuth, requireRole('CHAUFFEUR'), async (req, res) => {
  const { doc_type, file_base64 } = req.body;
  if (!REQUIRED_KYC_DOC_TYPES.includes(doc_type)) {
    return res.status(400).json({ error: `doc_type doit être l'un de : ${REQUIRED_KYC_DOC_TYPES.join(', ')}` });
  }
  if (!file_base64) return res.status(400).json({ error: 'file_base64 est requis' });

  const result = await pool.query(
    `INSERT INTO kyc_documents (user_id, doc_type, file_url, status)
     VALUES ($1, $2, $3, 'PENDING')
     RETURNING id, doc_type, status, created_at`,
    [req.user.id, doc_type, file_base64]
  );
  res.status(201).json(result.rows[0]);
});

// GET /api/v1/drivers/me/achievements — badges calculés à partir des vraies
// données de la plateforme (note, volume, fiabilité), jamais de valeur
// inventée. Seuils choisis pour rester atteignables tôt (le lancement vient
// de commencer) mais significatifs — à ajuster avec l'utilisateur une fois
// un vrai volume de courses observé.
router.get('/me/achievements', requireAuth, requireRole('CHAUFFEUR'), async (req, res) => {
  const result = await pool.query(
    `SELECT
       u.rating_avg,
       u.created_at AS member_since,
       COUNT(r.id) FILTER (WHERE r.status = 'COMPLETED') AS total_completed_trips,
       COUNT(r.id) FILTER (WHERE r.status = 'COMPLETED' AND r.completed_at > now() - interval '30 days') AS completed_trips_last_30d,
       COUNT(r.id) FILTER (WHERE r.status = 'CANCELLED' AND r.cancelled_by = u.id) AS cancelled_by_driver
     FROM users u
     LEFT JOIN rides r ON r.driver_id = u.id
     WHERE u.id = $1
     GROUP BY u.id, u.rating_avg, u.created_at`,
    [req.user.id]
  );
  const s = result.rows[0];
  const totalTrips = Number(s.total_completed_trips);
  const cancelledByDriver = Number(s.cancelled_by_driver);
  const attemptedTrips = totalTrips + cancelledByDriver;
  const completionRate = attemptedTrips > 0 ? totalTrips / attemptedTrips : null;

  const badges = [
    {
      key: 'FIVE_STAR',
      label: '5 étoiles',
      earned: totalTrips >= 10 && Number(s.rating_avg) >= 4.8,
    },
    {
      key: 'SAFE_DRIVER',
      label: 'Pilote sûr',
      earned: attemptedTrips >= 10 && completionRate !== null && completionRate >= 0.95,
    },
    {
      key: 'TOP_PERFORMER',
      label: 'Top performer',
      earned: Number(s.completed_trips_last_30d) >= 50,
    },
    {
      key: 'RELIABLE',
      label: 'Fiable',
      earned: totalTrips >= 100,
    },
  ];

  res.json({
    rating_avg: Number(s.rating_avg),
    member_since: s.member_since,
    total_completed_trips: totalTrips,
    completed_trips_last_30d: Number(s.completed_trips_last_30d),
    completion_rate: completionRate,
    badges,
  });
});

// GET /api/v1/drivers/heatmap — demande récente agrégée par zone (grille
// ~1,1km), pour montrer au pilote où la demande est la plus forte en ce
// moment. Basé sur les VRAIES demandes de course récentes (pas une donnée
// inventée) — limité au pays du pilote, sur une fenêtre glissante de 3h pour
// rester pertinent (une demande d'il y a 10h n'aide pas à savoir où aller
// maintenant).
router.get('/heatmap', requireAuth, requireRole('CHAUFFEUR'), async (req, res) => {
  const HEATMAP_WINDOW_HOURS = 3;
  const driver = await pool.query('SELECT country_id FROM users WHERE id = $1', [req.user.id]);
  const countryId = driver.rows[0]?.country_id;
  if (!countryId) return res.json({ cells: [], window_hours: HEATMAP_WINDOW_HOURS });

  const result = await pool.query(
    `SELECT
       ROUND(ST_Y(pickup_point::geometry)::numeric, 2) AS lat,
       ROUND(ST_X(pickup_point::geometry)::numeric, 2) AS lng,
       COUNT(*) AS demand_count
     FROM rides
     WHERE requested_at > now() - interval '${HEATMAP_WINDOW_HOURS} hours'
       AND country_id = $1
     GROUP BY lat, lng
     ORDER BY demand_count DESC
     LIMIT 30`,
    [countryId]
  );
  res.json({ cells: result.rows, window_hours: HEATMAP_WINDOW_HOURS });
});

module.exports = router;
