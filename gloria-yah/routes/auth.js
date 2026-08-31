const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { sendOtp, verifyOtp } = require('../services/otp');
const { generateReferralCode, countActiveReferrals, REFERRAL_MILESTONE, REFERRAL_REWARD_FCFA } = require('../services/referral');
const { requireAuth } = require('../middleware/auth');

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
      dev_code: result.dev_code, // ⚠️ présent UNIQUEMENT en mode dégradé (pas de passerelle SMS configurée)
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Échec de l\'envoi du SMS : ' + err.message });
  }
});

// POST /api/v1/auth/otp/verify — vérifie le code, connecte si le compte existe,
// le crée automatiquement sinon (nom optionnel, à compléter plus tard dans le profil).
router.post('/otp/verify', async (req, res) => {
  const { phone_number, code, full_name, country_id, referral_code } = req.body;
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
      const randomLock = require('crypto').randomBytes(32).toString('hex');
      const unusablePasswordHash = await bcrypt.hash(randomLock, 10);

      // Retrouve le parrain éventuel à partir de son code
      let referredBy = null;
      if (referral_code) {
        const referrer = await pool.query('SELECT id FROM users WHERE referral_code = $1', [referral_code.trim().toUpperCase()]);
        if (referrer.rows[0]) referredBy = referrer.rows[0].id;
      }

      // Génère un code de parrainage propre à ce nouveau compte (avec quelques essais
      // en cas de collision très improbable sur la contrainte d'unicité)
      let myReferralCode;
      for (let attempt = 0; attempt < 5; attempt++) {
        myReferralCode = generateReferralCode();
        const exists = await pool.query('SELECT 1 FROM users WHERE referral_code = $1', [myReferralCode]);
        if (!exists.rows[0]) break;
      }

      const insertResult = await pool.query(
        `INSERT INTO users (phone_number, full_name, password_hash, role, country_id, referral_code, referred_by)
         VALUES ($1, $2, $3, 'PASSAGER', $4, $5, $6)
         RETURNING *`,
        [phone_number, full_name || 'Passager', unusablePasswordHash, country_id || null, myReferralCode, referredBy]
      );
      user = insertResult.rows[0];
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, phone_number: user.phone_number },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({
      access_token: token,
      role: user.role,
      user_id: user.id,
      full_name: user.full_name,
      referral_code: user.referral_code,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de la vérification' });
  }
});

// POST /api/v1/auth/register-driver — inscription pilote ET véhicule EN UNE FOIS
// (compte + wallet + véhicule créés dans une seule transaction, tout ou rien —
// si une étape échoue, rien n'est enregistré, pour éviter un compte "à moitié créé").
router.post('/register-driver', async (req, res) => {
  const {
    phone_number, full_name, email, birth_date, password,
    plate_number, color, photo_url, exploitation_mode, country_id, service_tier,
  } = req.body;

  if (!phone_number || !full_name || !password || !plate_number || !color || !service_tier) {
    return res.status(400).json({ error: 'phone_number, full_name, password, plate_number, color et service_tier sont requis' });
  }

  if (birth_date) {
    const age = (Date.now() - new Date(birth_date).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (age < 18) return res.status(400).json({ error: 'Le pilote doit être majeur (18 ans minimum)' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const hash = await bcrypt.hash(password, 10);

    let myReferralCode;
    for (let attempt = 0; attempt < 5; attempt++) {
      myReferralCode = generateReferralCode();
      const exists = await client.query('SELECT 1 FROM users WHERE referral_code = $1', [myReferralCode]);
      if (!exists.rows[0]) break;
    }

    const userResult = await client.query(
      `INSERT INTO users (phone_number, full_name, email, birth_date, password_hash, role, country_id, referral_code)
       VALUES ($1, $2, $3, $4, $5, 'CHAUFFEUR', $6, $7)
       RETURNING id, phone_number, full_name, role, country_id, referral_code, created_at`,
      [phone_number, full_name, email || null, birth_date || null, hash, country_id || 'BJ', myReferralCode]
    );
    const user = userResult.rows[0];

    await client.query(`INSERT INTO wallets (user_id) VALUES ($1)`, [user.id]);

    const vehicleResult = await client.query(
      `INSERT INTO vehicles (owner_id, plate_number, color, photo_url, exploitation_mode, country_id, photo_verified, service_tier)
       VALUES ($1, $2, $3, $4, $5, $6, false, $7)
       RETURNING id, plate_number, color, photo_verified, service_tier`,
      [user.id, plate_number, color, photo_url || null, exploitation_mode || 'MODE_A_PROPRIETAIRE', country_id || 'BJ', service_tier]
    );

    await client.query('COMMIT');

    const token = jwt.sign(
      { id: user.id, role: user.role, phone_number: user.phone_number },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({
      access_token: token,
      user,
      vehicle: vehicleResult.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ce numéro de téléphone est déjà utilisé' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de l\'inscription pilote' });
  } finally {
    client.release();
  }
});

// POST /api/v1/auth/register — inscription classique téléphone+mot de passe
// (conservée pour les pilotes/admin, qui gardent ce mode de connexion)
router.post('/register', async (req, res) => {
  const { phone_number, full_name, password, role, country_id, referral_code, birth_date } = req.body;
  if (!phone_number || !full_name || !password || !role) {
    return res.status(400).json({ error: 'phone_number, full_name, password et role sont requis' });
  }
  if (!['PASSAGER', 'CHAUFFEUR', 'PROPRIETAIRE'].includes(role)) {
    return res.status(400).json({ error: 'role invalide' });
  }
  // Cohérence avec /register-driver : un chauffeur doit être majeur, quel que
  // soit le chemin d'inscription utilisé (audit du 31/08/2026 — cette
  // vérification manquait ici, présente seulement sur /register-driver).
  if (role === 'CHAUFFEUR' && birth_date) {
    const age = (Date.now() - new Date(birth_date).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (age < 18) return res.status(400).json({ error: 'Le pilote doit être majeur (18 ans minimum)' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);

    // Retrouve le parrain éventuel à partir de son code (uniquement pertinent pour les passagers)
    let referredBy = null;
    if (referral_code) {
      const referrer = await pool.query('SELECT id FROM users WHERE referral_code = $1', [referral_code.trim().toUpperCase()]);
      if (referrer.rows[0]) referredBy = referrer.rows[0].id;
    }

    // Génère un code de parrainage propre à ce nouveau compte
    let myReferralCode;
    for (let attempt = 0; attempt < 5; attempt++) {
      myReferralCode = generateReferralCode();
      const exists = await pool.query('SELECT 1 FROM users WHERE referral_code = $1', [myReferralCode]);
      if (!exists.rows[0]) break;
    }

    const result = await pool.query(
      `INSERT INTO users (phone_number, full_name, password_hash, role, country_id, referral_code, referred_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, phone_number, full_name, role, country_id, referral_code`,
      [phone_number, full_name, hash, role, country_id || null, myReferralCode, referredBy]
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
    res.json({ access_token: token, role: user.role, user_id: user.id, created_at: user.created_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de la connexion' });
  }
});

// GET /api/v1/auth/referral/me — le passager consulte son code et sa progression
router.get('/referral/me', requireAuth, async (req, res) => {
  const user = await pool.query(
    'SELECT referral_code, free_ride_credit_fcfa FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!user.rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const activeCount = await countActiveReferrals(req.user.id);
  res.json({
    referral_code: user.rows[0].referral_code,
    free_ride_credit_fcfa: Number(user.rows[0].free_ride_credit_fcfa),
    active_referrals: activeCount,
    milestone: REFERRAL_MILESTONE,
    reward_fcfa: REFERRAL_REWARD_FCFA,
    progress_to_next_milestone: activeCount % REFERRAL_MILESTONE,
  });
});

module.exports = router;
