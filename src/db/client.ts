import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

let pool: Pool | undefined;

export function getDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    pool.on('error', (error) => console.error('Database pool error', error));
  }
  return drizzle(pool, { schema });
}

export async function closeDb() {
  await pool?.end();
  pool = undefined;
}
