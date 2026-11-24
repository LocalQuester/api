import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthCleanup } from '../src/auth/cleanup.js';

test('동시 요청은 만료 기록 정리를 공유하고 완료 후 1분 동안 중복 실행하지 않는다', async () => {
  let time = 0;
  let calls = 0;
  let finish: () => void = () => {};
  const cleanup = createAuthCleanup(() => {
    calls += 1;
    return new Promise<void>(resolve => { finish = resolve; });
  }, () => time);
  const first = cleanup();
  const second = cleanup();
  assert.equal(calls, 1);
  finish();
  await Promise.all([first, second]);
  time = 59_999;
  await cleanup();
  assert.equal(calls, 1);
  time = 60_000;
  const next = cleanup();
  assert.equal(calls, 2);
  finish();
  await next;
});

test('정리가 실패하면 다음 요청에서 재시도한다', async () => {
  let calls = 0;
  const cleanup = createAuthCleanup(async () => {
    calls += 1;
    if (calls === 1) throw new Error('temporary database failure');
  }, () => 0);
  await assert.rejects(cleanup(), /temporary database failure/);
  await cleanup();
  assert.equal(calls, 2);
  await cleanup();
  assert.equal(calls, 2);
});
