// Relatórios e contagem cíclica (016_relatorios.sql).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoDeTeste } from './pgteste.mjs';

async function preparar() {
  const db = await bancoDeTeste();
  await db.exec(`
    insert into formas_pagamento (id, descricao) values (2, 'DINHEIRO'), (13, 'PIX'), (16, 'CARTAO CREDITO TEF'), (14, 'CREDIARIO');
    insert into grupos_produto (id, nome) values (1, 'FERRAMENTAS'), (2, 'ELETRICA');
    insert into clientes (id, nome) values (10, 'JOAO'), (11, 'MARIA');
    insert into fornecedores (id, nome) values (20, 'DISTRIBUIDORA X');
    insert into usuarios_legado (id, nome) values (3, 'CARLOS');
    insert into produtos (id, nome, grupo_id, preco_venda, custo, estoque, estoque_minimo, data_ultima_saida) values
      (5, 'MARTELO', 1, 50, 20, 10, 2, hoje_loja()), (6, 'FIO', 2, 10, 4, 1, 5, hoje_loja() - 400),
      (7, 'ALICATE', 1, 30, 0, -2, null, null), (8, 'PARADO', 2, 100, 60, 3, null, hoje_loja() - 500);
    insert into vendas (id, data, hora, cliente_id, total, desconto, valor_frete, situacao, vendedor_legado, numero_nfce) values
      (1, hoje_loja(), '09:15', 10, 100, 0, 0, 'finalizada', 3, 1),
      (2, hoje_loja(), '15:40', 11, 60, 0, 10, 'finalizada', 3, null),
      (3, hoje_loja(), '10:00', null, 99999, 0, 0, 'estornada', null, null),
      (4, hoje_loja() - 40, '11:00', 10, 30, 0, 0, 'finalizada', null, null);
    insert into venda_itens (venda_id, item, produto_id, quantidade, preco_unitario, total, custo) values
      (1, 1, 5, 2, 50, 100, 20), (2, 1, 6, 5, 10, 50, 4), (3, 1, 5, 999, 100, 99999, 20), (4, 1, 7, 1, 30, 30, null);
    -- venda 1: 120 em dinheiro para 100 => 20 de troco; venda 2: pix + crédito; venda 4 sem pagamento registrado
    insert into venda_pagamentos (venda_id, item, forma_pagamento_id, valor) values (1, 1, 2, 120), (2, 1, 13, 30), (2, 2, 16, 30);
    insert into contas_receber (id, cliente_id, vencimento, valor, saldo, status) values
      (100, 10, hoje_loja() - 45, 80, 80, 'aberto'), (101, 11, hoje_loja() + 10, 40, 40, 'aberto'), (102, 11, hoje_loja() - 5, 25, 0, 'pago');
    insert into recebimentos (conta_receber_id, data, forma_pagamento_id, valor, origem) values (102, hoje_loja(), 13, 25, 'erp');
    insert into contas_pagar (id, fornecedor_id, vencimento, valor, saldo, status, conferir_baixa_legado, data_pagamento, valor_pago) values
      (200, 20, hoje_loja() + 3, 70, 70, 'aberto', false, null, 0), (201, 20, hoje_loja() - 300, 500, 500, 'aberto', true, null, 0),
      (202, 20, hoje_loja() - 2, 45, 0, 'pago', false, hoje_loja(), 45);
    insert into caixa_lancamentos (data, entrada, saida, forma_pagamento_id) values (hoje_loja(), 120, 0, 2), (hoje_loja(), 0, 20, 2), (hoje_loja(), 30, 0, 13);
  `);
  return db;
}
const rel = async (db, sql) => (await db.query(`select ${sql} as r`)).rows[0].r;
const porChave = (lista, k) => Object.fromEntries(lista.map((x) => [x[k], x]));

test('vendas: só finalizadas, troco fora do dinheiro, frete fora do lucro, comparativo', async () => {
  const db = await preparar();
  try {
    const r = await rel(db, 'rel_vendas(hoje_loja() - 6, hoje_loja())');
    assert.equal(r.resumo.qtd, 2);
    assert.equal(Number(r.resumo.total), 160);
    assert.equal(Number(r.resumo.frete), 10);
    assert.equal(Number(r.resumo.custo), 60); // 2*20 + 5*4
    assert.equal(Number(r.resumo.lucro), 90); // (160-10) - 60
    assert.equal(r.serie.length, 7);
    const f = porChave(r.por_forma, 'forma');
    assert.equal(Number(f.Dinheiro.total), 100);
    assert.equal(Number(f.PIX.total), 30);
    assert.equal(Number(f['Cartão de crédito'].total), 30);
    const s = porChave(r.por_situacao, 'situacao');
    assert.equal(s.estornada.qtd, 1);
    assert.equal(s.estornada.total, null, 'estornada não soma valor');
    assert.equal(r.por_vendedor[0].vendedor, 'CARLOS');
    assert.equal(r.top_produtos[0].nome, 'MARTELO');
    assert.deepEqual(r.por_hora.map((h) => h.hora), [9, 15]);
    const d = porChave(r.por_documento, 'documento');
    assert.equal(Number(d['NFC-e'].total), 100);
    // período de 60 dias pega a venda 4 sem pagamento => "Sem informação"
    const r2 = await rel(db, 'rel_vendas(hoje_loja() - 59, hoje_loja())');
    assert.equal(Number(porChave(r2.por_forma, 'forma')['Sem informação'].total), 30);
    assert.ok(Number(r2.resumo.cobertura_custo) < 100);
    const anual = await rel(db, 'rel_vendas(hoje_loja() - 364, hoje_loja())');
    assert.equal(anual.periodo.agrupamento, 'mes');
    await assert.rejects(db.query('select rel_vendas(hoje_loja(), hoje_loja() - 1)'), /Período inválido/);
  } finally { await db.close(); }
});

test('estoque: valores, abaixo do mínimo, negativos, sem giro e curva ABC', async () => {
  const db = await preparar();
  try {
    const r = await rel(db, 'rel_estoque(180)');
    assert.equal(r.resumo.itens, 4);
    assert.equal(r.resumo.negativos, 1);
    assert.equal(r.resumo.abaixo_minimo, 1);
    assert.equal(Number(r.resumo.valor_custo), 10 * 20 + 1 * 4 + 3 * 60);
    assert.equal(r.resumo.sem_giro, 2); // FIO (400 dias) e PARADO (500)
    assert.equal(r.sem_giro[0].nome, 'PARADO');
    assert.equal(r.abaixo_minimo[0].nome, 'FIO');
    assert.equal(r.negativos[0].nome, 'ALICATE');
    const c = porChave(r.curva, 'curva');
    assert.ok(c.A && c['Sem venda']);
  } finally { await db.close(); }
});

test('receber, pagar e financeiro', async () => {
  const db = await preparar();
  try {
    const rc = await rel(db, 'rel_receber(hoje_loja() - 29, hoje_loja())');
    assert.equal(Number(rc.resumo.aberto), 120);
    assert.equal(Number(rc.resumo.vencido), 80);
    assert.equal(Number(rc.resumo.recebido), 25);
    assert.equal(rc.devedores[0].nome, 'JOAO');
    assert.equal(rc.devedores[0].dias_atraso, 45);
    assert.deepEqual(rc.aging.map((a) => a.faixa), ['Vencido 31–60 dias', 'A vencer em até 30 dias']);

    const pg = await rel(db, 'rel_pagar(hoje_loja() - 29, hoje_loja())');
    assert.equal(Number(pg.resumo.aberto), 70, 'a conferir fica fora');
    assert.equal(pg.resumo.a_conferir, 1);
    assert.equal(Number(pg.resumo.proximos_7), 70);
    assert.equal(Number(pg.resumo.pago_periodo), 45);

    const fi = await rel(db, 'rel_financeiro(hoje_loja() - 29, hoje_loja())');
    assert.equal(Number(fi.caixa.entradas), 150);
    assert.equal(Number(fi.caixa.saidas), 20);
    assert.equal(Number(fi.resultado.despesas_pagas), 45);
    assert.equal(Number(fi.resultado.resultado), 90 - 45);
    const pj = porChave(fi.projecao, 'faixa');
    assert.equal(Number(pj.Vencidos.receber), 80);
    assert.equal(Number(pj['Próximos 7 dias'].pagar), 70);
  } finally { await db.close(); }
});

test('contagem cíclica: critério, lançamento e ajuste pela diferença', async () => {
  const db = await preparar();
  try {
    const id = Number((await db.query(`select contagem_criar('{"descricao":"Ferramentas","grupo_id":1,"quantidade":10}') as id`)).rows[0].id);
    const itens = (await db.query('select produto_id from contagem_itens where contagem_id = $1 order by produto_id', [id])).rows;
    assert.deepEqual(itens.map((i) => Number(i.produto_id)), [5, 7]);
    await db.query('select contagem_lancar($1, 5, 7)', [id]);
    await db.query('select contagem_lancar($1, 5, 1, true)', [id]); // soma: 8
    await assert.rejects(db.query('select contagem_lancar($1, 6, 1)', [id]), /não está nesta contagem/);
    await assert.rejects(db.query('select contagem_lancar($1, 5, -1)', [id]), /Quantidade inválida/);
    // vende 1 martelo durante a contagem: estoque 10 -> 9; contado 8 sobre a foto 10 => ajuste -2 => 7
    await db.exec('update produtos set estoque = 9 where id = 5');
    const fim = (await db.query('select contagem_finalizar($1, true) as r', [id])).rows[0].r;
    assert.equal(fim.ajustados, 1);
    assert.equal(Number(fim.valor_ajuste), -40);
    assert.equal((await db.query('select estoque::text from produtos where id = 5')).rows[0].estoque, '7.000');
    assert.equal((await db.query('select estoque::text from produtos where id = 7')).rows[0].estoque, '-2.000', 'não contado fica igual');
    await assert.rejects(db.query('select contagem_lancar($1, 5, 1)', [id]), /já foi fechada/);
    // a próxima contagem prioriza quem nunca foi contado
    const id2 = Number((await db.query(`select contagem_criar('{"quantidade":2}') as id`)).rows[0].id);
    const prox = (await db.query('select produto_id from contagem_itens where contagem_id = $1', [id2])).rows.map((x) => Number(x.produto_id));
    assert.ok(!prox.includes(5));
    await assert.rejects(db.query(`select contagem_criar('{"curva":"X"}')`), /Curva inválida/);
  } finally { await db.close(); }
});
