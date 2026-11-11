#!/usr/bin/env node
// Aplica arquivos .sql no Postgres do Supabase (DATABASE_URL do .env), todos numa transação só.
//   node scripts/aplicar-sql.mjs supabase/migrations/003_cartoes.sql supabase/migrations/004_cartoes_seguranca.sql
import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';

const arquivos = process.argv.slice(2);
if (!arquivos.length) throw new Error('Informe os arquivos .sql.');
if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL no .env.');
const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } });
await c.connect();
try {
  await c.query('begin');
  for (const f of arquivos) {
    await c.query(readFileSync(f, 'utf8'));
    console.log('ok', f);
  }
  await c.query('commit');
  await c.query(`notify pgrst, 'reload schema'`);
  console.log('Concluído.');
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.error('ERRO (nada foi gravado):', e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
