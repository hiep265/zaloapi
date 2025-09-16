import db from '../db/index.js';

export async function saveIncomingMessage({
  session_key,
  account_id,
  // New Zalo message fields
  type,
  thread_id,
  id_to,
  uid_from,
  d_name,
  group_name,
  is_self,
  content,
  msg_type,
  property_ext,
  quote,
  mentions,
  attachments_json,
  ts,
  msg_id,
  cli_msg_id,
  global_msg_id,
  real_msg_id,
  cmd,
  st,
  status,
  ttl,
  notify,
  top_out,
  top_out_time_out,
  top_out_impr_time_out,
  action_id,
  uin,
  user_id,
  params_ext,
  raw_json,
  // Legacy compatibility fields
  thread_type,
  peer_id,
  direction = 'in',
  message_id,
  from_uid,
  to_uid,
}) {
  // First, try to add group_name column if it doesn't exist
  try {
    await db.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS group_name TEXT`);
  } catch (err) {
    // Column might already exist, ignore error
  }

  const res = await db.query(
    `INSERT INTO messages(
      session_key, account_id, type, thread_id, id_to, uid_from, d_name, group_name, is_self,
      content, msg_type, property_ext, quote, mentions, attachments_json,
      ts, msg_id, cli_msg_id, global_msg_id, real_msg_id,
      cmd, st, status, ttl, notify, top_out, top_out_time_out, top_out_impr_time_out,
      action_id, uin, user_id, params_ext, raw_json,
      thread_type, peer_id, direction, message_id
     )
     VALUES(
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb,
       $16, $17, $18, $19, $20,
       $21, $22, $23, $24, $25, $26, $27, $28,
       $29, $30, $31, $32::jsonb, $33::jsonb,
       $34, $35, $36, $37
     )
     ON CONFLICT (session_key, msg_id) DO NOTHING
     RETURNING id`,
    [
      session_key,
      account_id || null,
      typeof type === 'number' ? type : null,
      thread_id || null,
      id_to || null,
      uid_from || from_uid || null,
      d_name || null,
      group_name || null,
      is_self || false,
      content || null,
      msg_type || null,
      property_ext ? JSON.stringify(property_ext) : null,
      quote ? JSON.stringify(quote) : null,
      mentions ? JSON.stringify(mentions) : null,
      attachments_json ? JSON.stringify(attachments_json) : null,
      typeof ts === 'number' ? ts : (ts ? Number(ts) : null),
      msg_id || message_id || null,
      cli_msg_id || null,
      global_msg_id || null,
      real_msg_id || '0',
      typeof cmd === 'number' ? cmd : (cmd ? Number(cmd) : null),
      typeof st === 'number' ? st : null,
      typeof status === 'number' ? status : null,
      typeof ttl === 'number' ? ttl : 0,
      typeof notify === 'number' ? notify : 1,
      top_out || false,
      typeof top_out_time_out === 'number' ? top_out_time_out : null,
      typeof top_out_impr_time_out === 'number' ? top_out_impr_time_out : null,
      action_id || null,
      uin || '0',
      user_id || '0',
      params_ext ? JSON.stringify(params_ext) : null,
      raw_json ? JSON.stringify(raw_json) : null,
      thread_type || null,
      peer_id || null,
      direction || 'in',
      message_id || msg_id || null,
    ]
  );
  return res.rows[0]?.id || null;
}

export default {
  saveIncomingMessage,
  queryMessages,
  getThreadsByUser,
  getConversation,
};

export async function queryMessages({
  session_key,
  account_id,
  thread_id,
  uid_from,
  peer_id,
  from_uid,
  to_uid,
  msg_type,
  direction,
  since_ts,
  until_ts,
  limit = 50,
  offset = 0,
  order = 'desc',
}) {
  const conds = [];
  const vals = [];
  const add = (sql, v) => { vals.push(v); conds.push(`${sql} $${vals.length}`); };

  if (session_key) add('session_key =', session_key);
  if (account_id) add('account_id =', account_id);
  if (thread_id) add('thread_id =', thread_id);
  if (uid_from) add('uid_from =', uid_from);
  if (peer_id) add('peer_id =', peer_id);
  if (from_uid) add('uid_from =', from_uid); // Legacy support
  if (to_uid) add('id_to =', to_uid);
  if (msg_type) add('msg_type =', msg_type);
  if (direction) add('direction =', direction);
  if (since_ts) add('ts >=', Number(since_ts));
  if (until_ts) add('ts <=', Number(until_ts));

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const sql = `
    SELECT id, session_key, account_id, type, thread_id, id_to, uid_from, d_name, group_name, is_self,
           content, msg_type, property_ext, quote, mentions, attachments_json,
           ts, msg_id, cli_msg_id, global_msg_id, real_msg_id,
           cmd, st, status, ttl, notify, top_out, top_out_time_out, top_out_impr_time_out,
           action_id, uin, user_id, params_ext, raw_json,
           thread_type, peer_id, direction, message_id, created_at
    FROM messages
    ${where}
    ORDER BY (CASE WHEN ts IS NOT NULL THEN to_timestamp(ts/1000.0) ELSE created_at END) ${order === 'asc' ? 'ASC' : 'DESC'},
             created_at ${order === 'asc' ? 'ASC' : 'DESC'}
    LIMIT $${vals.length + 1}
    OFFSET $${vals.length + 2}
  `;
  vals.push(Number(limit));
  vals.push(Number(offset));
  const res = await db.query(sql, vals);
  return res.rows || [];
}

export async function getThreadsByUser(session_key, { limit = 50, offset = 0 } = {}) {
  // Latest message per thread_id for this user (session_key)
  const sql = `
    WITH messages_with_conv AS (
      SELECT m.*, COALESCE(m.thread_id, m.peer_id) AS conv_id,
             COALESCE(to_timestamp(m.ts/1000.0), m.created_at) AS msg_time
      FROM messages m
      WHERE m.session_key = $1
    ),
    ranked AS (
      SELECT mwc.*, ROW_NUMBER() OVER (
        PARTITION BY mwc.conv_id
        ORDER BY mwc.msg_time DESC, mwc.created_at DESC
      ) AS rn
      FROM messages_with_conv mwc
    ),
    names AS (
      SELECT
        conv_id,
        COALESCE(
          MAX(group_name) FILTER (WHERE group_name IS NOT NULL),
          (ARRAY_AGG(d_name ORDER BY msg_time DESC, created_at DESC) FILTER (WHERE d_name IS NOT NULL))[1]
        ) AS display_name
      FROM messages_with_conv
      GROUP BY conv_id
    )
    SELECT
      COALESCE(r.thread_id, r.peer_id) AS conversation_id,
      r.thread_id AS thread_id,
      r.peer_id AS peer_id,
      r.account_id AS account_id,
      r.type AS type,
      r.id_to AS id_to,
      r.uid_from AS uid_from,
      n.display_name AS d_name,
      r.group_name AS group_name,
      r.is_self AS is_self,
      r.content AS last_content,
      r.msg_type AS last_msg_type,
      r.ts AS last_ts,
      r.direction AS last_direction,
      r.message_id AS last_message_id,
      r.cmd AS last_cmd,
      r.created_at AS last_created_at
    FROM ranked r
    JOIN names n ON n.conv_id = COALESCE(r.thread_id, r.peer_id)
    WHERE r.rn = 1
    ORDER BY r.msg_time DESC, r.created_at DESC
    LIMIT $2 OFFSET $3
  `;
  const res = await db.query(sql, [session_key, Number(limit), Number(offset)]);
  return res.rows || [];
}

export async function getConversation({ session_key, thread_id, peer_id, limit = 50, before_ts = null, order = 'asc' }) {
  const conds = ['session_key = $1'];
  const vals = [session_key];
  
  // Support both new thread_id and legacy peer_id
  if (thread_id) {
    conds.push('thread_id = $2');
    vals.push(thread_id);
  } else if (peer_id) {
    conds.push('(peer_id = $2 OR thread_id = $2)');
    vals.push(peer_id);
  } else {
    throw new Error('Either thread_id or peer_id must be provided');
  }
  
  if (before_ts) {
    conds.push(`COALESCE(ts, EXTRACT(EPOCH FROM created_at)*1000)::bigint < $${vals.length + 1}`);
    vals.push(Number(before_ts));
  }
  
  const where = `WHERE ${conds.join(' AND ')}`;
  const sql = `
    SELECT id, session_key, account_id, type, thread_id, id_to, uid_from, d_name, group_name, is_self,
           content, msg_type, property_ext, quote, mentions, attachments_json,
           ts, msg_id, cli_msg_id, global_msg_id, real_msg_id,
           cmd, st, status, ttl, notify, top_out, top_out_time_out, top_out_impr_time_out,
           action_id, uin, user_id, params_ext, raw_json,
           thread_type, peer_id, direction, message_id, created_at
    FROM messages
    ${where}
    ORDER BY COALESCE(to_timestamp(ts/1000.0), created_at) ${order === 'desc' ? 'DESC' : 'ASC'}, created_at ${order === 'desc' ? 'DESC' : 'ASC'}
    LIMIT $${vals.length + 1}
  `;
  vals.push(Number(limit));
  const res = await db.query(sql, vals);
  return res.rows || [];
}
