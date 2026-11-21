# Local Quester API

Fastify + TypeScript API입니다. PostgreSQL/PostGIS 스키마와 인증 이력은 Drizzle SQL 마이그레이션으로 관리합니다.

## 로컬 실행

Node.js 22 이상과 PostGIS가 설치된 PostgreSQL 17이 필요합니다. `.env.example`을 `.env`로 복사하고 값을 설정합니다. 실행 전 셸에 환경 변수를 로드해야 합니다.

```bash
npm ci
npm run db:migrate
npm run dev
```

## 스키마 변경

1. `src/db/schema.ts`를 수정합니다.
2. `npm run db:generate -- --name=설명`으로 새 마이그레이션을 만듭니다.
3. 생성된 SQL을 검토하고 PR에 함께 넣습니다. 이미 적용된 파일은 수정하지 않습니다.
4. 로컬 PostGIS DB에 `npm run db:migrate`를 실행합니다.

PostGIS 확장은 `drizzle/0000_enable-postgis.sql`에서 활성화합니다. `places.location`은 WGS84(`SRID 4326`) Point이며 GiST 인덱스를 사용합니다. 운영 DB 마이그레이션은 서버 시작 시 자동 실행하지 않고 배포 작업에서 한 번 실행합니다.

## 소셜 로그인

`GET /auth/{google|kakao}/start` → 제공자 인증 → `GET /auth/{provider}/callback` → 웹 일회용 티켓 → `POST /auth/exchange` → 세션 토큰 순서입니다. 웹은 토큰을 HTTP 전용 쿠키에 저장하고 API 요청에는 Bearer 토큰으로 전달합니다. 티켓은 1분, 세션은 30일 후 만료됩니다.

필요한 설정: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET`, `PUBLIC_API_URL`, `WEB_ORIGIN`, `DATABASE_URL`. Google과 Kakao 콘솔의 Redirect URI에는 각각 `<PUBLIC_API_URL>/auth/google/callback`, `<PUBLIC_API_URL>/auth/kakao/callback`을 등록합니다. 공급자 키와 외부에서 접속 가능한 API 주소가 없으면 로그인 완료는 불가능합니다.

## 검증

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run db:check`를 사용합니다. GitHub Actions는 PostGIS 서비스 DB에 모든 마이그레이션을 적용하고 공간 컬럼까지 확인합니다.
