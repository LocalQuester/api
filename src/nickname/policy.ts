// 사용자와 합의한 초기 목록입니다. 단어를 추가하거나 차단 방식을 바꿀 때 정책 검토가 필요합니다.
export const forbiddenNicknameFragments = ['씨발', '병신', 'fuck'] as const;
export const reservedNicknames = new Set(['관리자', '운영자', 'admin', 'administrator', 'localquester']);
