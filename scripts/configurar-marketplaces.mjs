// Liga o ERP ao Mercado Livre (uma vez). Lê os valores do .env do ERP e não imprime nenhum segredo.
//   1) publica a edge function ml-estoque no Supabase do Moderna Gestão (precisa de `npx supabase login` antes)
//   2) grava o secret ERP_ML_SECRET naquele projeto
//   3) grava ML_ESTOQUE_URL, ERP_ML_SECRET e MARKETPLACE_CRON_SECRET na Vercel do ERP (produção)
// Login sem navegador (o terminal do Claude Code não abre o login interativo): no .env do ERP, coloque
//   SUPABASE_ACCESS_TOKEN  (supabase.com/dashboard/account/tokens) e VERCEL_TOKEN (vercel.com/account/tokens; opcional VERCEL_SCOPE = time)
// Uso: node scripts/configurar-marketplaces.mjs [--so-vercel | --so-supabase]
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GESTAO = 'C:/Users/DIONI/Documents/Moderna Gestao';
const { ML_ESTOQUE_URL, ERP_ML_SECRET, MARKETPLACE_CRON_SECRET } = process.env;
if (!ML_ESTOQUE_URL || !ERP_ML_SECRET || !MARKETPLACE_CRON_SECRET) { console.error('Faltam ML_ESTOQUE_URL / ERP_ML_SECRET / MARKETPLACE_CRON_SECRET no .env'); process.exit(1); }
const ref = new URL(ML_ESTOQUE_URL).hostname.split('.')[0];
const so = process.argv[2] || '';

function rodar(cmd, args, { cwd, entrada } = {}) {
  const r = spawnSync(cmd, args, { cwd, input: entrada, stdio: [entrada ? 'pipe' : 'inherit', 'inherit', 'inherit'], shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error(`Falhou: ${cmd} ${args.filter((a) => a !== process.env.VERCEL_TOKEN).join(' ')}`); process.exit(r.status || 1); }
}

if (so !== '--so-vercel' && !process.env.SUPABASE_ACCESS_TOKEN) { console.error('Falta SUPABASE_ACCESS_TOKEN no .env (supabase.com/dashboard/account/tokens).'); process.exit(1); }
if (so !== '--so-supabase' && !process.env.VERCEL_TOKEN) { console.error('Falta VERCEL_TOKEN no .env (vercel.com/account/tokens).'); process.exit(1); }
const vercel = (args) => [...args, '--token', process.env.VERCEL_TOKEN || '', ...(process.env.VERCEL_SCOPE ? ['--scope', process.env.VERCEL_SCOPE] : [])];

if (so !== '--so-vercel') {
  console.log(`Publicando ml-estoque no projeto ${ref}…`);
  rodar('npx', ['--yes', 'supabase@latest', 'functions', 'deploy', 'ml-estoque', '--project-ref', ref, '--no-verify-jwt'], { cwd: GESTAO });
  // secret por arquivo temporário (não aparece na linha de comando)
  const dir = mkdtempSync(join(tmpdir(), 'erp-ml-'));
  const arq = join(dir, 'secrets.env');
  writeFileSync(arq, `ERP_ML_SECRET=${ERP_ML_SECRET}\n`);
  try { rodar('npx', ['--yes', 'supabase@latest', 'secrets', 'set', '--env-file', arq, '--project-ref', ref], { cwd: GESTAO }); } finally { rmSync(dir, { recursive: true, force: true }); }
}
if (so !== '--so-supabase') {
  rodar('npx', vercel(['--yes', 'vercel', 'link', '--yes', '--project', 'erp-ponto-certo']));
  for (const [nome, valor] of Object.entries({ ML_ESTOQUE_URL, ERP_ML_SECRET, MARKETPLACE_CRON_SECRET })) {
    console.log(`Vercel: ${nome}`);
    spawnSync('npx', vercel(['--yes', 'vercel', 'env', 'rm', nome, 'production', '--yes']), { stdio: 'ignore', shell: process.platform === 'win32' });
    rodar('npx', vercel(['--yes', 'vercel', 'env', 'add', nome, 'production']), { entrada: valor });
  }
  console.log('Pronto. Faça um novo deploy (git push) para a Vercel carregar as variáveis.');
}
