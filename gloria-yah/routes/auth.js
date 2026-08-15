const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const router = express.Router();

// POST /api/v1/auth/register
router.post('/register', async (req, res) => {
  const { phone_number, full_name, password, role, country_id } = req.body;
  if (!phone_number || !full_name || !password || !role) {
    return res.status(400).json({ error: 'phone_number, full_name, password et role sont requis' });
  }
  if (!['PASSAGER', 'CHAUFFEUR', 'PROPRIETAIRE'].includes(role)) {
    return res.status(400).json({ error: 'role invalide' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (phone_number, full_name, password_hash, role, country_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, phone_number, full_name, role, country_id`,
      [phone_number, full_name, hash, role, country_id || null]
    );
    const user = result.rows[0];

    // Un wallet est créé automatiquement pour les chauffeurs/propriétaires
    if (role === 'CHAUFFEUR' || role === 'PROPRIETAIRE') {
      await pool.query(`INSERT INTO wallets (user_id) VALUES ($1)`, [user.id]);
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, phone_number: user.phone_number },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.status(201).json({ user, access_token: token });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ce numéro de téléphone est déjà utilisé' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de l\'inscription' });
  }
});

// POST /api/v1/auth/login
router.post('/login', async (req, res) => {
  const { phone_number, password } = req.body;
  if (!phone_number || !password) {
    return res.status(400).json({ error: 'phone_number et password sont requis' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE phone_number = $1', [phone_number]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Identifiants invalides' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Identifiants invalides' });

    const token = jwt.sign(
      { id: user.id, role: user.role, phone_number: user.phone_number },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ access_token: token, role: user.role, user_id: user.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de la connexion' });
  }
});

module.exports = router;
