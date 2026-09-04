const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io = null;
// Associe un user_id (pilote OU passager) à son socket actuellement connecté.
// Un utilisateur peut avoir plusieurs onglets/appareils ouverts — on garde le
// PLUS RÉCENT (le plus probable d'être l'appareil réellement utilisé).
const socketsByUserId = new Map();

/**
 * Initialise Socket.io sur le serveur HTTP existant. Chaque connexion doit
 * s'authentifier avec le même jeton JWT que l'API REST (pas de système
 * d'identité séparé) — évite d'ouvrir une deuxième surface d'authentification
 * à sécuriser.
 *
 * IMPORTANT : ceci est un COMPLÉMENT au sondage existant (polling), pas un
 * remplacement — le sondage continue de tourner comme filet de sécurité, vu
 * l'instabilité réseau fréquente en 3G/4G. Si la connexion WebSocket échoue
 * ou se coupe, le pilote continue de recevoir ses offres via le sondage,
 * juste un peu moins vite.
 */
function initSocket(server) {
  io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Jeton manquant'));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = payload.id;
      socket.role = payload.role;
      next();
    } catch (err) {
      next(new Error('Jeton invalide ou expiré'));
    }
  });

  io.on('connection', (socket) => {
    socketsByUserId.set(socket.userId, socket.id);
    socket.on('disconnect', () => {
      // Ne retire que si c'est bien CE socket qui est enregistré (évite
      // qu'une déconnexion tardive d'un ancien onglet efface l'enregistrement
      // d'un onglet plus récent du même utilisateur).
      if (socketsByUserId.get(socket.userId) === socket.id) {
        socketsByUserId.delete(socket.userId);
      }
    });
  });

  console.log('✅ Socket.io initialisé — notifications instantanées de courses actives');
  return io;
}

/**
 * Pousse une offre de course instantanément au pilote s'il a une connexion
 * WebSocket active. Ne fait rien silencieusement sinon (le sondage prendra
 * le relais dans les secondes qui suivent — jamais d'erreur bloquante ici).
 */
function notifierNouvelleOffre(driverId, offerData) {
  if (!io) return;
  const socketId = socketsByUserId.get(driverId);
  if (socketId) {
    io.to(socketId).emit('ride_offer', offerData);
  }
}

/**
 * Pousse une mise à jour de statut de course au passager instantanément
 * (pilote a accepté, est arrivé, course terminée...) au lieu qu'il attende le
 * prochain sondage (jusqu'à 3 secondes). Même principe : simple complément,
 * le sondage reste le filet de sécurité.
 */
function notifierMiseAJourCourse(passengerId, statusData) {
  if (!io) return;
  const socketId = socketsByUserId.get(passengerId);
  if (socketId) {
    io.to(socketId).emit('ride_status_update', statusData);
  }
}

module.exports = { initSocket, notifierNouvelleOffre, notifierMiseAJourCourse };
