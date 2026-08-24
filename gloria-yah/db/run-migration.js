// Applique un fichier de migration SQL donné en argument sur DATABASE_URL.
// Usage : node db/run-migration.js db/migrations/002_add_country_fare_rules.sql
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error('Usage : node db/run-migration.js <chemin-du-fichier.sql>');
  process.exit(1);
}

async function run() {
  const sql = fs.readFileSync(path.resolve(migrationFile), 'utf8');
  try {
    await pool.query(sql);
    console.log(`✔ Migration appliquée avec succès : ${migrationFile}`);
  } catch (err) {
    console.error(`✘ Échec de la migration : ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
