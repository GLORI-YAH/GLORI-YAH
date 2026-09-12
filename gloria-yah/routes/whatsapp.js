// Réservation de course via WhatsApp (bot conversationnel) — idée retenue du
// tri des propositions Apporio Infolabs (05/09).
//
// ⚠️ SQUELETTE TECHNIQUE, PAS ENCORE FONCTIONNEL EN CONDITIONS RÉELLES : ceci
// utilise l'API officielle WhatsApp Business Cloud (Meta), qui demande :
//  1. Un compte Meta Business + une app configurée sur developers.facebook.com
//  2. Un numéro de téléphone WhatsApp Business vérifié (fourni par Meta ou
//     porté depuis un numéro existant)
//  3. Un jeton d'accès permanent (WHATSAPP_ACCESS_TOKEN) et l'ID du numéro de
//     téléphone (WHATSAPP_PHONE_NUMBER_ID)
//  4. Un jeton de vérification de webhook choisi par nous (WHATSAPP_VERIFY_TOKEN),
//     à renseigner aussi dans la configuration du webhook côté Meta
// Tant que ces identifiants ne sont pas configurés, ce code ne peut être
// testé qu'en appelant directement POST /api/v1/whatsapp/webhook à la main
// (curl/Postman) avec un corps simulant le format envoyé par Meta — jamais
// depuis un vrai téléphone. Même limitation de principe que pour le SMS et
// l'USSD (voir routes/ussd.js) : bloqué par un compte/fournisseur externe à
// obtenir, pas par du code manquant ici.
//
// Conversation calquée sur le menu USSD existant, pour rester cohérente et
// familière (même destinations connues, même logique de tarif) — le point de
// départ est aussi supposé être Cotonou centre par défaut, comme en USSD,
// faute de vraie géolocalisation possible dans un simple message texte.

const express = require('express');
const pool = require('../db/pool');
const bcrypt = require('bcryptjs');
const { haversineKm, estimateDurationMin, computeFare } = require('../services/pricing');
const { attemptMatch } = require('../services/matching');

const router = express.Router();

const WHATSAPP_DESTINATIONS = [
  { label: 'Akpakpa', lat: 6.3664, lng: 2.4558 },
  { label: 'Cadjèhoun', lat: 6.3617, lng: 2.3800 },
  { label: 'Dantokpa', lat: 6.3707, lng: 2.4256 },
  { label: 'Calavi', lat: 6.4485, lng: 2.3389 },
  { label: 'Godomey', lat: 6.4015, lng: 2.3273 },
];

// État de conversation par numéro de téléphone — en mémoire, donc perdu si le
// serveur redémarre et pas partagé entre plusieurs instances (suffisant pour
// une seule instance Render comme actuellement ; à migrer vers Redis ou une
// table dédiée si GLORIYAH tourne un jour sur plusieurs instances).
const conversationState = new Map();

async function findOrCreateWhatsappUser(phoneNumber) {
  const existing = await pool.query('SELECT id FROM users WHERE phone_number = $1', [phoneNumber]);
  if (existing.rows[0]) return existing.rows[0].id;

  const randomLock = require('crypto').randomBytes(32).toString('hex');
  const unusableHash = await bcrypt.hash(randomLock, 10);
  const result = await pool.query(
    `INSERT INTO users (phone_number, full_name, password_hash, role, country_id)
     VALUES ($1, 'Passager WhatsApp', $2, 'PASSAGER', 'BJ')
     RETURNING id`,
    [phoneNumber, unusableHash]
  );
  return result.rows[0].id;
}

// Envoie un message texte via l'API WhatsApp Cloud — ne fait rien (juste un
// avertissement en log) si les identifiants ne sont pas configurés, pour ne
// jamais faire planter le reste du flux pendant qu'on attend l'accès Meta.
async function envoyerMessageWhatsapp(to, body) {
  if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    console.warn('WhatsApp non configuré (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID manquants) — message non envoyé :', body);
    return;
  }
  try {
    await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    });
  } catch (err) {
    console.error('Erreur envoi message WhatsApp :', err.message);
  }
}

function menuPrincipal() {
  return 'Bienvenue sur GLORIYAH 👋\n' +
    '1. Réserver une course\n' +
    '2. Mon parrainage\n' +
    '3. Aide\n\n' +
    'Réponds avec le numéro de ton choix.';
}

function menuDestinations() {
  const menu = WHATSAPP_DESTINATIONS.map((d, i) => `${i + 1}. ${d.label}`).join('\n');
  return `Où vas-tu ?\n${menu}\n\nRéponds avec le numéro de ta destination.`;
}

// Traite un message entrant et retourne la réponse à envoyer — logique pure,
// séparée de l'appel réseau WhatsApp, pour rester testable directement (ex.
// en dev, avant même d'avoir les identifiants Meta).
async function traiterMessage(phoneNumber, texte) {
  const messageNormalise = (texte || '').trim();
  const etat = conversationState.get(phoneNumber) || { step: 'MENU' };

  // Toujours possible de revenir au menu principal en tapant "0" ou "menu"
  if (['0', 'menu'].includes(messageNormalise.toLowerCase())) {
    conversationState.set(phoneNumber, { step: 'MENU' });
    return menuPrincipal();
  }

  if (etat.step === 'MENU') {
    if (messageNormalise === '1') {
      conversationState.set(phoneNumber, { step: 'CHOIX_DESTINATION' });
      return menuDestinations();
    }
    if (messageNormalise === '2') {
      const user = await pool.query(
        'SELECT referral_code, free_ride_credit_fcfa FROM users WHERE phone_number = $1',
        [phoneNumber]
      );
      if (!user.rows[0]) return 'Aucun compte trouvé avec ce numéro. Réserve une course pour en créer un automatiquement. Tape 0 pour le menu.';
      const u = user.rows[0];
      return `Ton code de parrainage : ${u.referral_code}\nCrédit course gratuite : ${u.free_ride_credit_fcfa} FCFA\n\nTape 0 pour le menu.`;
    }
    if (messageNormalise === '3') {
      return 'GLORIYAH — Assistance : contacte le support depuis l\'application ou au numéro affiché sur nos affiches.\n\nTape 0 pour le menu.';
    }
    return menuPrincipal();
  }

  if (etat.step === 'CHOIX_DESTINATION') {
    const idx = parseInt(messageNormalise, 10) - 1;
    const dest = WHATSAPP_DESTINATIONS[idx];
    if (!dest) return 'Choix invalide. ' + menuDestinations();

    const pickup = { lat: 6.3703, lng: 2.3912 }; // Cotonou centre, par défaut (voir note en tête de fichier)
    const distanceKm = haversineKm(pickup.lat, pickup.lng, dest.lat, dest.lng);
    const durationMin = estimateDurationMin(distanceKm);

    const fareRule = await pool.query(
      `SELECT * FROM fare_rules WHERE country_id = 'BJ' AND service_tier = 'ESSENTIEL' AND active = true LIMIT 1`
    );
    if (!fareRule.rows[0]) return 'Service indisponible pour le moment. Tape 0 pour le menu.';

    const price = computeFare(fareRule.rows[0], distanceKm, durationMin);
    conversationState.set(phoneNumber, {
      step: 'CONFIRMATION',
      destIdx: idx,
      price: Math.round(price),
      distanceKm,
      durationMin,
    });

    return `Trajet vers ${dest.label}\n` +
      `Prix estimé : ${Math.round(price)} FCFA\n` +
      `Distance : ${distanceKm.toFixed(1)} km\n\n` +
      `1. Confirmer\n2. Annuler`;
  }

  if (etat.step === 'CONFIRMATION') {
    if (messageNormalise !== '1') {
      conversationState.set(phoneNumber, { step: 'MENU' });
      return 'Course annulée. ' + menuPrincipal();
    }

    const dest = WHATSAPP_DESTINATIONS[etat.destIdx];
    if (!dest) { conversationState.set(phoneNumber, { step: 'MENU' }); return 'Erreur — recommence. ' + menuPrincipal(); }

    const userId = await findOrCreateWhatsappUser(phoneNumber);
    const pickup = { lat: 6.3703, lng: 2.3912 };

    const fareRule = await pool.query(
      `SELECT * FROM fare_rules WHERE country_id = 'BJ' AND service_tier = 'ESSENTIEL' AND active = true LIMIT 1`
    );
    if (!fareRule.rows[0]) { conversationState.set(phoneNumber, { step: 'MENU' }); return 'Service indisponible. ' + menuPrincipal(); }

    const insertResult = await pool.query(
      `INSERT INTO rides (passenger_id, fare_rule_id, country_id, currency_code, service_tier,
         pickup_point, destination_point, status, distance_km, duration_min, estimate_price, payment_method)
       VALUES ($1, $2, 'BJ', 'XOF', 'ESSENTIEL',
         ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
         ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
         'REQUESTED', $7, $8, $9, 'CASH')
       RETURNING id`,
      [userId, fareRule.rows[0].id, pickup.lng, pickup.lat, dest.lng, dest.lat, etat.distanceKm, etat.durationMin, etat.price]
    );

    await attemptMatch(insertResult.rows[0]);
    conversationState.set(phoneNumber, { step: 'MENU' });

    return `Course commandée vers ${dest.label} ! Un pilote va bientôt être recherché.\n` +
      `Prix estimé : ${etat.price} FCFA.\n\nTape 0 pour le menu.`;
  }

  conversationState.set(phoneNumber, { step: 'MENU' });
  return menuPrincipal();
}

// GET /api/v1/whatsapp/webhook — étape de vérification exigée par Meta lors
// de la configuration du webhook (une seule fois, dans leur interface).
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// POST /api/v1/whatsapp/webhook — reçoit les messages entrants envoyés par
// Meta au format WhatsApp Cloud API, et répond avec le message texte suivant.
//
// ⚠️ AVANT D'ACTIVER EN PRODUCTION : cette route ne vérifie pas encore que la
// requête provient bien de Meta (signature HMAC dans l'en-tête
// X-Hub-Signature-256, calculée avec le "App Secret" de l'app Meta — pas le
// même que WHATSAPP_ACCESS_TOKEN). Tant que les identifiants WhatsApp ne sont
// pas configurés, ce n'est pas exploitable (l'URL ne sert à rien sans eux) —
// mais dès que WHATSAPP_ACCESS_TOKEN est renseigné, n'importe qui connaissant
// cette URL pourrait en théorie envoyer de fausses requêtes qui créeraient de
// vraies courses. À ajouter avant la mise en ligne réelle : vérifier la
// signature avec crypto.createHmac('sha256', APP_SECRET) avant de traiter le
// corps de la requête.
router.post('/webhook', async (req, res) => {
  // On répond 200 immédiatement quoi qu'il arrive (exigence Meta — sinon ils
  // considèrent le webhook en échec et arrêtent de nous envoyer les messages),
  // le traitement réel se fait ensuite sans bloquer cette réponse.
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = entry?.messages?.[0];
    if (!message || message.type !== 'text') return; // ignore statuts de livraison, médias, etc. pour l'instant

    const phoneNumber = message.from;
    const texte = message.text?.body || '';

    const reponse = await traiterMessage(phoneNumber, texte);
    await envoyerMessageWhatsapp(phoneNumber, reponse);
  } catch (err) {
    console.error('Erreur traitement message WhatsApp :', err.message);
  }
});

module.exports = router;
