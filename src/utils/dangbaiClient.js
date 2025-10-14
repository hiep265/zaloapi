const DANGBAI_BASE_URL = process.env.DANGBAI_BASE_URL || 'http://localhost:8000';
const DANGBAI_API_KEY = process.env.DANGBAI_API_KEY || '';
const DANGBAI_BEARER = process.env.DANGBAI_BEARER || '';

function buildAuthHeaders() {
  const headers = {};
  if (DANGBAI_API_KEY) headers['X-API-Key'] = DANGBAI_API_KEY;
  if (DANGBAI_BEARER) headers['Authorization'] = `Bearer ${DANGBAI_BEARER}`;
  return headers;
}

export async function postToDangbai(path, body) {
  const url = `${DANGBAI_BASE_URL}${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Dangbai POST ${path} failed ${res.status}: ${text}`);
    }
    return await res.json().catch(() => ({}));
  } catch (e) {
    console.error('[dangbaiClient] error', e.message);
    return null;
  }
}

export async function postToDangbaiAuth(path, body, apiKey) {
  const url = `${DANGBAI_BASE_URL}${path}`;
  try {
    const headers = { 'Content-Type': 'application/json' };
    const keyToUse = apiKey || DANGBAI_API_KEY;
    if (keyToUse) headers['X-API-Key'] = keyToUse;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Dangbai POST ${path} failed ${res.status}: ${text}`);
    }
    return await res.json().catch(() => ({}));
  } catch (e) {
    console.error('[dangbaiClient] error', e.message);
    return null;
  }
}

export async function chatWithDangbaiLinhKien({ message, model_choice = 'gemini', session_id = 'default', apiKey, image_url }) {
  const url = `${DANGBAI_BASE_URL}/api/v1/chatbot-linhkien/chat`;
  // Prepare abort controller outside try so finally can access it
  const controller = new AbortController();
  let timeoutId = null;
  try {
    // Use URLSearchParams for form-encoded body (compatible with FastAPI Form)
    const params = new URLSearchParams();
    params.append('message', message || '');
    params.append('model_choice', model_choice || 'gemini');
    params.append('session_id', session_id || 'default');
    if (image_url) params.append('image_url', String(image_url));

    // Only send X-API-Key (no Bearer)
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };
    const keyToUse = apiKey || DANGBAI_API_KEY;
    if (keyToUse) headers['X-API-Key'] = keyToUse;

    // Add timeout to avoid hanging requests
    timeoutId = setTimeout(() => controller.abort(), 80000);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: params,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Dangbai chat failed ${res.status}: ${text}`);
    }
    // Response format can vary; caller can ignore for now
    const data = await res.json().catch(() => ({}));
    return data;
  } catch (e) {
    console.error('[dangbaiClient] chat error', e.message);
    return null;
  } finally {
    // Ensure timeout is cleared
    try { if (timeoutId) clearTimeout(timeoutId); } catch {}
  }
}

/**
 * Call Dangbai backend mobile chatbot API
 * Endpoint: POST /api/v1/chatbot/chat
 * Body: { query: string, stream?: boolean, llm_provider?: 'google_genai' | 'openai', thread_id?: string }
 * Auth: X-API-Key header (user's API key saved with the session)
 */
export async function chatWithMobileChatbot({ query, stream = false, llm_provider = 'google_genai', apiKey, thread_id }) {
  const url = `${DANGBAI_BASE_URL}/api/v1/chatbot/chat`;
  const controller = new AbortController();
  let timeoutId = null;
  try {
    const headers = { 'Content-Type': 'application/json' };
    // Prefer per-session apiKey; fallback to env for local testing if needed
    const keyToUse = apiKey || DANGBAI_API_KEY;
    if (keyToUse) headers['X-API-Key'] = keyToUse;

    // Add timeout to avoid hanging requests
    timeoutId = setTimeout(() => controller.abort(), 80000);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: String(query || ''), stream: Boolean(stream), llm_provider, thread_id }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Dangbai mobile chatbot failed ${res.status}: ${text}`);
    }
    const data = await res.json().catch(() => ({}));
    // If ResponseModel.success is used, unwrap data if present
    if (data && typeof data === 'object' && data.data) return data.data;
    return data;
  } catch (e) {
    console.error('[dangbaiClient] mobile chat error', e.message);
    return null;
  } finally {
    try { if (timeoutId) clearTimeout(timeoutId); } catch {}
  }
}

export default { postToDangbai, postToDangbaiAuth, chatWithDangbaiLinhKien, chatWithMobileChatbot };
