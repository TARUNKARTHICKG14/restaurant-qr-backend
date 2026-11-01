// db/migrate.js
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function runMigration() {
  console.log('Testing connection and applying database schema...');
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await db.query(schemaSql);
    console.log('✅ Database schema applied successfully to Supabase/PostgreSQL!');

    // Check tables
    const res = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    console.log('Existing tables in public schema:', res.rows.map(r => r.table_name));

    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

runMigration();

