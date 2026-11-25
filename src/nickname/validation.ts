import { forbiddenNicknameFragments, reservedNicknames } from './policy.js';

export type NicknameValidation = 'empty' | 'too-short' | 'too-long' | 'invalid-characters' | 'unavailable-word' | 'valid';
const characters = /^[가-힣ㄱ-ㅎㅏ-ㅣ\u1100-\u1112\u1161-\u1175\u11A8-\u11C2a-z0-9]+$/u;
const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });

export function normalizeNickname(value: string) { return value.normalize('NFC'); }

export function validateNickname(value: string): NicknameValidation {
  if (!value) return 'empty';
  if (value.length > 128) return 'too-long';
  const normalized = normalizeNickname(value);
  const count = Array.from(segmenter.segment(normalized)).length;
  if (count > 10) return 'too-long';
  if (!characters.test(normalized)) return 'invalid-characters';
  if (count < 2) return 'too-short';
  const word = normalized.normalize('NFKC');
  if (reservedNicknames.has(word) || forbiddenNicknameFragments.some(fragment => word.includes(fragment))) return 'unavailable-word';
  return 'valid';
}
