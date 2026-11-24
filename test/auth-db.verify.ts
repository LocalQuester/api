import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { purgeExpiredAuthRecords } from '../src/auth/cleanup.js';
import { closeDb } from '../src/db/client.js';

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
  console.log('Empty and existing-ticket upgrades, expired auth cleanup and valid record preservation verified');
} finally {
  await closeDb();
  process.env.DATABASE_URL = originalUrl;
  await client.end();
  if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
}
