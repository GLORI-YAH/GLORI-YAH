const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { sendOtp, verifyOtp } = require('../services/otp');

const router = express.Router();

// POST /api/v1/auth/otp/send — envoie un code par SMS au numéro donné
// (utilisé aussi bien pour l'inscription que la connexion — pas besoin de
// savoir à l'avance si le compte existe déjà, comme chez Gozem/Yango).
router.post('/otp/send', async (req, res) => {
  const { phone_number } = req.body;
  if (!phone_number) return res.status(400).json({ error: 'phone_number est requis' });

  try {
    const result = await sendOtp(phone_number);
    res.json({
      sent: result.sent !== false,
      note: result.sent === false ? result.reason : undefined,
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Échec de l\'envoi du SMS : ' + err.message });
  }
});

// POST /api/v1/auth/otp/verify — vérifie le code, connecte si le compte existe,
// le crée automatiquement sinon (nom optionnel, à compléter plus tard dans le profil).
router.post('/otp/verify', async (req, res) => {
  const { phone_number, code, full_name, country_id } = req.body;
  if (!phone_number || !code) return res.status(400).json({ error: 'phone_number et code sont requis' });

  try {
    const verification = await verifyOtp(phone_number, code);
    if (!verification.valid) {
      return res.status(401).json({ error: verification.reason });
    }

    let result = await pool.query('SELECT * FROM users WHERE phone_number = $1', [phone_number]);
    let user = result.rows[0];

    if (!user) {
      // Première connexion avec ce numéro : création automatique du compte passager.
      // Pas de mot de passe utilisable pour un compte OTP — on hash une valeur
      // aléatoire imprévisible pour que /auth/login échoue proprement (bcrypt.compare
      // renvoie false) plutôt que de planter sur un hash invalide.
      const randomLock = require('crypto').randomBytes(32).toString('hex');
      const unusablePasswordHash = await bcrypt.hash(randomLock, 10);
      const insertResult = await pool.query(
        `INSERT INTO users (phone_number, full_name, password_hash, role, country_id)
         VALUES ($1, $2, $3, 'PASSAGER', $4)
         RETURNING *`,
        [phone_number, full_name || 'Passager', unusablePasswordHash, country_id || null]
      );
      user = insertResult.rows[0];
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, phone_number: user.phone_number },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ access_token: token, role: user.role, user_id: user.id, full_name: user.full_name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de la vérification' });
  }
});

// POST /api/v1/auth/register — inscription classique téléphone+mot de passe
// (conservée pour les pilotes/admin, qui gardent ce mode de connexion)
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
