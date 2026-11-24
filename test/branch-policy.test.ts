import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const workflow = await readFile(new URL('../.github/workflows/branch-policy.yml', import.meta.url), 'utf8');
const script = workflow.split('script: |')[1].split('\n').map(line => line.replace(/^ {12}/, '')).join('\n');

function runPolicy(issue: object | null, body = 'Closes #1', branch = 'feat/1-login', base = 'develop', title = 'feat: 로그인') {
  const queried: number[] = [];
  const context = {
    repo: { owner: 'LocalQuester', repo: 'api' },
    payload: { pull_request: { body, title, head: { ref: branch, repo: { full_name: 'LocalQuester/api' } }, base: { ref: base } } },
  };
  const github = { rest: { issues: { get: async (request: { issue_number: number }) => {
    queried.push(request.issue_number);
    if (issue === null) throw new Error('Issue not found: 404');
    return { data: issue };
  } } } };
  const promise: Promise<void> = runInNewContext(`(async () => { ${script} })()`, { context, github });
  return { promise, queried };
}

test('일반 PR은 브랜치에 연결한 실제 이슈를 조회한다', async () => {
  const result = runPolicy({ number: 1, title: '로그인 구현' });
  await result.promise;
  assert.deepEqual(result.queried, [1]);
});

test('develop에서 main으로 보내는 배포 PR은 배포 이슈와 제목을 검증한다', async () => {
  const result = runPolicy({ number: 8, title: '첫 배포' }, 'Closes #8', 'develop', 'main', 'release: 첫 배포');
  await result.promise;
  assert.deepEqual(result.queried, [8]);
  await assert.rejects(runPolicy({ number: 8, title: '로그인 구현' }, 'Closes #8', 'develop', 'main', 'release: 첫 배포').promise, /deployment issue/);
  await assert.rejects(runPolicy({ number: 8, title: '첫 배포' }, 'Closes #8', 'feat/8-login', 'main', 'release: 첫 배포').promise, /develop only/);
  await assert.rejects(runPolicy({ number: 8, title: '첫 배포' }, 'Closes #8', 'develop', 'main', 'feat: 첫 배포').promise, /Release PR title/);
});

test('존재하지 않는 이슈와 PR 번호로 연결한 요청은 거부한다', async () => {
  await assert.rejects(runPolicy(null).promise, /404/);
  await assert.rejects(runPolicy({ number: 1, pull_request: { url: 'pr' } }).promise, /must be an issue/);
});

test('이슈 연결 문구가 없거나 브랜치 규칙이 틀리면 조회 전에 거부한다', async () => {
  const missing = runPolicy({ number: 1 }, '작업 내용');
  await assert.rejects(missing.promise, /Closes/);
  assert.deepEqual(missing.queried, []);
  const invalid = runPolicy({ number: 1 }, 'Closes #1', 'login');
  await assert.rejects(invalid.promise, /type\/issue-number-description/);
  assert.deepEqual(invalid.queried, []);
});
