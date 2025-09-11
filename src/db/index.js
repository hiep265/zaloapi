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

    // Create messages table if not exists (non-destructive)
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_key TEXT NOT NULL,
        account_id TEXT,
        
        -- Routing/Identity fields
        type INTEGER, -- 0 = private message, 1 = group
        thread_id TEXT, -- conversation thread ID
        id_to TEXT, -- destination ID (group ID or user ID)
        uid_from TEXT, -- sender ID
        d_name TEXT, -- sender display name
        is_self BOOLEAN DEFAULT false, -- is message from current user
        
        -- Message content
        content TEXT,
        msg_type TEXT, -- e.g. "webchat"
        property_ext JSONB, -- display info (emoji, colors, link parsing)
        quote JSONB, -- quoted/replied message info
        mentions JSONB, -- array of mentioned users in group
        attachments_json JSONB,
        
        -- IDs and timing
        ts BIGINT, -- timestamp
        msg_id TEXT, -- server-assigned message ID
        cli_msg_id TEXT, -- client-generated temporary ID
        global_msg_id TEXT, -- original message ID for replies
        real_msg_id TEXT DEFAULT '0', -- special message mapping
        
        -- System/Status fields
        cmd INTEGER, -- packet command code (501, 521, etc)
        st INTEGER, -- packet status (3 = normal/ok)
        status INTEGER, -- send/receive status (1 = success)
        ttl INTEGER DEFAULT 0, -- time to live (0 = unlimited)
        notify INTEGER DEFAULT 1, -- 1 = notify, 0 = silent
        top_out BOOLEAN DEFAULT false,
        top_out_time_out BIGINT,
        top_out_impr_time_out BIGINT,
        action_id TEXT, -- internal action ID for tracking
        uin TEXT DEFAULT '0',
        user_id TEXT DEFAULT '0',
        
        -- Extension fields
        params_ext JSONB, -- contains containType, countUnread, platformType
        
        -- Legacy compatibility fields
        thread_type TEXT, -- kept for backward compatibility
        peer_id TEXT, -- kept for backward compatibility
        direction TEXT DEFAULT 'in', -- kept for backward compatibility
        message_id TEXT, -- kept for backward compatibility
        
        -- Raw data
        raw_json JSONB, -- full original message data
        
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Ensure all expected columns exist (idempotent, non-destructive)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='type') THEN
          ALTER TABLE messages ADD COLUMN type INTEGER;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='thread_id') THEN
          ALTER TABLE messages ADD COLUMN thread_id TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='id_to') THEN
          ALTER TABLE messages ADD COLUMN id_to TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='uid_from') THEN
          ALTER TABLE messages ADD COLUMN uid_from TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='d_name') THEN
          ALTER TABLE messages ADD COLUMN d_name TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='is_self') THEN
          ALTER TABLE messages ADD COLUMN is_self BOOLEAN DEFAULT false;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='property_ext') THEN
          ALTER TABLE messages ADD COLUMN property_ext JSONB;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='quote') THEN
          ALTER TABLE messages ADD COLUMN quote JSONB;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='mentions') THEN
          ALTER TABLE messages ADD COLUMN mentions JSONB;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='ts') THEN
          ALTER TABLE messages ADD COLUMN ts BIGINT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='msg_id') THEN
          ALTER TABLE messages ADD COLUMN msg_id TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='cli_msg_id') THEN
          ALTER TABLE messages ADD COLUMN cli_msg_id TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='global_msg_id') THEN
          ALTER TABLE messages ADD COLUMN global_msg_id TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='real_msg_id') THEN
          ALTER TABLE messages ADD COLUMN real_msg_id TEXT DEFAULT '0';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='st') THEN
          ALTER TABLE messages ADD COLUMN st INTEGER;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='status') THEN
          ALTER TABLE messages ADD COLUMN status INTEGER;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='ttl') THEN
          ALTER TABLE messages ADD COLUMN ttl INTEGER DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='notify') THEN
          ALTER TABLE messages ADD COLUMN notify INTEGER DEFAULT 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='top_out') THEN
          ALTER TABLE messages ADD COLUMN top_out BOOLEAN DEFAULT false;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='top_out_time_out') THEN
          ALTER TABLE messages ADD COLUMN top_out_time_out BIGINT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='top_out_impr_time_out') THEN
          ALTER TABLE messages ADD COLUMN top_out_impr_time_out BIGINT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='action_id') THEN
          ALTER TABLE messages ADD COLUMN action_id TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='uin') THEN
          ALTER TABLE messages ADD COLUMN uin TEXT DEFAULT '0';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='user_id') THEN
          ALTER TABLE messages ADD COLUMN user_id TEXT DEFAULT '0';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='params_ext') THEN
          ALTER TABLE messages ADD COLUMN params_ext JSONB;
        END IF;
      END $$;
    `);

    // Create indexes for better query performance
    await client.query(`
      DO $$
      BEGIN
        -- Unique index to prevent duplicates per session
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'messages' AND indexname = 'uniq_messages_session_msgid'
        ) THEN
          CREATE UNIQUE INDEX uniq_messages_session_msgid ON messages(session_key, msg_id);
        END IF;
        
        -- Index for thread-based queries (conversation view)
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'messages' AND indexname = 'idx_messages_thread'
        ) THEN
          CREATE INDEX idx_messages_thread ON messages(session_key, thread_id, ts DESC);
        END IF;
        
        -- Index for user-based queries
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'messages' AND indexname = 'idx_messages_user'
        ) THEN
          CREATE INDEX idx_messages_user ON messages(session_key, uid_from, ts DESC);
        END IF;
        
        -- Index for timestamp-based queries
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'messages' AND indexname = 'idx_messages_timestamp'
        ) THEN
          CREATE INDEX idx_messages_timestamp ON messages(session_key, ts DESC);
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
