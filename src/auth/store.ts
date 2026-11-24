import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { identities, loginTickets, sessions, users } from '../db/schema.js';
import type { Profile, Provider } from './providers.js';
import { maintainAuthRecords } from './cleanup.js';

export function randomToken() { return randomBytes(32).toString('base64url'); }
export function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }

export async function findOrCreateUser(provider: Provider, profile: Profile) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const existing = await tx.select({ userId: identities.userId }).from(identities)
      .where(and(eq(identities.provider, provider), eq(identities.providerUserId, profile.id))).limit(1);
    if (existing[0]) return existing[0].userId;
    const inserted = await tx.insert(users).values({ displayName: profile.displayName, avatarUrl: profile.avatarUrl })
      .returning({ id: users.id });
    await tx.insert(identities).values({ userId: inserted[0].id, provider, providerUserId: profile.id });
    return inserted[0].id;
  });
}

export async function createLoginTicket(userId: string, challenge: string) {
  await maintainAuthRecords();
  const token = randomToken();
  await getDb().insert(loginTickets).values({
    userId, challenge, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000),
  });
  return token;
}

export async function exchangeLoginTicket(ticket: string, verifier: string) {
  await maintainAuthRecords();
  const db = getDb();
  return db.transaction(async (tx) => {
    const consumed = await tx.delete(loginTickets)
      .where(and(eq(loginTickets.tokenHash, hashToken(ticket)), eq(loginTickets.challenge, hashToken(verifier)), gt(loginTickets.expiresAt, new Date())))
      .returning({ userId: loginTickets.userId });
    if (!consumed[0]) return null;
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await tx.insert(sessions).values({ userId: consumed[0].userId, tokenHash: hashToken(token), expiresAt });
    return { token, expiresAt };
  });
}

export async function getSessionUser(token: string) {
  await maintainAuthRecords();
  const rows = await getDb().select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(sessions).innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()))).limit(1);
  return rows[0] ?? null;
}

export async function deleteSession(token: string) {
  await maintainAuthRecords();
  await getDb().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
