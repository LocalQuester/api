# Local Quester API

Fastify + TypeScript API입니다. PostgreSQL/PostGIS 스키마와 인증 이력은 Drizzle SQL 마이그레이션으로 관리합니다.

## 로컬 개발 시작

Node.js 22.13 이상(22.x) 또는 24 이상과 Docker Desktop의 Linux 컨테이너 엔진이 필요합니다. 현재 프로젝트의 기준 버전은 `.node-version`과 `.nvmrc`에 기록한 22.23.5입니다.

```powershell
Copy-Item .env.example .env
npm ci
npm run db:up
npm run db:migrate
npm run db:verify
npm run dev
```

기존 `.env`가 있으면 덮어쓰지 말고 누락된 설정만 반영합니다. 실행과 DB 명령은 `.env`가 있을 때 자동으로 읽습니다. 셸이나 CI에서 이미 지정한 환경변수가 `.env`보다 우선합니다. `.env`의 변경은 서버를 재시작해야 적용됩니다.

Windows에서 다른 프로젝트 때문에 전역 Node 버전을 유지해야 한다면 다음 래퍼를 사용합니다. 레포 옆 `../.tools/node_modules/node/bin/node.exe`를 우선 사용하고, 없으면 현재 Node 버전을 검증합니다. 전역 설치나 다른 터미널의 설정은 바꾸지 않습니다.

```powershell
.\scripts\npm.ps1 ci
.\scripts\npm.ps1 run db:up
.\scripts\npm.ps1 run db:migrate
.\scripts\npm.ps1 run db:verify
.\scripts\npm.ps1 run dev
```

환경 설정 후 `http://localhost:8080/health`에서 `{"status":"ok"}`를 확인합니다. 이 주소는 서버 실행 여부만 확인하며 DB 연결이나 소셜 로그인 성공까지 보장하지 않습니다.

## 로컬 DB

- Compose 프로젝트: `localquester-api`
- 이미지: `postgis/postgis:17-3.7` (기존 CI와 동일)
- 호스트 접속: `127.0.0.1:5433` (컨테이너 내부는 5432)
- DB 및 개발 전용 사용자와 암호: `localquester`
- 데이터는 프로젝트 전용 볼륨에 보관됩니다. 개발용 계정은 운영 환경에서 사용하지 않습니다.
- 로컬 전용 포트에 바인딩하므로 외부 네트워크에 DB 포트를 공개하지 않습니다.

`npm run db:up`은 DB의 healthcheck 통과를 기다립니다. 중지할 때는 `npm run db:stop`을 사용하며 데이터 볼륨은 유지됩니다. 기존 로컬 DB를 사용하는 경우에는 `.env`의 `DATABASE_URL`을 해당 주소로 지정합니다. Compose의 5433 포트와 다른 프로젝트 DB를 혼동하지 않습니다.

## 프런트와 연결

1. API `.env`의 `WEB_ORIGIN`을 `http://localhost:3000`, `PUBLIC_API_URL`을 `http://localhost:8080`으로 설정합니다.
2. 웹의 `.env.local`에서 `API_URL=http://localhost:8080`을 설정하고 웹 서버를 재시작합니다.
3. Google과 Kakao 개발자 콘솔에 로컬 API callback을 등록하고 API `.env`에 제공자 키를 설정합니다. 비밀키는 커밋하지 않습니다.

브라우저는 Next.js의 `/api/auth/...`로 접근하고, Next.js 서버가 API에 인증을 전달합니다. 현재 로그인 후 항상 홈으로 이동하는 코드는 온보딩 상태 분기 연결 전의 기반 구현입니다. 아직 가입 플로우 전체가 실제 API에 연결된 상태는 아닙니다.

## 소셜 로그인 기반

`GET /auth/{google|kakao}/start` → 제공자 인증 → `GET /auth/{provider}/callback` → 웹 일회용 티켓 → `POST /auth/exchange` → 세션 토큰 순서입니다. Next.js 웹 서버는 토큰을 HTTP 전용 쿠키에 저장하고 API 요청에 Bearer 헤더를 구성합니다.

필요한 설정은 `.env.example`을 참고합니다. 제공자 콘솔의 Redirect URI는 각각 `<PUBLIC_API_URL>/auth/google/callback`, `<PUBLIC_API_URL>/auth/kakao/callback`입니다. 제공자 키가 없으면 실제 로그인을 완료할 수 없습니다.

현재 코드의 티켓 만료 1분, 세션 만료 30일은 기존 기반 구현 값입니다. 로그인 유지 기간은 별도 정책 협의 대상으로, 이 초기 설정 작업에서 새로 확정하지 않습니다.

확정된 가입 정책과 미확정 정책은 [인증과 온보딩 연동 문서](docs/auth-onboarding-plan.md)에 구분합니다.

## 닉네임 API

인증된 사용자의 중복 확인 경로는 `GET /members/nickname/availability?nickname=minju`입니다. 검증 규칙과 응답 형식은 [닉네임 API 문서](docs/nickname-api.md)를 참고합니다.

## DB 변경

1. `src/db/schema.ts`를 수정합니다.
2. `npm run db:generate -- --name=설명`으로 새 마이그레이션을 만듭니다.
3. 생성된 SQL을 검토하고 PR에 함께 넣습니다. 이미 적용된 파일은 수정하지 않습니다.
4. 로컬 PostGIS DB에 `npm run db:migrate`를 실행합니다.

PostGIS 확장은 `drizzle/0000_enable-postgis.sql`에서 활성화합니다. `places.location`은 WGS84(`SRID 4326`) Point이며 GiST 인덱스를 사용합니다. 운영 DB 마이그레이션은 서버 시작 시 자동 실행하지 않고 배포 작업에서 한 번 실행합니다.

## 검증

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run db:check
npm run db:migrate
npm run db:verify
docker compose config --quiet
```

GitHub Actions는 PostGIS 서비스 DB에 마이그레이션을 적용하고 공간 컬럼까지 확인합니다. CI에서는 서비스 DB의 5432 포트를 명시하며 로컬 Compose의 5433 설정과 분리됩니다. 인증 만료 기록 정리와 시간 제한도 임시 검증 DB에서 확인합니다.

일반 작업은 develop에 squash로 병합하며, 배포는 별도 배포 이슈와 develop → main PR을 통해 merge commit으로 반영합니다.
