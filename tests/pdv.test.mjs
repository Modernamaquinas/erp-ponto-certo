// PDV: finalizar_venda / salvar_orcamento (007_pdv.sql) e rateio do desconto para a NFC-e.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoDeTeste } from './pgteste.mjs';
import { ratearDesconto } from '../api/_lib/pdv.js';

async function preparar() {
  const db = await bancoDeTeste();
  await db.exec(`
    insert into formas_pagamento (id, descricao) values (2, 'DINHEIRO'), (7, 'CARTAO CREDITO'), (8, 'CARTAO DEBITO'), (13, 'PIX'), (14, 'CREDIARIO');
    insert into clientes (id, nome, cpf_cnpj) values (1, 'AO CONSUMIDOR', null), (10, 'CLIENTE CREDIARIO', '11144477735');
    insert into clientes (id, nome, bloqueado) values (11, 'CLIENTE BLOQUEADO', true);
    insert into produtos (id, nome, preco_venda, custo, estoque) values (5, 'SERRA P/ ARCO', 10, 4, 3), (6, 'FITA', 20, 15, 100);
    insert into operadores (codigo, nome, desconto_maximo) values ('1234', 'LUCAS', 10);
    insert into operadores (codigo, nome, desconto_maximo, vende_sem_estoque, vende_abaixo_custo) values ('9999', 'GERENTE', 100, true, true);
    insert into operadores (codigo, nome, ativo) values ('0000', 'INATIVO', false);
  `);
  return db;
}
const venda = (db, p) => db.query('select finalizar_venda($1) as id', [JSON.stringify(p)]).then((r) => Number(r.rows[0].id));
const um = async (db, sql, params) => (await db.query(sql, params)).rows[0];

test('venda à vista: estoque, caixa, troco e operador', async () => {
  const db = await preparar();
  try {
    const id = await venda(db, { operador_codigo: '1234', itens: [{ produto_id: 5, quantidade: 2, preco_unitario: 10 }],
      pagamentos: [{ forma: 'dinheiro', valor: 50 }] });
    assert.ok(id >= 1000000);
    const v = await um(db, `select total::text, situacao, origem, o.nome from vendas v join operadores o on o.id = v.operador_id where v.id = $1`, [id]);
    assert.deepEqual(v, { total: '20.00', situacao: 'finalizada', origem: 'erp', nome: 'LUCAS' });
    assert.equal((await um(db, 'select estoque::text from produtos where id = 5')).estoque, '1.000');
    const cx = (await db.query(`select entrada::text, saida::text from caixa_lancamentos order by id`)).rows;
    assert.deepEqual(cx, [{ entrada: '50.00', saida: '0.00' }, { entrada: '0.00', saida: '30.00' }]);
  } finally { await db.close(); }
});

test('regras: código, estoque, desconto máximo, custo, pagamento e troco', async () => {
  const db = await preparar();
  try {
    const base = { itens: [{ produto_id: 5, quantidade: 1, preco_unitario: 10 }], pagamentos: [{ forma: 'pix', valor: 10 }] };
    await assert.rejects(venda(db, { ...base, operador_codigo: '0000' }), /Código de operador inválido/);
    await assert.rejects(venda(db, { ...base, operador_codigo: '4321' }), /Código de operador inválido/);
    await assert.rejects(venda(db, { ...base, operador_codigo: '1234', itens: [{ produto_id: 5, quantidade: 4, preco_unitario: 10 }],
      pagamentos: [{ forma: 'pix', valor: 40 }] }), /Estoque insuficiente de SERRA P\/ ARCO \(disponível: 3\)/);
    await assert.rejects(venda(db, { ...base, operador_codigo: '1234', desconto_geral: 2, pagamentos: [{ forma: 'pix', valor: 8 }] }), /acima do permitido/);
    await assert.rejects(venda(db, { ...base, operador_codigo: '1234', itens: [{ produto_id: 6, quantidade: 1, preco_unitario: 14 }],
      pagamentos: [{ forma: 'pix', valor: 14 }] }), /abaixo do custo/);
    await assert.rejects(venda(db, { ...base, operador_codigo: '1234', pagamentos: [{ forma: 'pix', valor: 9 }] }), /menor que o total/);
    await assert.rejects(venda(db, { ...base, operador_codigo: '1234', pagamentos: [{ forma: 'pix', valor: 12 }] }), /Troco só é permitido/);
    await assert.rejects(venda(db, { ...base, operador_codigo: '1234', pagamentos: [{ forma: 'crediario', valor: 10 }] }), /Crediário exige cliente/);
    await assert.rejects(venda(db, { ...base, operador_codigo: '1234', cliente_id: 11, pagamentos: [{ forma: 'crediario', valor: 10 }] }), /bloqueado/);
    // gerente pode tudo: sem estoque, abaixo do custo e com desconto grande
    await venda(db, { operador_codigo: '9999', desconto_geral: 5, itens: [{ produto_id: 5, quantidade: 4, preco_unitario: 3 }],
      pagamentos: [{ forma: 'pix', valor: 7 }] });
    assert.equal((await um(db, 'select estoque::text from produtos where id = 5')).estoque, '-1.000');
    // nada foi gravado pelas vendas recusadas (transação)
    assert.equal((await um(db, 'select count(*)::int as n from vendas')).n, 1);
  } finally { await db.close(); }
});

test('crediário gera parcelas mensais no contas a receber', async () => {
  const db = await preparar();
  try {
    const id = await venda(db, { operador_codigo: '1234', cliente_id: 10, itens: [{ produto_id: 6, quantidade: 5, preco_unitario: 20 }],
      pagamentos: [{ forma: 'crediario', valor: 100, parcelas: 3, primeiro_vencimento: '2026-12-10' }] });
    const parc = (await db.query(`select parcela, vencimento::text, valor::text, status from contas_receber where venda_id = $1 order by parcela`, [id])).rows;
    assert.deepEqual(parc, [
      { parcela: 1, vencimento: '2026-12-10', valor: '33.33', status: 'aberto' },
      { parcela: 2, vencimento: '2027-01-10', valor: '33.33', status: 'aberto' },
      { parcela: 3, vencimento: '2027-02-10', valor: '33.34', status: 'aberto' },
    ]);
    assert.equal((await um(db, 'select count(*)::int as n from caixa_lancamentos')).n, 0);
  } finally { await db.close(); }
});

test('orçamento: salva sem mexer no estoque, edita e vira venda', async () => {
  const db = await preparar();
  try {
    const orc = Number((await um(db, 'select salvar_orcamento($1) as id', [JSON.stringify({ operador_codigo: '1234', cliente_id: 10,
      itens: [{ produto_id: 5, quantidade: 10, preco_unitario: 10 }] })])).id);
    assert.equal((await um(db, 'select estoque::text from produtos where id = 5')).estoque, '3.000');
    await db.query('select salvar_orcamento($1)', [JSON.stringify({ id: orc, operador_codigo: '1234', cliente_id: 10, validade: '2026-12-01',
      itens: [{ produto_id: 5, quantidade: 2, preco_unitario: 10 }, { produto_id: 6, quantidade: 1, preco_unitario: 20 }] })]);
    const o = await um(db, 'select total::text, validade::text, (select count(*)::int from orcamento_itens where orcamento_id = $1) as itens from orcamentos where id = $1', [orc]);
    assert.deepEqual(o, { total: '40.00', validade: '2026-12-01', itens: 2 });
    const id = await venda(db, { operador_codigo: '1234', orcamento_id: orc, cliente_id: 10,
      itens: [{ produto_id: 5, quantidade: 2, preco_unitario: 10 }, { produto_id: 6, quantidade: 1, preco_unitario: 20 }], pagamentos: [{ forma: 'debito', valor: 40 }] });
    assert.deepEqual(await um(db, 'select status, venda_id::int as v from orcamentos where id = $1', [orc]), { status: 'convertido', v: id });
    await assert.rejects(venda(db, { operador_codigo: '1234', orcamento_id: orc, itens: [{ produto_id: 6, quantidade: 1, preco_unitario: 20 }],
      pagamentos: [{ forma: 'pix', valor: 20 }] }), /Orçamento não está aberto/);
  } finally { await db.close(); }
});

test('rateio do desconto geral entre os itens (NFC-e)', () => {
  const r = ratearDesconto([{ quantidade: 2, preco_unitario: 10, desconto: 0 }, { quantidade: 1, preco_unitario: 30, desconto: 1 }], 5);
  assert.deepEqual(r.map((i) => i.desconto), [2.04, 3.96]);
  assert.equal(r.reduce((s, i) => s + i.desconto, 0).toFixed(2), '6.00');
  assert.deepEqual(ratearDesconto([{ quantidade: 1, preco_unitario: 3, desconto: 0 }, { quantidade: 3, preco_unitario: 1, desconto: 0 }], 1)
    .map((i) => i.desconto), [0.5, 0.5]);
  assert.deepEqual(ratearDesconto([{ quantidade: 1, preco_unitario: 5, desconto: 1 }], 0).map((i) => i.desconto), [1]);
});
