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
        
        -- Add conversation_id to link with conversations table (will add reference later)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='conversation_id') THEN
          ALTER TABLE messages ADD COLUMN conversation_id UUID;
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

    // Create tenants table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        
        -- Bot Settings
        global_bot_status VARCHAR(20) DEFAULT 'active',
        auto_handover_enabled BOOLEAN DEFAULT true,
        negativity_detection_enabled BOOLEAN DEFAULT true,
        
        -- Admin contact
        admin_zalo_id TEXT,
        
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        is_active BOOLEAN DEFAULT true
      );
    `);

    // Create conversations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_key TEXT NOT NULL,
        
        thread_id TEXT NOT NULL,
        
        -- Conversation status
        bot_status VARCHAR(20) DEFAULT 'active',
        last_activity_at TIMESTAMPTZ DEFAULT NOW(),
        
        -- Customer info (extracted by AI)
        customer_name TEXT,
        customer_phone TEXT,
        customer_address TEXT,
        customer_products JSONB,
        
        -- Handover info
        assigned_staff_id UUID,
        handover_reason TEXT,
        handover_at TIMESTAMPTZ,
        
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        
        UNIQUE(session_key, thread_id)
      );
    `);

    // Create staff table
    await client.query(`
      CREATE TABLE IF NOT EXISTS staff (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        
        zalo_uid TEXT NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        
        -- Permissions
        can_control_bot BOOLEAN DEFAULT false,
        can_view_all_conversations BOOLEAN DEFAULT false,
        can_manage_staff BOOLEAN DEFAULT false,
        
        -- Liên kết với session (nếu cần)
        associated_session_keys TEXT[],
        
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        is_active BOOLEAN DEFAULT true
      );
    `);

    // Create bot_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS bot_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_key TEXT,
        conversation_id UUID REFERENCES conversations(id),
        
        action_type VARCHAR(50) NOT NULL,
        actor_type VARCHAR(20) NOT NULL,
        actor_id TEXT,
        
        old_status VARCHAR(50),
        new_status VARCHAR(50),
        reason TEXT,
        
        thread_id TEXT,
        message_id TEXT,
        metadata JSONB,
        
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Create ai_responses table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_responses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_key TEXT NOT NULL,
        conversation_id UUID REFERENCES conversations(id),
        
        user_message TEXT NOT NULL,
        message_type VARCHAR(50),
        image_url TEXT,
        quote_context TEXT,
        
        ai_reply TEXT,
        ai_images JSONB,
        
        customer_info JSONB,
        human_handover_required BOOLEAN DEFAULT false,
        has_negativity BOOLEAN DEFAULT false,
        confidence_score DECIMAL(3,2),
        
        model_used VARCHAR(50),
        processing_time_ms INTEGER,
        
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Create notification_queue table
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_queue (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_key TEXT,
        conversation_id UUID REFERENCES conversations(id),
        
        notification_type VARCHAR(50) NOT NULL,
        priority VARCHAR(20) DEFAULT 'normal',
        
        target_staff_ids UUID[],
        target_group_id TEXT,
        
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata JSONB,
        
        status VARCHAR(20) DEFAULT 'pending',
        sent_at TIMESTAMPTZ,
        retry_count INTEGER DEFAULT 0,
        
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Add foreign key constraints after all tables are created
    await client.query(`
      DO $$
      BEGIN
        -- Add foreign key constraint for messages.conversation_id
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = 'messages_conversation_id_fkey' 
          AND table_name = 'messages'
        ) THEN
          ALTER TABLE messages ADD CONSTRAINT messages_conversation_id_fkey 
          FOREIGN KEY (conversation_id) REFERENCES conversations(id);
        END IF;
      END $$;
    `);

    // Create indexes for new tables after all tables are created
    await client.query(`
      DO $$
      BEGIN
        -- Conversations indexes
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'conversations' AND indexname = 'idx_conversations_session'
        ) THEN
          CREATE INDEX idx_conversations_session ON conversations(session_key, bot_status);
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'conversations' AND indexname = 'idx_conversations_thread'
        ) THEN
          CREATE INDEX idx_conversations_thread ON conversations(session_key, thread_id);
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'conversations' AND indexname = 'idx_conversations_staff'
        ) THEN
          CREATE INDEX idx_conversations_staff ON conversations(assigned_staff_id) WHERE assigned_staff_id IS NOT NULL;
        END IF;
        
        -- Staff indexes
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'staff' AND indexname = 'idx_staff_role'
        ) THEN
          CREATE INDEX idx_staff_role ON staff(role) WHERE is_active = true;
        END IF;
        
        -- Bot logs indexes
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'bot_logs' AND indexname = 'idx_bot_logs_session'
        ) THEN
          CREATE INDEX idx_bot_logs_session ON bot_logs(session_key, created_at DESC);
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'bot_logs' AND indexname = 'idx_bot_logs_conversation'
        ) THEN
          CREATE INDEX idx_bot_logs_conversation ON bot_logs(conversation_id, created_at DESC);
        END IF;
        
        -- AI responses indexes
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'ai_responses' AND indexname = 'idx_ai_responses_session'
        ) THEN
          CREATE INDEX idx_ai_responses_session ON ai_responses(session_key, created_at DESC);
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'ai_responses' AND indexname = 'idx_ai_responses_handover'
        ) THEN
          CREATE INDEX idx_ai_responses_handover ON ai_responses(session_key, human_handover_required) WHERE human_handover_required = true;
        END IF;
        
        -- Notification queue indexes
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'notification_queue' AND indexname = 'idx_notifications_status'
        ) THEN
          CREATE INDEX idx_notifications_status ON notification_queue(status, priority, created_at);
        END IF;
        
        -- Messages conversation link index
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'messages' AND indexname = 'idx_messages_conversation'
        ) THEN
          CREATE INDEX idx_messages_conversation ON messages(conversation_id, ts DESC) WHERE conversation_id IS NOT NULL;
        END IF;
      END $$;
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
