const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/v1/addresses/saved — adresses favorites (Domicile, Travail, etc.)
router.get('/saved', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT id, label, address_text,
            ST_Y(position::geometry) AS lat, ST_X(position::geometry) AS lng
     FROM saved_addresses WHERE user_id = $1 ORDER BY created_at ASC`,
    [req.user.id]
  );
  res.json(result.rows);
});

// POST /api/v1/addresses/saved — ajouter une adresse favorite
router.post('/saved', requireAuth, async (req, res) => {
  const { label, address_text, lat, lng } = req.body;
  if (!label || !address_text || lat == null || lng == null) {
    return res.status(400).json({ error: 'label, address_text, lat et lng sont requis' });
  }

  const result = await pool.query(
    `INSERT INTO saved_addresses (user_id, label, address_text, position)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography)
     RETURNING id, label, address_text`,
    [req.user.id, label, address_text, lng, lat]
  );
  res.status(201).json(result.rows[0]);
});

// DELETE /api/v1/addresses/saved/:id
router.delete('/saved/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM saved_addresses WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ deleted: true });
});

// GET /api/v1/addresses/recent — destinations récentes (déduites de l'historique de courses)
router.get('/recent', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT DISTINCT ON (destination_point)
            ST_Y(destination_point::geometry) AS lat,
            ST_X(destination_point::geometry) AS lng,
            requested_at
     FROM rides
     WHERE passenger_id = $1
     ORDER BY destination_point, requested_at DESC
     LIMIT 5`,
    [req.user.id]
  );
  res.json(result.rows);
});

module.exports = router;
