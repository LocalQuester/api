import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { users } from '../db/schema.js';

export async function nicknameExists(nickname: string) {
  const rows = await getDb().select({ id: users.id }).from(users).where(eq(users.nickname, nickname)).limit(1);
  return rows.length > 0;
}
