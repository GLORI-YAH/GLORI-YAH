// Applique db/schema.sql sur la base pointée par DATABASE_URL.
// Usage : npm run db:init
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function init() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('✔ Schéma GLORIA-YAH appliqué avec succès.');
  } catch (err) {
    console.error('✘ Échec d\'application du schéma :', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

init();
