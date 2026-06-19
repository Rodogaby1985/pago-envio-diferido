import fs from 'fs';
import path from 'path';
import { getPool, closePool } from './client';
import { config } from '../config';

async function runMigrations(): Promise<void> {
  console.log('[migrate] Connecting to database...');
  const pool = getPool();

  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL PRIMARY KEY,
      filename   VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const exists = await pool.query(
      'SELECT id FROM _migrations WHERE filename = $1',
      [file]
    );

    if (exists.rows.length > 0) {
      console.log(`[migrate] Skipping already applied: ${file}`);
      continue;
    }

    console.log(`[migrate] Applying migration: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] Applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migrate] Error applying ${file}:`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log('[migrate] All migrations applied successfully.');
}

runMigrations()
  .then(() => closePool())
  .catch((err) => {
    console.error('[migrate] Fatal error:', err);
    closePool().finally(() => process.exit(1));
  });
