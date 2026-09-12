// Script ponctuel : affiche la grille tarifaire actuelle MOTO/Bénin depuis la base.
// Usage : node check-fare.js
require('dotenv').config();
const pool = require('./db/pool');

pool.query(
  `SELECT base_fee, included_km, city_radius_km, cost_per_km_city,
          cost_per_km_suburb, cost_per_min, minimum_fare
   FROM fare_rules WHERE country_id = 'BJ' AND service_tier = 'MOTO'`
).then((result) => {
  console.log(result.rows[0]);
  pool.end();
}).catch((err) => {
  console.error('Erreur :', err.message);
  pool.end();
});
