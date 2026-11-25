import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { buildApp } from '../src/app.js';
import { hashToken } from '../src/auth/store.js';
import { closeDb } from '../src/db/client.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const originalUrl = process.env.DATABASE_URL;
const databaseName = `lq_nickname_verify_${randomBytes(6).toString('hex')}`;
const temporaryUrl = new URL(originalUrl);
temporaryUrl.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: originalUrl });
const client = new Client({ connectionString: temporaryUrl.toString() });
const app = buildApp();
let created = false;
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  await client.connect();
  for (const name of ['0000_enable-postgis.sql', '0001_initial-schema.sql', '0002_login-tickets.sql', '0003_bind-login-ticket.sql']) {
    const sql = await readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) if (statement.trim()) await client.query(statement);
  }
  const user = await client.query("INSERT INTO users (display_name) VALUES ('provider name') RETURNING id");
  const userId = user.rows[0].id;
  const sql = await readFile(new URL('../drizzle/0004_nickname-policy.sql', import.meta.url), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) if (statement.trim()) await client.query(statement);
  const existing = await client.query('SELECT nickname, display_name FROM users WHERE id = $1', [userId]);
  assert.deepEqual(existing.rows, [{ nickname: null, display_name: 'provider name' }]);
  await client.query("INSERT INTO users (nickname) VALUES ('가나')");
  await client.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, '2999-01-01'), ($1, $3, '2010-01-01')",
    [userId, hashToken('valid-token'), hashToken('expired-token')]);
  process.env.DATABASE_URL = temporaryUrl.toString();
  for (const token of ['', 'expired-token']) {
    const response = await app.inject({ url: '/members/nickname/availability?nickname=minju', headers: token ? { authorization: `Bearer ${token}` } : {} });
    assert.equal(response.statusCode, 401);
  }
  const headers = { authorization: 'Bearer valid-token' };
  for (const [nickname, available] of [['가나', false], ['minju', true]] as const) {
    const response = await app.inject({ url: `/members/nickname/availability?nickname=${encodeURIComponent(nickname)}`, headers });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { available, reason: available ? null : 'taken' });
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  const invalid = await app.inject({ url: '/members/nickname/availability?nickname=MINJU', headers });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.json(), { error: 'invalid_nickname', reason: 'invalid-characters' });
  assert.equal((await client.query('SELECT nickname FROM users WHERE id = $1', [userId])).rows[0].nickname, null);
  console.log('Nickname migration, real session authentication and availability verified');
} finally {
  await app.close();
  await closeDb();
  process.env.DATABASE_URL = originalUrl;
  await client.end();
  if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
}
