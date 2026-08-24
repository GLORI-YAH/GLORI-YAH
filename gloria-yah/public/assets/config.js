// Configuration de l'URL du backend.
// En local (npm start sur ta machine), on laisse vide -> les appels API restent
// relatifs (/api/v1/...), ce qui marche automatiquement puisque le backend sert
// aussi ces pages HTML sur le même serveur.
//
// Une fois déployé sur Firebase Hosting (frontend) + Render/Railway (backend),
// remplace la ligne ci-dessous par l'URL réelle de ton backend, ex. :
//   window.GLORI_YAH_API_BASE = "https://gloria-yah-api.onrender.com";

window.GLORI_YAH_API_BASE = "";
