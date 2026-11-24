import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { purgeExpiredAuthRecords } from '../src/auth/cleanup.js';
import { closeDb } from '../src/db/client.js';
import { getSessionUser, hashToken } from '../src/auth/store.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const originalUrl = process.env.DATABASE_URL;
const databaseName = `lq_auth_verify_${randomBytes(6).toString('hex')}`;
const temporaryUrl = new URL(originalUrl);
temporaryUrl.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: originalUrl });
const client = new Client({ connectionString: temporaryUrl.toString() });
let created = false;

async function applyMigration(name: string) {
  const sql = await readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) await client.query(statement);
  }
}

function databaseCode(error: unknown): unknown {
  if (!error || typeof error !== 'object') return undefined;
  if ('code' in error) return error.code;
  return 'cause' in error ? databaseCode(error.cause) : undefined;
}

await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  await client.connect();
  for (const name of ['0000_enable-postgis.sql', '0001_initial-schema.sql', '0002_login-tickets.sql']) await applyMigration(name);

  for (const withExistingTickets of [false, true]) {
    await client.query('BEGIN');
    try {
      if (withExistingTickets) {
        const user = await client.query('INSERT INTO users DEFAULT VALUES RETURNING id');
        const userId = user.rows[0].id;
        await client.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, 'existing-session', '2999-01-01')", [userId]);
        await client.query("INSERT INTO login_tickets (user_id, token_hash, expires_at) VALUES ($1, 'old-expired-ticket', '2010-01-01'), ($1, 'old-live-ticket', '2999-01-01')", [userId]);
      }
      await applyMigration('0003_bind-login-ticket.sql');
      assert.equal((await client.query('SELECT count(*)::int AS total FROM login_tickets')).rows[0].total, 0);
      assert.equal((await client.query('SELECT count(*)::int AS total FROM users')).rows[0].total, withExistingTickets ? 1 : 0);
      assert.equal((await client.query('SELECT count(*)::int AS total FROM sessions')).rows[0].total, withExistingTickets ? 1 : 0);
      const column = await client.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'login_tickets' AND column_name = 'challenge'");
      assert.equal(column.rows[0].is_nullable, 'NO');
    } finally { await client.query('ROLLBACK'); }
  }

  await applyMigration('0003_bind-login-ticket.sql');
  const user = await client.query('INSERT INTO users DEFAULT VALUES RETURNING id');
  const userId = user.rows[0].id;
  await client.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, 'expired-session', '2010-01-01'), ($1, 'valid-session', '2999-01-01')", [userId]);
  await client.query("INSERT INTO login_tickets (user_id, token_hash, challenge, expires_at) VALUES ($1, 'expired-ticket', 'challenge', '2010-01-01'), ($1, 'valid-ticket', 'challenge', '2999-01-01')", [userId]);
  process.env.DATABASE_URL = temporaryUrl.toString();
  await purgeExpiredAuthRecords();
  assert.deepEqual((await client.query('SELECT token_hash FROM sessions')).rows, [{ token_hash: 'valid-session' }]);
  assert.deepEqual((await client.query('SELECT token_hash FROM login_tickets')).rows, [{ token_hash: 'valid-ticket' }]);
  assert.equal((await client.query('SELECT id FROM users')).rows[0].id, userId);
  // 다른 트랜잭션이 만료 행을 잠그고 있어도 인증 처리는 이어져야 합니다.
  await client.query("UPDATE sessions SET token_hash = $1 WHERE token_hash = 'valid-session'", [hashToken('valid-session-token')]);
  await client.query("INSERT INTO login_tickets (user_id, token_hash, challenge, expires_at) VALUES ($1, 'locked-ticket', 'challenge', '2010-01-01')", [userId]);
  await client.query('BEGIN');
  const loggedErrors: unknown[][] = [];
  const originalError = console.error;
  const releaseLock = setTimeout(() => { void client.query('ROLLBACK').catch(() => {}); }, 3000);
  try {
    await client.query("SELECT id FROM login_tickets WHERE token_hash = 'locked-ticket' FOR UPDATE");
    const startedAt = Date.now();
    await assert.rejects(purgeExpiredAuthRecords(), error => databaseCode(error) === '55P03');
    console.error = (...values: unknown[]) => { loggedErrors.push(values); };
    const authenticated = await getSessionUser('valid-session-token');
    assert.equal(authenticated?.id, userId);
    assert.equal(loggedErrors.length, 1);
    assert.ok(Date.now() - startedAt < 2500, 'cleanup must stop waiting before the test releases its lock');
    assert.equal((await client.query("SELECT count(*)::int AS total FROM login_tickets WHERE token_hash = 'locked-ticket'")).rows[0].total, 1);
  } finally {
    clearTimeout(releaseLock);
    console.error = originalError;
    await client.query('ROLLBACK');
  }
  await purgeExpiredAuthRecords();
  assert.equal((await client.query("SELECT count(*)::int AS total FROM login_tickets WHERE token_hash = 'locked-ticket'")).rows[0].total, 0);

  await client.query("INSERT INTO login_tickets (user_id, token_hash, challenge, expires_at) VALUES ($1, 'slow-ticket', 'challenge', '2010-01-01')", [userId]);
  await client.query(`CREATE FUNCTION test_slow_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(2); RETURN OLD; END $$`);
  await client.query('CREATE TRIGGER slow_cleanup BEFORE DELETE ON login_tickets FOR EACH ROW EXECUTE FUNCTION test_slow_cleanup()');
  try {
    await assert.rejects(purgeExpiredAuthRecords(), error => databaseCode(error) === '57014');
  } finally {
    await client.query('DROP TRIGGER slow_cleanup ON login_tickets');
  }
  await purgeExpiredAuthRecords();
  console.log('Migration, cleanup, lock timeout, statement timeout and continued authentication verified');
} finally {
  await closeDb();
  process.env.DATABASE_URL = originalUrl;
  await client.end();
  if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
}
