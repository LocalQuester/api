import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';

test('OAuth start sets a state cookie and redirects to the selected provider', async () => {
  process.env.PUBLIC_API_URL = 'http://localhost:8080';
  process.env.WEB_ORIGIN = 'http://localhost:3000';
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  const app = buildApp();
  const response = await app.inject('/auth/google/start?challenge=' + 'a'.repeat(64));
  assert.equal(response.statusCode, 302);
  const target = new URL(response.headers.location as string);
  assert.equal(target.origin, 'https://accounts.google.com');
  assert.equal(target.searchParams.get('client_id'), 'test-client');
  assert.equal(target.searchParams.get('redirect_uri'), 'http://localhost:8080/auth/google/callback');
  assert.ok(target.searchParams.get('state'));
  assert.match(String(response.headers['set-cookie']), /lq_oauth_state=/);

  const callback = await app.inject({
    method: 'GET', url: '/auth/google/callback?code=unused&state=invalid',
    headers: { cookie: `lq_oauth_state=${target.searchParams.get('state')}` },
  });
  assert.equal(callback.statusCode, 400);
  assert.deepEqual(callback.json(), { error: 'invalid_oauth_state' });
  await app.close();
});

test('unknown OAuth providers are rejected', async () => {
  const app = buildApp();
  const response = await app.inject('/auth/facebook/start');
  assert.equal(response.statusCode, 404);
  await app.close();
});
