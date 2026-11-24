import { lte } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { loginTickets, sessions } from '../db/schema.js';

export async function purgeExpiredAuthRecords() {
  const now = new Date();
  await getDb().transaction(async tx => {
    await tx.delete(loginTickets).where(lte(loginTickets.expiresAt, now));
    await tx.delete(sessions).where(lte(sessions.expiresAt, now));
  });
}

export function createAuthCleanup(purge: () => Promise<void>, now = Date.now, intervalMs = 60_000) {
  let lastSuccess: number | undefined;
  let pending: Promise<void> | undefined;
  return async () => {
    if (pending) return pending;
    if (lastSuccess !== undefined && now() - lastSuccess < intervalMs) return;
    pending = purge().then(() => { lastSuccess = now(); }).finally(() => { pending = undefined; });
    return pending;
  };
}

const cleanupIfDue = createAuthCleanup(purgeExpiredAuthRecords);

export async function maintainAuthRecords() {
  try { await cleanupIfDue(); }
  catch (error) { console.error('Expired authentication record cleanup failed', error); }
}
