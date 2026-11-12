// Consignado e vencimento do crediário no dia 10 (018_consignado.sql).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoDeTeste } from './pgteste.mjs';

async function preparar() {
  const db = await bancoDeTeste();
  await db.exec(`
    insert into formas_pagamento (id, descricao) values (2, 'DINHEIRO'), (13, 'PIX'), (14, 'CREDIARIO');
    insert into clientes (id, nome, cpf_cnpj) values (10, 'OBRA DO JOAO', '11144477735'), (11, 'OUTRO CLIENTE', null);
    insert into clientes (id, nome, bloqueado) values (12, 'BLOQUEADO', true);
    insert into produtos (id, nome, preco_venda, custo, estoque) values (5, 'TORNEIRA', 50, 20, 10), (6, 'SIFAO', 20, 8, 4), (7, 'REGISTRO', 30, 10, 5);
    insert into operadores (codigo, nome, desconto_maximo) values ('1234', 'LUCAS', 10);
  `);
  return db;
}
const um = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const estoque = async (db, id) => Number((await um(db, 'select estoque from produtos where id = $1', [id])).estoque);
const salvar = (db, p) => db.query('select salvar_orcamento($1) as id', [JSON.stringify({ operador_codigo: '1234', ...p })]).then((r) => Number(r.rows[0].id));
const vender = (db, p) => db.query('select finalizar_venda($1) as id', [JSON.stringify({ operador_codigo: '1234', ...p })]).then((r) => Number(r.rows[0].id));
const consignar = (db, extra = {}) => salvar(db, { tipo: 'consignado', cliente_id: 10, validade: '2026-12-31',
  itens: [{ produto_id: 5, quantidade: 3, preco_unitario: 50 }, { produto_id: 6, quantidade: 2, preco_unitario: 20 }], ...extra });

test('consignado: estoque sai na entrega, acerto vende o que ficou e devolve o resto', async () => {
  const db = await preparar();
  try {
    await assert.rejects(consignar(db, { cliente_id: null }), /exige cliente cadastrado/);
    await assert.rejects(consignar(db, { cliente_id: 12 }), /bloqueado/);
    await assert.rejects(consignar(db, { itens: [{ produto_id: 6, quantidade: 9, preco_unitario: 20 }] }), /Estoque insuficiente/);
    const id = await consignar(db);
    assert.deepEqual(await um(db, 'select status, tipo, cliente_id::int from orcamentos where id = $1', [id]), { status: 'consignado', tipo: 'consignado', cliente_id: 10 });
    assert.equal(await estoque(db, 5), 7);
    assert.equal(await estoque(db, 6), 2);
    // não dá mais para editar nem cancelar como orçamento
    await assert.rejects(salvar(db, { id, tipo: 'consignado', cliente_id: 10, itens: [{ produto_id: 5, quantidade: 1, preco_unitario: 50 }] }), /não está aberto/);

    // acerto: regras
    const base = { orcamento_id: id, cliente_id: 10, pagamentos: [{ forma: 'pix', valor: 100 }] };
    await assert.rejects(vender(db, { ...base, itens: [{ produto_id: 5, quantidade: 4, preco_unitario: 50 }], pagamentos: [{ forma: 'pix', valor: 200 }] }), /maior que a levada/);
    await assert.rejects(vender(db, { ...base, itens: [{ produto_id: 7, quantidade: 1, preco_unitario: 30 }], pagamentos: [{ forma: 'pix', valor: 30 }] }), /não saiu neste consignado/);
    await assert.rejects(vender(db, { ...base, cliente_id: 11, itens: [{ produto_id: 5, quantidade: 2, preco_unitario: 50 }] }), /é do cliente OBRA DO JOAO/);

    // ficou com 2 torneiras e nenhum sifão; o estoque do sifão pode até ter sido vendido a outro cliente no meio
    await db.exec('update produtos set estoque = 0 where id = 6');
    const venda = await vender(db, { ...base, itens: [{ produto_id: 5, quantidade: 2, preco_unitario: 50 }] });
    assert.equal(await estoque(db, 5), 8, '7 + 1 torneira devolvida (as 2 vendidas já tinham saído)');
    assert.equal(await estoque(db, 6), 2, '0 + 2 sifões devolvidos');
    const o = await um(db, 'select status, venda_id::int from orcamentos where id = $1', [id]);
    assert.deepEqual(o, { status: 'convertido', venda_id: venda });
    const dev = (await db.query('select produto_id::int, quantidade_devolvida::text as d from orcamento_itens where orcamento_id = $1 order by item', [id])).rows;
    assert.deepEqual(dev, [{ produto_id: 5, d: '1.000' }, { produto_id: 6, d: '2.000' }]);
    assert.match((await um(db, 'select observacao from vendas where id = $1', [venda])).observacao, /ACERTO DO CONSIGNADO/);
    await assert.rejects(vender(db, { ...base, itens: [{ produto_id: 5, quantidade: 1, preco_unitario: 50 }], pagamentos: [{ forma: 'pix', valor: 50 }] }), /já foi acertado/);
  } finally { await db.close(); }
});

test('consignado devolvido por inteiro volta ao estoque', async () => {
  const db = await preparar();
  try {
    const id = await consignar(db);
    await db.query('select consignado_devolver($1)', [JSON.stringify({ operador_codigo: '1234', id })]);
    assert.equal(await estoque(db, 5), 10);
    assert.equal(await estoque(db, 6), 4);
    assert.equal((await um(db, 'select status from orcamentos where id = $1', [id])).status, 'devolvido');
    await assert.rejects(db.query('select consignado_devolver($1)', [JSON.stringify({ operador_codigo: '1234', id })]), /não está em aberto/);
    // orçamento comum continua sem mexer no estoque
    await salvar(db, { cliente_id: 11, itens: [{ produto_id: 5, quantidade: 3, preco_unitario: 50 }] });
    assert.equal(await estoque(db, 5), 10);
  } finally { await db.close(); }
});

test('crediário vence sempre no dia 10 do mês seguinte', async () => {
  const db = await preparar();
  try {
    assert.equal((await um(db, `select vencimento_crediario('2026-11-12')::text as d`)).d, '2026-12-10');
    assert.equal((await um(db, `select vencimento_crediario('2026-12-31')::text as d`)).d, '2027-01-10');
    assert.equal((await um(db, `select vencimento_crediario('2027-01-31')::text as d`)).d, '2027-02-10');
    const v = await vender(db, { cliente_id: 10, itens: [{ produto_id: 5, quantidade: 3, preco_unitario: 50 }],
      pagamentos: [{ forma: 'crediario', valor: 150, parcelas: 3, primeiro_vencimento: '2030-01-01' }] });
    const parc = (await db.query('select vencimento::text as v from contas_receber where venda_id = $1 order by parcela', [v])).rows.map((r) => r.v);
    const base = (await um(db, `select vencimento_crediario((now() at time zone 'America/Sao_Paulo')::date) as d`)).d;
    const d = new Date(base);
    const esperado = [0, 1, 2].map((k) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 10)).toISOString().slice(0, 10));
    assert.deepEqual(parc, esperado, 'ignora a data enviada pelo navegador');
  } finally { await db.close(); }
});

test('reserva: separa o estoque, venda acerta a diferença, liberar devolve', async () => {
  const db = await preparar();
  try {
    await assert.rejects(salvar(db, { tipo: 'reserva', itens: [{ produto_id: 5, quantidade: 1, preco_unitario: 50 }] }), /Informe o cliente da reserva/);
    const id = await salvar(db, { tipo: 'reserva', cliente_nome: 'balcao maria', itens: [{ produto_id: 5, quantidade: 4, preco_unitario: 50 }] });
    assert.equal((await um(db, 'select status from orcamentos where id = $1', [id])).status, 'reservado');
    assert.equal(await estoque(db, 5), 6, 'reservado sai do disponível');
    // outro cliente não consegue comprar o que está reservado
    await assert.rejects(vender(db, { itens: [{ produto_id: 5, quantidade: 7, preco_unitario: 50 }], pagamentos: [{ forma: 'pix', valor: 350 }] }), /Estoque insuficiente/);
    // vende 3 das 4 reservadas (sem cliente cadastrado: reserva não exige)
    await vender(db, { orcamento_id: id, cliente_nome: 'BALCAO MARIA', itens: [{ produto_id: 5, quantidade: 3, preco_unitario: 50 }], pagamentos: [{ forma: 'pix', valor: 150 }] });
    assert.equal(await estoque(db, 5), 7, '6 + 1 que sobrou da reserva');
    assert.equal((await um(db, 'select status from orcamentos where id = $1', [id])).status, 'convertido');
    // liberar uma reserva sem venda
    const id2 = await salvar(db, { tipo: 'reserva', cliente_id: 11, itens: [{ produto_id: 7, quantidade: 2, preco_unitario: 30 }] });
    assert.equal(await estoque(db, 7), 3);
    await db.query('select consignado_devolver($1)', [JSON.stringify({ operador_codigo: '1234', id: id2 })]);
    assert.equal(await estoque(db, 7), 5);
    assert.equal((await um(db, 'select status from orcamentos where id = $1', [id2])).status, 'cancelado');
  } finally { await db.close(); }
});

test('entrega marcada na venda, com ou sem cadastro', async () => {
  const db = await preparar();
  try {
    const base = { itens: [{ produto_id: 7, quantidade: 1, preco_unitario: 30 }], pagamentos: [{ forma: 'pix', valor: 30 }] };
    await assert.rejects(vender(db, { ...base, entrega: { nome: 'ANA', telefone: '54999990000' } }), /informe o endereço/);
    await assert.rejects(vender(db, { ...base, endereco_entrega: 'RUA A, 10', entrega: { telefone: '54999990000' } }), /nome de quem recebe/);
    await assert.rejects(vender(db, { ...base, endereco_entrega: 'RUA A, 10', entrega: { nome: 'ANA', telefone: '999' } }), /telefone com DDD/);
    await assert.rejects(vender(db, { ...base, endereco_entrega: 'RUA A, 10', entrega: { nome: 'ANA', telefone: '54999990000', data: '2020-01-01' } }), /data já passou/);
    const v = await vender(db, { ...base, endereco_entrega: 'RUA A, 10 - CENTRO', entrega: { nome: 'ana souza', telefone: '(54) 99999-0000', data: '2099-01-02', horario: '14h às 16h' } });
    assert.deepEqual(await um(db, 'select entrega, entrega_nome, entrega_telefone, entrega_data::text, entrega_horario, endereco_entrega from vendas where id = $1', [v]),
      { entrega: true, entrega_nome: 'ANA SOUZA', entrega_telefone: '54999990000', entrega_data: '2099-01-02', entrega_horario: '14h às 16h', endereco_entrega: 'RUA A, 10 - CENTRO' });
    // cliente cadastrado: nome/telefone opcionais (vêm do cadastro)
    const v2 = await vender(db, { ...base, cliente_id: 10, endereco_entrega: 'RUA B, 5', entrega: {} });
    assert.equal((await um(db, 'select entrega from vendas where id = $1', [v2])).entrega, true);
    const v3 = await vender(db, base);
    assert.equal((await um(db, 'select entrega from vendas where id = $1', [v3])).entrega, false);
  } finally { await db.close(); }
});
