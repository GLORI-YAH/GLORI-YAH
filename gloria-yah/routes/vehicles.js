const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/v1/vehicles — déclaration d'un véhicule (base de sécurité : photo, plaque, couleur)
// NOTE : file d'upload réel (S3/Firebase Storage/etc.) à brancher en amont ; ici on
// reçoit directement une URL déjà hébergée (photo_url) pour rester simple dans ce squelette.
router.post('/', requireAuth, async (req, res) => {
  const { plate_number, make, model, year, color, photo_url, exploitation_mode, country_id } = req.body;
  if (!plate_number || !color || !photo_url || !exploitation_mode) {
    return res.status(400).json({ error: 'plate_number, color, photo_url et exploitation_mode sont requis' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO vehicles
        (owner_id, plate_number, make, model, year, color, photo_url, photo_updated_at, exploitation_mode, country_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9)
       RETURNING id, plate_number, color, photo_verified, kyc_status`,
      [req.user.id, plate_number, make, model, year, color, photo_url, exploitation_mode, country_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cette plaque d\'immatriculation est déjà enregistrée' });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de l\'enregistrement du véhicule' });
  }
});

// PATCH /api/v1/vehicles/:id — mise à jour plaque/couleur/photo (journalisée pour traçabilité sécurité)
router.patch('/:id', requireAuth, async (req, res) => {
  const { plate_number, color, photo_url } = req.body;
  const current = await pool.query('SELECT * FROM vehicles WHERE id = $1', [req.params.id]);
  if (!current.rows[0]) return res.status(404).json({ error: 'Véhicule introuvable' });
  const veh = current.rows[0];

  // CORRECTIF SÉCURITÉ (audit 31/08/2026) : aucune vérification de propriété
  // n'existait ici — n'importe quel utilisateur connecté pouvait modifier la
  // plaque/couleur/photo de n'importe quel véhicule en devinant son UUID.
  const owns = veh.owner_id === req.user.id || veh.assigned_driver_id === req.user.id;
  if (!owns && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Ce véhicule ne vous appartient pas' });
  }

  const changes = [];
  if (plate_number && plate_number !== veh.plate_number) changes.push(['plate_number', veh.plate_number, plate_number]);
  if (color && color !== veh.color) changes.push(['color', veh.color, color]);
  if (photo_url && photo_url !== veh.photo_url) changes.push(['photo_url', veh.photo_url, photo_url]);

  if (changes.length === 0) return res.json(veh);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE vehicles SET
         plate_number = COALESCE($2, plate_number),
         color = COALESCE($3, color),
         photo_url = COALESCE($4, photo_url),
         photo_verified = false,
         photo_updated_at = now()
       WHERE id = $1`,
      [req.params.id, plate_number, color, photo_url]
    );
    for (const [field, oldV, newV] of changes) {
      await client.query(
        `INSERT INTO vehicle_change_log (vehicle_id, changed_field, old_value, new_value, changed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.params.id, field, oldV, newV, req.user.id]
      );
    }
    await client.query('COMMIT');
    res.json({ id: req.params.id, updated_fields: changes.map(c => c[0]), photo_verified: false });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de la mise à jour du véhicule' });
  } finally {
    client.release();
  }
});

// GET /api/v1/vehicles/:id/safety-card — ce que le passager voit avant embarquement
router.get('/:id/safety-card', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT v.plate_number, v.color, v.photo_url, v.photo_verified, v.make, v.model,
            u.full_name AS driver_name, u.driver_photo_url, u.rating_avg
     FROM vehicles v
     LEFT JOIN users u ON u.id = v.assigned_driver_id OR u.id = v.owner_id
     WHERE v.id = $1 LIMIT 1`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Véhicule introuvable' });
  res.json(result.rows[0]);
});

module.exports = router;
