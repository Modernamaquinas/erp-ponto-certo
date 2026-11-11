#!/usr/bin/env node
// Migração / sincronização DirectControl (Firebird) -> ERP Ponto Certo (Postgres/Supabase).
//
//   npm run migrar -- --fdb "C:\caminho\restaurado.fdb"   carga completa a partir de um backup restaurado
//   npm run migrar                                         carga completa lendo o banco do servidor da loja
//   npm run sincronizar                                    incremental (Fase 1: rodar a cada 15 min)
//
// Opções: --incremental  --dias N (janela do incremental, padrão 15)  --somente t1,t2  --simular (não grava)
// O Firebird é só LIDO. Variáveis em .env: DATABASE_URL, FIREBIRD_HOST/PORT/DATABASE/USER/PASSWORD.
import 'dotenv/config';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { conectarFirebird, opcoesFirebird } from './firebird.mjs';
import { upsert, idsExistentes } from './carregar.mjs';
import { TABELAS, CONJUNTOS_DE_IDS } from './tabelas.mjs';
import { hojeLocal, somarDias } from './transformar.mjs';

/**
 * @param {object} p
 * @param {object} p.fb    conexão Firebird (conectarFirebird)
 * @param {object|null} p.db  Postgres com query(sql, params); null = simulação
 * @param {'completo'|'incremental'} [p.modo]
 */
export async function executarMigracao({ fb, db, modo = 'completo', dias = 15, somente = null, hoje = hojeLocal(), log = console.log }) {
  const ctx = {
    hoje,
    desde: modo === 'incremental' ? somarDias(hoje, -dias) : null,
    desdeCompras: modo === 'incremental' ? somarDias(hoje, -Math.max(dias, 60)) : null,
    ids: {},
    usuarios: new Map(),
  };
  const resumo = {};

  for (const nome of CONJUNTOS_DE_IDS) ctx.ids[nome] = db ? await idsExistentes(db, nome) : new Set();

  for (const spec of TABELAS) {
    if (somente && !somente.includes(spec.tabela)) continue;
    const inicio = Date.now();
    const brutas = await spec.extrair(fb, ctx);
    let linhas = brutas.map((r) => spec.transformar(r, ctx)).filter(Boolean);
    if (spec.filtrar) linhas = linhas.filter(spec.filtrar);

    if (spec.tabela === 'usuarios_legado') for (const u of linhas) ctx.usuarios.set(u.id, u.nome || u.login);

    const gravadas = db ? await upsert(db, spec.tabela, linhas, { conflito: spec.conflito, set: spec.set }) : linhas.length;
    if (CONJUNTOS_DE_IDS.includes(spec.tabela)) {
      if (db) ctx.ids[spec.tabela] = await idsExistentes(db, spec.tabela);
      else for (const l of linhas) ctx.ids[spec.tabela].add(Number(l.id));
    }
    resumo[spec.tabela] = { lidas: brutas.length, gravadas, ignoradas: brutas.length - linhas.length };
    log(`  ${spec.tabela.padEnd(22)} lidas ${String(brutas.length).padStart(7)}  gravadas ${String(gravadas).padStart(7)}  (${((Date.now() - inicio) / 1000).toFixed(1)}s)`);
  }
  return resumo;
}

/** Confere totais-chave entre origem e destino (só faz sentido após carga completa). */
export async function conferir(fb, db) {
  const [fbReceber] = await fb.consultar(`SELECT COUNT(*) AS N, SUM(SALDO) AS S FROM CONTASRECEBER
    WHERE COD_CLI IS NOT NULL AND (STATUS IS NULL OR STATUS <> 'P') AND SALDO > 0`);
  const [fbVendas] = await fb.consultar(`SELECT COUNT(*) AS N, SUM(TOT_NOTA) AS S FROM VENDAS WHERE VENDA_FINALIZADA = 'T'`);
  const [fbProdutos] = await fb.consultar(`SELECT COUNT(*) AS N, SUM(ESTOQUE) AS S FROM PRODUTOS`);
  const [fbClientes] = await fb.consultar(`SELECT COUNT(*) AS N FROM CLIENTES`);
  const [fbTef] = await fb.consultar(`SELECT COUNT(*) AS N, SUM(VALOR_TOTAL) AS S FROM TEF_TRANSACAO
    WHERE STATUS_TRANSACAO IN ('0', '2') AND HEADER IN ('CRT', 'CNF') AND COD_AUTORIZACAO_TRANSACAO IS NOT NULL
      AND NOME_REDE IS NOT NULL AND NOME_REDE <> 'dedicado'`);
  const um = async (sql) => (await db.query(sql)).rows[0];
  const pgReceber = await um(`select count(*) as n, sum(saldo) as s from contas_receber where status = 'aberto' and baixa_origem is null`);
  const pgVendas = await um(`select count(*) as n, sum(total) as s from vendas where situacao = 'finalizada'`);
  const pgProdutos = await um(`select count(*) as n, sum(estoque) as s from produtos`);
  const pgClientes = await um(`select count(*) as n from clientes`);
  const pgTef = await um(`select count(*) as n, sum(valor) as s from tef_transacoes where situacao = 'aprovada' and origem = 'legado'`);
  const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
  const linhas = [
    ['Contas a receber em aberto (qtd)', Number(fbReceber.n), Number(pgReceber.n)],
    ['Contas a receber em aberto (R$)', r2(fbReceber.s), r2(pgReceber.s)],
    ['Vendas finalizadas (qtd)', Number(fbVendas.n), Number(pgVendas.n)],
    ['Vendas finalizadas (R$)', r2(fbVendas.s), r2(pgVendas.s)],
    ['Produtos (qtd)', Number(fbProdutos.n), Number(pgProdutos.n)],
    ['Estoque total (unid.)', r2(fbProdutos.s), r2(pgProdutos.s)],
    ['Clientes (qtd)', Number(fbClientes.n), Number(pgClientes.n)],
    ['TEF aprovadas (qtd)', Number(fbTef.n), Number(pgTef.n)],
    ['TEF aprovadas (R$)', r2(fbTef.s), r2(pgTef.s)],
  ];
  return linhas.map(([item, origem, destino]) => ({ item, origem, destino, ok: origem === destino }));
}

function argumentos(argv) {
  const a = { modo: 'completo', dias: 15, somente: null, fdb: null, simular: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--incremental') a.modo = 'incremental';
    else if (v === '--simular') a.simular = true;
    else if (v === '--dias') a.dias = Number(argv[++i]);
    else if (v === '--somente') a.somente = argv[++i].split(',');
    else if (v === '--fdb') a.fdb = argv[++i];
    else throw new Error(`Opção desconhecida: ${v}`);
  }
  return a;
}

async function principal() {
  const a = argumentos(process.argv.slice(2));
  const opFb = opcoesFirebird({ fdb: a.fdb });
  console.log(`Origem: ${opFb.host}:${opFb.database}  |  modo ${a.modo}${a.modo === 'incremental' ? ` (${a.dias} dias)` : ''}${a.simular ? '  |  SIMULAÇÃO' : ''}`);
  const fb = await conectarFirebird(opFb);

  let cliente = null;
  if (!a.simular) {
    if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL no .env (string de conexão do Postgres do Supabase).');
    const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
    cliente = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } });
    await cliente.connect();
  }

  let idSinc = null;
  try {
    if (cliente) {
      idSinc = (await cliente.query(`insert into sincronizacoes (modo) values ($1) returning id`, [a.modo])).rows[0].id;
      await cliente.query('begin');
    }
    const resumo = await executarMigracao({ fb, db: cliente, modo: a.modo, dias: a.dias, somente: a.somente });
    if (cliente) {
      await cliente.query('commit');
      await cliente.query(`update sincronizacoes set fim = now(), resumo = $2 where id = $1`, [idSinc, resumo]);
      if (a.modo === 'completo' && !a.somente) {
        console.log('\nConferência origem x destino:');
        for (const c of await conferir(fb, cliente)) console.log(`  ${c.ok ? 'OK ' : 'DIF'} ${c.item.padEnd(34)} ${String(c.origem).padStart(14)} ${String(c.destino).padStart(14)}`);
      }
    }
    console.log('\nConcluído.');
  } catch (erro) {
    if (cliente) {
      await cliente.query('rollback').catch(() => {});
      if (idSinc) await cliente.query(`update sincronizacoes set fim = now(), erro = $2 where id = $1`, [idSinc, String(erro.message || erro)]).catch(() => {});
    }
    throw erro;
  } finally {
    await fb.fechar();
    if (cliente) await cliente.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((e) => { console.error('\nERRO:', e.message || e); process.exit(1); });
}
