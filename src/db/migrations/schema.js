// Schema migrations consolidated here. This file is imported by src/db/index.js and executed within a transaction.

/**
 * Run all idempotent migrations on the provided pg client (in a transaction managed by caller).
 * @param {import('pg').PoolClient} client
 */
export async function runMigrations(client) {
  // Required for gen_random_uuid()
  await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // sessions
  await client.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id TEXT,
      cookies_json JSONB,
      imei TEXT,
      user_agent TEXT,
      language TEXT,
      session_key TEXT,
      api_key TEXT,
      is_active BOOLEAN DEFAULT true,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Ensure columns exist
  await client.query(`DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='sessions' AND column_name='session_key'
    ) THEN
      ALTER TABLE sessions ADD COLUMN session_key TEXT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='sessions' AND column_name='api_key'
    ) THEN
      ALTER TABLE sessions ADD COLUMN api_key TEXT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='sessions' AND column_name='chatbot_priority'
    ) THEN
      ALTER TABLE sessions ADD COLUMN chatbot_priority VARCHAR(20) DEFAULT 'mobile';
    END IF;
  END $$;`);

  // messages
  await client.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_key TEXT NOT NULL,
      account_id TEXT,
      type INTEGER,
      thread_id TEXT,
      id_to TEXT,
      uid_from TEXT,
      d_name TEXT,
      is_self BOOLEAN DEFAULT false,
      content TEXT,
      msg_type TEXT,
      property_ext JSONB,
      quote JSONB,
      mentions JSONB,
      attachments_json JSONB,
      ts BIGINT,
      msg_id TEXT,
      cli_msg_id TEXT,
      global_msg_id TEXT,
      real_msg_id TEXT DEFAULT '0',
      cmd INTEGER,
      st INTEGER,
      status INTEGER,
      ttl INTEGER DEFAULT 0,
      notify INTEGER DEFAULT 1,
      top_out BOOLEAN DEFAULT false,
      top_out_time_out BIGINT,
      top_out_impr_time_out BIGINT,
      action_id TEXT,
      uin TEXT DEFAULT '0',
      user_id TEXT DEFAULT '0',
      params_ext JSONB,
      thread_type TEXT,
      peer_id TEXT,
      direction TEXT DEFAULT 'in',
      message_id TEXT,
      raw_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

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
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='conversation_id') THEN
        ALTER TABLE messages ADD COLUMN conversation_id UUID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='replied') THEN
        ALTER TABLE messages ADD COLUMN replied BOOLEAN DEFAULT false;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='replied_at') THEN
        ALTER TABLE messages ADD COLUMN replied_at TIMESTAMPTZ;
      END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE tablename = 'messages' AND indexname = 'uniq_messages_session_msgid'
      ) THEN
        CREATE UNIQUE INDEX uniq_messages_session_msgid ON messages(session_key, msg_id);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE tablename = 'messages' AND indexname = 'idx_messages_thread'
      ) THEN
        CREATE INDEX idx_messages_thread ON messages(session_key, thread_id, ts DESC);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE tablename = 'messages' AND indexname = 'idx_messages_user'
      ) THEN
        CREATE INDEX idx_messages_user ON messages(session_key, uid_from, ts DESC);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE tablename = 'messages' AND indexname = 'idx_messages_timestamp'
      ) THEN
        CREATE INDEX idx_messages_timestamp ON messages(session_key, ts DESC);
      END IF;
    END $$;
  `);

  // users
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

  // tenants
  await client.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      global_bot_status VARCHAR(20) DEFAULT 'active',
      auto_handover_enabled BOOLEAN DEFAULT true,
      negativity_detection_enabled BOOLEAN DEFAULT true,
      admin_zalo_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      is_active BOOLEAN DEFAULT true
    );
  `);

  // conversations
  await client.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_key TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      bot_status VARCHAR(20) DEFAULT 'active',
      last_activity_at TIMESTAMPTZ DEFAULT NOW(),
      customer_name TEXT,
      customer_phone TEXT,
      customer_address TEXT,
      customer_products JSONB,
      assigned_staff_id UUID,
      handover_reason TEXT,
      handover_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(session_key, thread_id)
    );
  `);

  // ignored_conversations
  await client.query(`
    CREATE TABLE IF NOT EXISTS ignored_conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_key TEXT,
      user_id TEXT,
      thread_id TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(session_key, thread_id)
    );
  `);

  // staff
  await client.query(`
    CREATE TABLE IF NOT EXISTS staff (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      zalo_uid TEXT NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL,
      can_control_bot BOOLEAN DEFAULT false,
      can_manage_orders BOOLEAN DEFAULT false,
      can_receive_notifications BOOLEAN DEFAULT true,
      associated_session_keys TEXT[],
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      is_active BOOLEAN DEFAULT true
    );
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='staff' AND column_name='can_manage_orders'
      ) THEN
        ALTER TABLE staff ADD COLUMN can_manage_orders BOOLEAN DEFAULT false;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='staff' AND column_name='can_receive_notifications'
      ) THEN
        ALTER TABLE staff ADD COLUMN can_receive_notifications BOOLEAN DEFAULT true;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='staff' AND column_name='can_view_all_conversations'
      ) THEN
        ALTER TABLE staff DROP COLUMN can_view_all_conversations;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='staff' AND column_name='can_manage_staff'
      ) THEN
        ALTER TABLE staff DROP COLUMN can_manage_staff;
      END IF;
    END $$;
  `);

  // bot_logs
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

  // ai_responses
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

  // notification_queue
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

  // Foreign keys and indexes
  await client.query(`
    DO $$
    BEGIN
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

  await client.query(`
    DO $$
    BEGIN
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
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE tablename = 'ignored_conversations' AND indexname = 'idx_ignored_conversations_session'
      ) THEN
        CREATE INDEX idx_ignored_conversations_session ON ignored_conversations(session_key, thread_id);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE tablename = 'ignored_conversations' AND indexname = 'idx_ignored_conversations_user'
      ) THEN
        CREATE INDEX idx_ignored_conversations_user ON ignored_conversations(session_key, user_id);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE tablename = 'staff' AND indexname = 'idx_staff_role'
      ) THEN
        CREATE INDEX idx_staff_role ON staff(role) WHERE is_active = true;
      END IF;
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
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE tablename = 'notification_queue' AND indexname = 'idx_notifications_status'
      ) THEN
        CREATE INDEX idx_notifications_status ON notification_queue(status, priority, created_at);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE tablename = 'messages' AND indexname = 'idx_messages_conversation'
      ) THEN
        CREATE INDEX idx_messages_conversation ON messages(conversation_id, ts DESC) WHERE conversation_id IS NOT NULL;
      END IF;
    END $$;
  `);

  // NEW: bot_configs table linked by session_key to configure bot stop minutes
  await client.query(`
    CREATE TABLE IF NOT EXISTS bot_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_key TEXT UNIQUE NOT NULL,
      stop_minutes INTEGER DEFAULT 10,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name='bot_configs' AND column_name='stop_minutes'
      ) THEN
        ALTER TABLE bot_configs ADD COLUMN stop_minutes INTEGER DEFAULT 10;
      END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE tablename = 'bot_configs' AND indexname = 'idx_bot_configs_session'
      ) THEN
        CREATE INDEX idx_bot_configs_session ON bot_configs(session_key);
      END IF;
    END $$;
  `);
}

export default { runMigrations };
