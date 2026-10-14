import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuard } from '../src/index.mjs';

const env = { NOLAG_HOST: 'files.example.test', NOLAG_SERVER_ID: '13',
  NOLAG_PANEL_URL: 'https://panel.example.test', NOLAG_API_KEY: 'edge-only-secret' };

function request(encoding, options = {}) {
  const req = new Request(options.url || 'https://files.example.test/servers/13/files/car/asset.ytd?hash=abc', {
    method: options.method || 'GET', headers: { 'User-Agent': 'CitizenFX/1',
      'X-CitizenFX-Token': 'valid-native-session', 'CF-Connecting-IP': '203.0.113.40',
      'Accept-Encoding': 'gzip', Connection: 'keep-alive', ...options.headers },
  });
  if (encoding !== undefined) Object.defineProperty(req, 'cf', { value: { clientAcceptEncoding: encoding } });
  return req;
}

test('edge guard blocks default Requests profiles despite a valid token and normalized origin headers', async () => {
  const calls = [], tasks = [];
  const guard = createGuard(async (...args) => { calls.push(args); return new Response('ok'); });
  for (const encoding of ['gzip, deflate', 'gzip, deflate, br', 'gzip, deflate, zstd', 'gzip, deflate, br, zstd']) {
    const response = await guard.fetch(request(encoding), env, { waitUntil: task => tasks.push(task) });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('X-Nolag-Edge-Reason'), 'requests_header_profile');
    assert.equal(response.headers.get('X-Nolag-Edge-Version'), '1.3.0');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
  await Promise.all(tasks);
  assert.equal(calls.length, 1, 'Retries only report once and never reach the origin');
  const [url, report] = calls[0];
  assert.equal(url, 'https://panel.example.test/api/report');
  assert.equal(report.headers['X-API-Key'], 'edge-only-secret');
  assert.equal(report.headers['X-CitizenFX-Token'], 'valid-native-session');
  const body = JSON.parse(report.body);
  assert.equal(body.detection_type, 'http_client_profile_blocked');
  assert.equal(body.enforce_ip_ban, false);
  assert.ok(!report.body.includes('valid-native-session'));
  assert.ok(!report.body.includes('hash='));
});

test('edge guard preserves native profiles, Range/HEAD and other server routes without granting authorization', async () => {
  const calls = [];
  const guard = createGuard(async req => { calls.push(req); return new Response('Native origin still decides', { status: 401 }); });
  const requests = ['', 'identity', 'gzip', 'br, gzip', 'deflate, gzip, br', undefined].map(encoding => request(encoding));
  requests.push(request('', { method: 'HEAD' }));
  requests.push(request('', { headers: { Range: 'bytes=0-2' } }));
  requests.push(request('gzip, deflate', { url: 'https://files.example.test/servers/14/files/car/asset.ytd' }));
  requests.push(request('gzip, deflate', { url: 'https://files.example.test/servers/13/files-extra/asset.ytd' }));
  requests.push(request('gzip, deflate', { url: 'https://other.example.test/servers/13/files/car/asset.ytd' }));
  requests.push(request('gzip, deflate', { url: 'https://files.example.test/api/servers/13/config' }));
  requests.push(request('', { headers: { 'X-Original-Accept-Encoding': 'gzip, deflate' } }));
  for (const req of requests) assert.equal((await guard.fetch(req, env, {})).status, 401);
  assert.equal(calls.length, requests.length);
  assert.ok(calls.every(req => req instanceof Request), 'Native requests are forwarded unchanged');
});

test('report errors do not serve blocked assets and an unconfigured Worker does not silently disable protection', async t => {
  t.mock.method(console, 'warn', () => {});
  const guard = createGuard(async () => { throw new Error('Report offline'); });
  const tasks = [];
  const response = await guard.fetch(request('gzip, deflate'), env, { waitUntil: task => tasks.push(task) });
  assert.equal(response.status, 403);
  await Promise.all(tasks);
  assert.equal((await guard.fetch(request(''), {}, {})).status, 503);
});

test('domain migration filters the canonical host and explicitly configured aliases', async () => {
  const calls = [];
  const guard = createGuard(async req => { calls.push(req); return new Response('origin'); });
  const migrated = { NOLAG_HOST: 'antidump.ciphermode.net', NOLAG_SERVER_ID: '13',
    NOLAG_HOST_ALIASES: 'files.ciphermode.net, SECOND.example.test ' };
  for (const host of ['antidump.ciphermode.net', 'files.ciphermode.net', 'second.example.test']) {
    const req = request('gzip, deflate', { url: `https://${host}/servers/13/files/car/asset.ytd?hash=abc` });
    assert.equal((await guard.fetch(req, migrated, {})).status, 403);
  }
  const other = request('gzip, deflate', { url: 'https://unrelated.example.test/servers/13/files/car/asset.ytd?hash=abc' });
  assert.equal((await guard.fetch(other, migrated, {})).status, 200);
  assert.equal(calls.length, 1);
});
