const DANGBAI_BASE_URL = process.env.DANGBAI_BASE_URL || 'http://localhost:8000';

export async function postToDangbai(path, body) {
  const url = `${DANGBAI_BASE_URL}${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

export default { postToDangbai };
