import assert from 'node:assert/strict';
import { Client } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const extension = await client.query("SELECT extname FROM pg_extension WHERE extname = 'postgis'");
  assert.equal(extension.rowCount, 1);
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)",
    [['users', 'identities', 'sessions', 'login_tickets', 'places']]);
  assert.equal(tables.rowCount, 5);
  const point = await client.query("SELECT ST_SRID(ST_GeomFromText('POINT(127 37)', 4326)) AS srid");
  assert.equal(point.rows[0].srid, 4326);
  const column = await client.query("SELECT postgis_typmod_srid(atttypmod) AS srid FROM pg_attribute WHERE attrelid = 'public.places'::regclass AND attname = 'location' AND NOT attisdropped");
  assert.equal(column.rowCount, 1, 'public.places.location must exist exactly once');
  assert.equal(column.rows[0].srid, 4326);
  const spatialIndex = await client.query("SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'places' AND indexname = 'places_location_gist_idx'");
  assert.equal(spatialIndex.rowCount, 1, 'places.location GiST index must exist');
  assert.match(spatialIndex.rows[0].indexdef, /USING gist\s*\(location\)/i);
  console.log('PostGIS and versioned schema verified');
} finally {
  await client.end();
}
