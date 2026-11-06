// Postgres embutido (PGlite) com o esquema do ERP aplicado — para testes sem Supabase.
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync } from 'node:fs';

export async function bancoDeTeste() {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(readFileSync(new URL('../supabase/migrations/001_schema.sql', import.meta.url), 'utf8'));
  return db;
}
