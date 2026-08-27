require('dotenv').config();
const pool = require('./db/pool');
const phone = process.argv[2];
pool.query('UPDATE users SET role = $1 WHERE phone_number = $2', ['ADMIN', phone])
  .then(r => { console.log('Lignes modifiées :', r.rowCount); process.exit(); })
  .catch(err => { console.error('Erreur :', err.message); process.exit(1); });
