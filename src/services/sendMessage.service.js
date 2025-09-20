import { ThreadType } from 'zca-js';

/**
 * Send a plain text message via an existing zca-js API instance.
 * Keep this reusable for any place that needs to send a message.
 *
 * @param {Object} params
 * @param {import('zca-js').ZCAApi} params.api - The logged-in API instance (from zalo.login())
 * @param {string} params.threadId - User or Group ID to send to
 * @param {string} params.msg - Message text
 * @param {ThreadType} [params.type=ThreadType.User] - Thread type (User/Group)
 * @returns {Promise<import('zca-js').SendMessageResponse|null>} response or null on error
 */
export async function sendTextMessage({ api, threadId, msg, type = ThreadType.User }) {
  if (!api || typeof api.sendMessage !== 'function') {
    console.warn('[sendMessage] invalid api instance or sendMessage not available');
    return null;
  }
  if (!threadId || !msg) {
    console.warn('[sendMessage] missing threadId or msg');
    return null;
  }
  try {
    const content = { msg: String(msg) };
    const res = await api.sendMessage(content, String(threadId), type);
    return res || null;
  } catch (e) {
    console.error('[sendMessage] failed to send message:', e?.message || String(e));
    return null;
  }
}

/**
 * Send a link message via an existing zca-js API instance.
 *
 * @param {Object} params
 * @param {import('zca-js').ZCAApi} params.api - The logged-in API instance
 * @param {string} params.threadId - User or Group ID to send to
 * @param {string} params.link - URL to send
 * @param {string} [params.msg] - Optional message text to accompany the link
 * @param {ThreadType} [params.type=ThreadType.User] - Thread type (User/Group)
 * @returns {Promise<import('zca-js').SendLinkResponse|null>} response or null on error
 */
export async function sendLink({ api, threadId, link, msg, type = ThreadType.User }) {
  if (!api || typeof api.sendLink !== 'function') {
    console.warn('[sendLink] invalid api instance or sendLink not available');
    return null;
  }
  if (!threadId || !link) {
    console.warn('[sendLink] missing threadId or link');
    return null;
  }
  try {
    const options = {
      link: String(link),
      ...(msg ? { msg: String(msg) } : {})
    };
    const res = await api.sendLink(options, String(threadId), type);
    return res || null;
  } catch (e) {
    console.error('[sendLink] failed to send link:', e?.message || String(e));
    return null;
  }
}

export default { sendTextMessage, sendLink };
