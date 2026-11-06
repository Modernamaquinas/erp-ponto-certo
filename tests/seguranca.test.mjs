// RLS e papéis (002_seguranca.sql) num Postgres embutido, simulando o que o Supabase fornece:
// schema auth, auth.uid() lendo o "sub" do JWT, papéis anon/authenticated/authenticator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bancoDeTeste } from './pgteste.mjs';

const ADMIN = '00000000-0000-0000-0000-00000000000a';
const FIN = '00000000-0000-0000-0000-00000000000f';
const VEND = '00000000-0000-0000-0000-00000000000e';

async function preparar() {
  const db = await bancoDeTeste();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role authenticator nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant all on all tables in schema public to anon, authenticated;
    grant all on all sequences in schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
  `);
  await db.exec(readFileSync(new URL('../supabase/migrations/002_seguranca.sql', import.meta.url), 'utf8'));
  await db.exec(`
    insert into auth.users values ('${ADMIN}'), ('${FIN}'), ('${VEND}');
    insert into perfis (user_id, nome, papel) values ('${ADMIN}', 'Admin', 'admin'), ('${FIN}', 'Fin', 'financeiro'), ('${VEND}', 'Vend', 'vendedor');
    insert into clientes (id, nome, cpf_cnpj) values (10, 'CLIENTE TESTE', '04440424074');
    insert into produtos (id, nome, preco_venda) values (5, 'SERRA P/ ARCO', 5.9);
    insert into formas_pagamento (id, descricao) values (2, 'DINHEIRO');
    insert into contas_receber (id, cliente_id, vencimento, valor, saldo) values (100, 10, current_date, 50, 50);
    insert into contas_pagar (id, vencimento, valor, saldo) values (200, current_date, 80, 80);
  `);
  return db;
}

/** Executa como usuário autenticado (ou anônimo se uid = null). */
async function como(db, uid, sql, params) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
  }
}

test('RLS por papel', async () => {
  const db = await preparar();
  try {
    // anônimo não vê nada
    assert.equal((await como(db, null, 'select * from produtos')).rows.length, 0);
    assert.equal((await como(db, null, 'select * from contas_receber')).rows.length, 0);

    // vendedor: consulta cadastros, mas não o financeiro
    assert.equal((await como(db, VEND, 'select * from produtos')).rows.length, 1);
    assert.equal((await como(db, VEND, 'select * from contas_receber')).rows.length, 0);
    await assert.rejects(como(db, VEND, `select baixar_conta_receber(100, 10, current_date, 2)`), /não encontrada/);
    await como(db, VEND, `update contas_pagar set status = 'pago' where id = 200`);
    assert.equal((await db.query(`select status from contas_pagar where id = 200`)).rows[0].status, 'aberto');

    // financeiro: baixa e edita dados de cobrança do cliente, mas não o cadastro
    const r = await como(db, FIN, `select (baixar_conta_receber(100, 50, current_date, 2, 'Fin')).status`);
    assert.equal(r.rows[0].status, 'pago');
    await como(db, FIN, `update clientes set celular_cobranca = '54999990000' where id = 10`);
    assert.equal((await db.query(`select celular_cobranca from clientes where id = 10`)).rows[0].celular_cobranca, '54999990000');
    await assert.rejects(como(db, FIN, `update clientes set nome = 'OUTRO' where id = 10`), /permission denied/);
    // não pode confirmar pagamento Asaas pelo navegador (só o webhook, com service role)
    await assert.rejects(como(db, FIN, `select confirmar_cobranca_paga('x', current_date, 1, 1, 'PIX')`), /permission denied/);

    // perfis: vendedor só se vê; admin vê todos
    assert.equal((await como(db, VEND, 'select * from perfis')).rows.length, 1);
    assert.equal((await como(db, ADMIN, 'select * from perfis')).rows.length, 3);
    await como(db, VEND, `update perfis set papel = 'admin' where user_id = '${VEND}'`);
    assert.equal((await db.query(`select papel from perfis where user_id = '${VEND}'`)).rows[0].papel, 'vendedor');

    // conta lançada no ERP pode ser excluída; herdada do legado não
    await como(db, FIN, `insert into contas_pagar (vencimento, valor, saldo) values (current_date, 10, 10)`);
    await como(db, FIN, `delete from contas_pagar`);
    const restantes = (await db.query(`select id from contas_pagar order by id`)).rows.map((x) => Number(x.id));
    assert.deepEqual(restantes, [200]);
  } finally {
    await db.close();
  }
});
