// Configuration de l'URL du backend.
// En local (npm start sur ta machine), on laisse vide -> les appels API restent
// relatifs (/api/v1/...), ce qui marche automatiquement puisque le backend sert
// aussi ces pages HTML sur le même serveur.
//
// Une fois déployé sur Firebase Hosting (frontend) + Render (backend), cette
// valeur DOIT pointer vers l'adresse réelle du backend Render.
window.GLORI_YAH_API_BASE = "https://gloria-yah-api.onrender.com";
