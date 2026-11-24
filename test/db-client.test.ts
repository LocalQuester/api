import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeDb, getDb } from '../src/db/client.js';

test('유휴 DB 연결 오류를 처리하고 Pool 처리기를 중복 등록하지 않는다', async t => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgres://localquester:localquester@127.0.0.1:5433/localquester';
  const log = t.mock.method(console, 'error', () => {});
  try {
    const pool = getDb().$client;
    assert.equal(getDb().$client, pool);
    assert.equal(pool.listenerCount('error'), 1);
    const failure = new Error('idle connection failed');
    assert.doesNotThrow(() => pool.emit('error', failure));
    assert.equal(log.mock.callCount(), 1);
    assert.equal(log.mock.calls[0].arguments[1], failure);
  } finally {
    await closeDb();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
