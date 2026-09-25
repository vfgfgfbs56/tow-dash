import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validateTelegram } from '../worker/auth.js';
const token = '12345:test-token-only';
const now = 1780000000000;
function signed(fields) {
  const params = new URLSearchParams(fields);
  const text = [...params].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(text).digest('hex'));
  return params.toString();
}
const data = { auth_date: String(now / 1000), user: JSON.stringify({ id: 998, first_name: 'Тест' }), query_id: 'test' };
test('Telegram HMAC uses independently generated signatures', async () => {
  assert.deepEqual(await validateTelegram(signed(data), token, now), { uid: 'tg:998', name: 'Тест' });
  assert.equal(await validateTelegram(signed(data).replace('998', '997'), token, now), null);
  assert.equal(await validateTelegram(signed(data), 'bad-token', now), null);
});
test('stale, future, duplicate, and malformed Telegram payloads are rejected', async () => {
  assert.equal(await validateTelegram(signed(data), token, now + 3601000), null);
  assert.equal(await validateTelegram(signed(data), token, now - 60000), null);
  assert.equal(await validateTelegram(`${signed(data)}&auth_date=1`, token, now), null);
  assert.equal(await validateTelegram('invalid', token, now), null);
});
