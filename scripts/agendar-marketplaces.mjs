// Agenda no Supabase do ERP (pg_cron + pg_net) a rotina dos marketplaces a cada 5 minutos: importa as vendas novas do ML e envia
// o estoque dos anúncios pendentes (POST /api/marketplaces?cron=1). O segredo vai do .env para o banco sem ser impresso.
// Uso: node scripts/agendar-marketplaces.mjs [--remover]
import 'dotenv/config';
import pg from 'pg';

const URL_ERP = process.env.ERP_URL || 'https://erp-ponto-certo.vercel.app';
const segredo = process.env.MARKETPLACE_CRON_SECRET;
if (!segredo && process.argv[2] !== '--remover') { console.error('Falta MARKETPLACE_CRON_SECRET no .env'); process.exit(1); }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  await c.query('create extension if not exists pg_cron');
  await c.query('create extension if not exists pg_net');
  await c.query(`select cron.unschedule(jobid) from cron.job where jobname = 'erp-marketplaces'`);
  if (process.argv[2] === '--remover') { console.log('Rotina removida.'); process.exit(0); }
  const comando = `select net.http_post(url := ${c.escapeLiteral(`${URL_ERP}/api/marketplaces?cron=1`)},
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', ${c.escapeLiteral(segredo)}),
    body := '{}'::jsonb, timeout_milliseconds := 55000)`;
  await c.query(`select cron.schedule('erp-marketplaces', '*/5 * * * *', $1)`, [comando]);
  console.log('Rotina erp-marketplaces agendada a cada 5 minutos.');
} finally { await c.end(); }
