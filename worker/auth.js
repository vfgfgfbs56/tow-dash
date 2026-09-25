const enc = new TextEncoder();
export async function hmac(key, text) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
}
export async function validateTelegram(data, token, now = Date.now()) {
  if (!token || typeof data !== 'string' || data.length > 12000) return null;
  const params = new URLSearchParams(data), hash = params.get('hash');
  if (!/^[a-f0-9]{64}$/i.test(hash || '')) return null;
  if (new Set(params.keys()).size !== [...params.keys()].length) return null;
  params.delete('hash');
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > 3600 || authDate - now / 1000 > 30) return null;
  const check = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac('WebAppData', token), signature = await hmac(secret, check);
  const actual = [...signature].map(v => v.toString(16).padStart(2, '0')).join('');
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= actual.charCodeAt(i) ^ hash.toLowerCase().charCodeAt(i);
  if (diff) return null;
  try {
    const user = JSON.parse(params.get('user'));
    if (!Number.isSafeInteger(user.id) || user.id <= 0) return null;
    return { uid: `tg:${user.id}`, name: String(user.first_name || 'Игрок').slice(0, 24) };
  } catch { return null; }
}
