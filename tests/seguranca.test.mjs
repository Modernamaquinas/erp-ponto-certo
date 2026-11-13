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
  for (const f of ['002_seguranca.sql', '004_cartoes_seguranca.sql', '006_fiscal_seguranca.sql', '008_pdv_seguranca.sql', '011_edicao_seguranca.sql', '013_etiquetas_seguranca.sql', '017_relatorios_seguranca.sql', '019_consignado_seguranca.sql', '021_entrada_compras_seguranca.sql', '023_marketplaces_seguranca.sql', '025_painel_caixa_seguranca.sql']) {
    await db.exec(readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8'));
  }
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
    // dado de cobrança não marca o cadastro como editado; o cadastro em si, sim
    assert.equal((await db.query('select alterado_erp from clientes where id = 10')).rows[0].alterado_erp, false);
    await como(db, FIN, `update clientes set nome = 'OUTRO', cidade_id = null where id = 10`);
    assert.deepEqual((await db.query('select nome, alterado_erp from clientes where id = 10')).rows[0], { nome: 'OUTRO', alterado_erp: true });
    await assert.rejects(como(db, FIN, `update clientes set asaas_customer_id = 'x' where id = 10`), /permission denied/);

    // produtos: financeiro edita preço/cadastro, mas não o estoque; vendedor não edita
    await como(db, FIN, `update produtos set preco_venda = 6.5, ncm = '82023900' where id = 5`);
    assert.deepEqual((await db.query('select preco_venda::text as p, alterado_erp from produtos where id = 5')).rows[0], { p: '6.50', alterado_erp: true });
    await assert.rejects(como(db, FIN, `update produtos set estoque = 999 where id = 5`), /permission denied/);
    await como(db, VEND, `update produtos set preco_venda = 1 where id = 5`);
    assert.equal((await db.query('select preco_venda::text as p from produtos where id = 5')).rows[0].p, '6.50');
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

    // TEF: o caixa (vendedor) registra pelo PDV, mas não lê nem grava direto; taxas só o financeiro
    await como(db, VEND, `select pdv_registrar_tef('{"situacao":"aprovada","rede":"cielo","modalidade":"debito","valor":10,"nsu":"1","data_hora":"2026-11-06 10:00"}')`);
    assert.equal((await db.query(`select count(*)::int as n from tef_transacoes where origem = 'erp' and rede = 'CIELO'`)).rows[0].n, 1);
    assert.equal((await como(db, VEND, 'select * from tef_transacoes')).rows.length, 0);
    assert.equal((await como(db, FIN, 'select * from tef_transacoes')).rows.length, 1);
    await assert.rejects(como(db, VEND, `select registrar_transacao_tef('{"situacao":"aprovada"}')`), /permission denied/);
    await assert.rejects(como(db, VEND, `insert into tef_transacoes (situacao, valor) values ('aprovada', 1)`), /row-level security/);
    await assert.rejects(como(db, null, `select pdv_registrar_tef('{"situacao":"aprovada"}')`), /permission denied|Sem permissão/);
    await assert.rejects(como(db, VEND, `insert into cartao_taxas (rede, modalidade, taxa_percentual, dias_recebimento) values ('CIELO', 'debito', 1, 1)`), /row-level security/);
    await como(db, FIN, `insert into cartao_taxas (rede, modalidade, taxa_percentual, dias_recebimento) values ('CIELO', 'debito', 1.2, 1)`);
    assert.equal((await como(db, FIN, 'select valor_liquido::text as l from v_cartoes_recebiveis')).rows[0].l, '9.88');
    assert.equal((await como(db, VEND, 'select * from v_cartoes_recebiveis')).rows.length, 0);

    // PDV: código do operador é segredo (só admin vê); venda e orçamento só pela API (service role)
    await db.exec(`insert into operadores (codigo, nome) values ('1234', 'OP')`);
    assert.equal((await como(db, VEND, 'select * from operadores')).rows.length, 0);
    assert.equal((await como(db, FIN, 'select * from operadores')).rows.length, 0);
    assert.equal((await como(db, ADMIN, 'select codigo from operadores')).rows[0].codigo, '1234');
    await assert.rejects(como(db, VEND, `select finalizar_venda('{}')`), /permission denied/);
    await assert.rejects(como(db, ADMIN, `select salvar_orcamento('{}')`), /permission denied/);
    await assert.rejects(como(db, VEND, `insert into orcamentos (data) values (current_date)`), /row-level security/);

    // Etiquetas: todos leem os modelos; só o admin altera
    await db.exec(`insert into etiqueta_modelos (id, descricao) values (2, 'M2'); insert into etiqueta_campos (modelo_id, fonte, linha, esquerda, texto) values (2, '1', 10, 10, '[PRECO]')`);
    assert.equal((await como(db, VEND, 'select * from etiqueta_campos')).rows.length, 1);
    assert.equal((await como(db, VEND, `update etiqueta_modelos set descricao = 'X' returning id`)).rows.length, 0);
    assert.equal((await como(db, ADMIN, `update etiqueta_modelos set descricao = 'X' returning id`)).rows.length, 1);
    await assert.rejects(como(db, FIN, `insert into etiqueta_modelos (descricao) values ('Y')`), /row-level security/);
  } finally {
    await db.close();
  }
});

test('relatórios e contagem cíclica por papel (017)', async () => {
  const db = await preparar();
  try {
    await assert.rejects(como(db, VEND, 'select rel_vendas(current_date - 30, current_date)'), /não tem acesso/);
    await assert.rejects(como(db, VEND, 'select rel_receber(current_date - 30, current_date)'), /não tem acesso/);
    await assert.rejects(como(db, null, 'select rel_estoque(180)'), /permission denied|não tem acesso/);
    const r = await como(db, FIN, 'select rel_vendas(current_date - 30, current_date) as r');
    assert.equal(r.rows[0].r.resumo.qtd, 0);
    await assert.rejects(como(db, FIN, 'select rel_resumo_vendas(current_date, current_date)'), /permission denied/);

    await db.exec('update produtos set estoque = 4 where id = 5');
    await assert.rejects(como(db, VEND, `select contagem_criar('{}')`), /não tem acesso/);
    const id = Number((await como(db, FIN, `select contagem_criar('{"descricao":"Teste"}') as id`)).rows[0].id);
    assert.equal((await db.query('select criada_por from contagens where id = $1', [id])).rows[0].criada_por, 'Fin');
    // vendedor conta (com o nome dele), vê a lista, mas não fecha nem grava direto na tabela
    await como(db, VEND, 'select contagem_lancar($1, 5, 3)', [id]);
    assert.equal((await db.query('select contado_por from contagem_itens where contagem_id = $1', [id])).rows[0].contado_por, 'Vend');
    assert.equal((await como(db, VEND, 'select * from contagem_itens')).rows.length, 1);
    await assert.rejects(como(db, VEND, 'select contagem_finalizar($1, true)', [id]), /não tem acesso/);
    await como(db, VEND, 'update contagem_itens set quantidade = 999');
    assert.equal(Number((await db.query('select quantidade from contagem_itens')).rows[0].quantidade), 3);
    await assert.rejects(como(db, null, 'select contagem_lancar($1, 5, 1)', [id]), /permission denied|não tem acesso/);
    await como(db, ADMIN, 'select contagem_finalizar($1, true)', [id]);
    assert.equal(Number((await db.query('select estoque from produtos where id = 5')).rows[0].estoque), 3);
  } finally { await db.close(); }
});

test('entrada de notas e lista de compras só para admin/financeiro (021)', async () => {
  const db = await preparar();
  try {
    await assert.rejects(como(db, VEND, `select lista_compras('{}')`), /não tem acesso/);
    await assert.rejects(como(db, VEND, `select lancar_compra('{"itens":[{"item":1}]}')`), /não tem acesso/);
    await assert.rejects(como(db, VEND, `select entrada_preparar('{}')`), /não tem acesso/);
    await assert.rejects(como(db, null, `select lista_compras('{}')`), /permission denied|não tem acesso/);
    assert.ok((await como(db, FIN, `select lista_compras('{}') as r`)).rows[0].r.resumo);
    assert.deepEqual((await como(db, VEND, `select fiscal_sugestoes_ncm('82023900') as r`)).rows[0].r, []);
  } finally { await db.close(); }
});
