import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { nicknameRoutes } from '../src/nickname/routes.js';
import { normalizeNickname, validateNickname } from '../src/nickname/validation.js';

test('닉네임은 한글 음절과 자모, 소문자, 숫자로 2~10글자만 허용한다', () => {
  for (const value of ['minju', '한글12ab', 'ㄱㄴ', 'ㅏㅐ', '1234567890', '가나']) assert.equal(validateNickname(value), 'valid', value);
  for (const value of ['MINJU', 'Minju', '한글A', 'a b', '㉠㉡', '\u3164\u3164', '가\u115f', '가\u1160', '닉😀']) assert.equal(validateNickname(value), 'invalid-characters', value);
  assert.equal(validateNickname(''), 'empty');
  assert.equal(validateNickname('가'), 'too-short');
  assert.equal(validateNickname('12345678901'), 'too-long');
  assert.equal(validateNickname('가'.repeat(10000)), 'too-long');
  assert.equal(normalizeNickname('가나'), '가나');
  assert.equal(normalizeNickname('MINJU'), 'MINJU');
});

test('합의한 금칙어는 포함 시 거부하고 예약어는 정확히 일치할 때 거부한다', () => {
  for (const value of ['씨발', '병신닉', 'afuckb', '관리자', '운영자', 'admin']) assert.equal(validateNickname(value), 'unavailable-word', value);
  assert.equal(validateNickname('admin1'), 'valid');
  assert.notEqual(validateNickname('administrator'), 'valid');
  assert.notEqual(validateNickname('localquester'), 'valid');
});

test('중복 확인은 인증이 필요하고 만료된 세션은 거부한다', async () => {
  const app = Fastify();
  let queries = 0;
  app.register(nicknameRoutes, { findSessionUser: async () => null, nicknameExists: async () => { queries += 1; return false; } });
  try {
    for (const authorization of [undefined, 'Bearer expired']) {
      const response = await app.inject({ url: '/members/nickname/availability?nickname=minju', headers: authorization ? { authorization } : {} });
      assert.equal(response.statusCode, 401);
      assert.deepEqual(response.json(), { error: 'unauthorized' });
      assert.equal(response.headers['cache-control'], 'no-store');
    }
    assert.equal(queries, 0);
  } finally { await app.close(); }
});

test('인증 후 소문자 규칙을 검사하고 NFC로 정규화한 닉네임으로 DB를 조회한다', async () => {
  const app = Fastify();
  const queries: string[] = [];
  app.register(nicknameRoutes, {
    findSessionUser: async () => ({ id: 'user' }),
    nicknameExists: async nickname => { queries.push(nickname); return nickname === '가나'; },
  });
  const headers = { authorization: 'Bearer test' };
  try {
    for (const nickname of ['MINJU', '관리자', '', 'a b']) {
      const response = await app.inject({ url: `/members/nickname/availability?nickname=${encodeURIComponent(nickname)}`, headers });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error, 'invalid_nickname');
    }
    assert.equal(queries.length, 0);
    const missing = await app.inject({ url: '/members/nickname/availability', headers });
    assert.equal(missing.statusCode, 400);
    const taken = await app.inject({ url: `/members/nickname/availability?nickname=${encodeURIComponent('가나')}`, headers });
    assert.deepEqual(taken.json(), { available: false, reason: 'taken' });
    const available = await app.inject({ url: '/members/nickname/availability?nickname=minju', headers });
    assert.deepEqual(available.json(), { available: true, reason: null });
    assert.deepEqual(queries, ['가나', 'minju']);
  } finally { await app.close(); }
});
