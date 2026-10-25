const SETTINGS_KEY = 'site_content';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Site-Admin-Key',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};
const reply = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });
function config() {
  return {
    url: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    adminKey: process.env.SITE_CONTENT_ADMIN_KEY || process.env.APPLICATIONS_ADMIN_KEY || ''
  };
}
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  const { url, serviceKey, adminKey } = config();
  if (!url || !serviceKey) return reply(503, { ok: false, error: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Netlify.' });
  if (event.httpMethod === 'GET') {
    try {
      const r = await fetch(`${url}/rest/v1/ms3dh_settings?key=eq.${encodeURIComponent(SETTINGS_KEY)}&select=value`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
      });
      const rows = await r.json();
      if (!r.ok) return reply(502, { ok: false, error: 'Could not load shared site content.' });
      return reply(200, { ok: true, data: rows?.[0]?.value || null });
    } catch { return reply(502, { ok: false, error: 'Could not connect to the content database.' }); }
  }
  if (event.httpMethod !== 'PUT') return reply(405, { ok: false, error: 'Method not allowed.' });
  if (!adminKey) return reply(503, { ok: false, error: 'Configure SITE_CONTENT_ADMIN_KEY in Netlify.' });
  const supplied = event.headers?.['x-site-admin-key'] || event.headers?.['X-Site-Admin-Key'] || '';
  if (supplied !== adminKey) return reply(401, { ok: false, error: 'Admin key is incorrect.' });
  let data;
  try { data = JSON.parse(event.body || '{}').data; } catch { return reply(400, { ok: false, error: 'Invalid JSON.' }); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return reply(400, { ok: false, error: 'Invalid site content.' });
  // Keep payloads bounded so browser uploads cannot accidentally exceed database limits.
  const serialized = JSON.stringify(data);
  if (serialized.length > 1500000) return reply(413, { ok: false, error: 'Content is too large. Use image URLs instead of embedded image files.' });
  try {
    const r = await fetch(`${url}/rest/v1/ms3dh_settings?on_conflict=key`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key: SETTINGS_KEY, value: data, updated_at: new Date().toISOString() })
    });
    if (!r.ok) return reply(502, { ok: false, error: 'Database save failed. Check the Supabase table setup.' });
    return reply(200, { ok: true, saved: true });
  } catch { return reply(502, { ok: false, error: 'Could not connect to the content database.' }); }
}
