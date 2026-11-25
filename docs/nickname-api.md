# 닉네임 검증과 중복 확인

## 정책

- 한글 음절과 현대 자모, 영문 소문자와 숫자로 2~10글자를 허용합니다.
- 영문 대문자는 자동으로 소문자로 바꾸지 않고 거부합니다.
- 한글은 NFC로 정규화하고 grapheme 단위로 길이를 계산합니다.
- 원문자, 한글 채움 문자, 공백과 특수문자는 허용하지 않습니다.
- 서버 목록은 `src/nickname/policy.ts`에서 관리합니다.
- 금칙어 `씨발`, `병신`, `fuck`은 포함되면 거부합니다.
- 예약어 `관리자`, `운영자`, `admin`, `administrator`, `localquester`는 정확히 일치하면 거부합니다. 현재 길이 제한을 초과하는 이름도 향후 정책 변경에 대비해 목록에 유지합니다.

## API

`GET /members/nickname/availability?nickname=minju`

`Authorization: Bearer <session token>`이 필요합니다. 소셜 인증은 마쳤지만 온보딩은 완료하지 않은 사용자도 사용할 수 있습니다. 응답은 캐시하지 않습니다.

사용 가능할 때:

```json
{ "available": true, "reason": null }
```

이미 사용 중일 때:

```json
{ "available": false, "reason": "taken" }
```

유효하지 않은 닉네임은 HTTP 400이며 `error`는 `invalid_nickname`, `reason`은 `empty`, `too-short`, `too-long`, `invalid-characters`, `unavailable-word` 중 하나입니다. 인증 누락이나 만료 시 HTTP 401과 `unauthorized`를 반환합니다.

이 API는 조회 시점의 사용 가능 여부만 확인하며 닉네임을 예약하지 않습니다. 실제 가입 완료 API에서 다시 검증하고 DB 유일 인덱스로 동시에 들어온 중복을 처리해야 합니다.

## DB

`users.nickname`은 소셜 제공자의 `display_name`과 구분합니다. 기존 계정은 닉네임이 `NULL`인 상태로 유지되며, 여러 미완료 계정의 `NULL`은 허용됩니다. 새 `0004_nickname-policy.sql`이 컬럼과 유일 인덱스를 추가합니다. 이미 적용된 마이그레이션은 변경하지 않습니다.

프런트에서는 인증 연동 후 임시 중복 예시를 이 API 호출로 교체합니다.
