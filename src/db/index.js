import { Pool } from 'pg';
import config from '../config/index.js';

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'zaloapi',
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,
});

export async function migrate() {
  // Create tables if they don't exist
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Required for gen_random_uuid()
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id TEXT,
        cookies_json JSONB,
        imei TEXT,
        user_agent TEXT,
        language TEXT,
        session_key TEXT,
        is_active BOOLEAN DEFAULT true,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Ensure session_key column exists (for older deployments)
    await client.query(`DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='sessions' AND column_name='session_key'
      ) THEN
        ALTER TABLE sessions ADD COLUMN session_key TEXT;
      END IF;
    END $$;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_key TEXT NOT NULL,
        account_id TEXT,
        thread_type TEXT,
        peer_id TEXT,
        direction TEXT DEFAULT 'in',
        content TEXT,
        attachments_json JSONB,
        message_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Unique index to prevent duplicates per session
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'messages' AND indexname = 'uniq_messages_session_msgid'
        ) THEN
          CREATE UNIQUE INDEX uniq_messages_session_msgid ON messages(session_key, message_id);
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        external_user_id TEXT UNIQUE NOT NULL,
        zalo_uid TEXT,
        profile_json JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

export default {
  query,
  migrate,
  pool,
};
