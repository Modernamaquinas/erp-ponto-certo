// Marketplaces (022): vínculo por GTIN, estoque calculado com reserva/kit, pendências, vendas dos canais e estorno.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoDeTeste } from './pgteste.mjs';

async function preparar() {
  const db = await bancoDeTeste();
  await db.exec(`
    insert into formas_pagamento (id, descricao) values (2, 'DINHEIRO'), (13, 'PIX');
    insert into produtos (id, nome, codigo_barras, preco_venda, custo, estoque) values
      (1, 'DESENGORDURANTE DX30', '7898058598258', 20, 10, 10),
      (2, 'BICARBONATO 5L', '7898058595196', 30, 15, 7),
      (3, 'DISCO DIAMANTADO', '7897451416992', 25, 12, 9),
      (4, 'REPETIDO A', '7890000000017', 10, 5, 3), (5, 'REPETIDO B', '7890000000017', 10, 5, 3);
    insert into operadores (codigo, nome, desconto_maximo) values ('1234', 'LUCAS', 10);
  `);
  return db;
}
const um = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const rpc = async (db, sql, params) => (await db.query(sql, params)).rows[0]?.r;
const ler = (db, anuncios) => rpc(db, `select marketplace_ler_anuncios('mercadolivre', $1) as r`, [JSON.stringify(anuncios)]);
const pendentes = async (db) => (await db.query(`select anuncio_id, quantidade::int from marketplace_pendentes('mercadolivre') order by 1`)).rows;

test('lê anúncios, vincula pelo GTIN único e calcula o estoque com reserva e kit', async () => {
  const db = await preparar();
  try {
    const r = await ler(db, [
      { anuncio_id: 'MLB1', titulo: 'Dx-30', status: 'active', estoque: 8, gtin: '7898058598258' },
      { anuncio_id: 'MLB2', titulo: 'Kit Multiuso Bicarbonato + Dx30', status: 'active', estoque: 6 },
      { anuncio_id: 'MLB3', titulo: 'Kit 2 Discos', status: 'active', estoque: 5, gtin: '7897451416992' },
      { anuncio_id: 'MLB4', titulo: 'GTIN repetido', status: 'paused', estoque: 1, gtin: '7890000000017' },
    ]);
    assert.deepEqual(r, { lidos: 4, vinculados_automaticamente: 2 });
    assert.equal((await um(db, `select count(*)::int as n from marketplace_composicao where anuncio_id = 'MLB4'`)).n, 0, 'GTIN de 2 produtos não vincula');
    // kit de 2 discos: ajusta a quantidade; kit com 2 produtos: composição manual
    await db.exec(`update marketplace_composicao set quantidade = 2 where anuncio_id = 'MLB3';
      insert into marketplace_composicao (canal, anuncio_id, produto_id, quantidade) values ('mercadolivre', 'MLB2', 1, 1), ('mercadolivre', 'MLB2', 2, 1);`);
    const q = async (a) => Number((await um(db, `select marketplace_qtd('mercadolivre', $1) as q`, [a])).q);
    assert.equal(await q('MLB1'), 9, '10 - reserva padrão 1');
    assert.equal(await q('MLB2'), 6, 'min(10-1, 7-1)');
    assert.equal(await q('MLB3'), 4, 'floor((9-1)/2)');
    await db.exec(`update marketplace_anuncios set reserva = 0 where anuncio_id = 'MLB3'`);
    assert.equal(await q('MLB3'), 4, 'floor(9/2)');
    await db.exec(`update produtos set estoque = 0 where id = 3`);
    assert.equal(await q('MLB3'), 0, 'nunca negativo');
    await db.exec(`update produtos set estoque = 9 where id = 3`);

    // nada é enviado com a chave geral ou do anúncio desligada
    assert.deepEqual(await pendentes(db), []);
    await db.exec(`update marketplace_config set sincronizar = true where canal = 'mercadolivre'`);
    assert.deepEqual(await pendentes(db), []);
    await db.exec(`update marketplace_anuncios set sincronizar = true where anuncio_id in ('MLB1', 'MLB2', 'MLB3', 'MLB4')`);
    assert.deepEqual(await pendentes(db), [{ anuncio_id: 'MLB1', quantidade: 9 }, { anuncio_id: 'MLB2', quantidade: 6 }, { anuncio_id: 'MLB3', quantidade: 4 }]);

    // envio ok tira o pendente; erro mantém
    await db.query(`select marketplace_registrar_envio('mercadolivre', $1)`, [JSON.stringify([
      { anuncio_id: 'MLB1', ok: true, quantidade: 9 }, { anuncio_id: 'MLB2', ok: true, quantidade: 6 }, { anuncio_id: 'MLB3', ok: false, erro: 'ML 400' }])]);
    assert.deepEqual(await pendentes(db), [{ anuncio_id: 'MLB3', quantidade: 4 }]);
    assert.equal((await um(db, `select erro from marketplace_anuncios where anuncio_id = 'MLB3'`)).erro, 'ML 400');

    // venda no balcão (PDV) baixa o estoque do DX30 -> MLB1 e MLB2 voltam a ficar pendentes
    await db.query('select finalizar_venda($1)', [JSON.stringify({ operador_codigo: '1234', itens: [{ produto_id: 1, quantidade: 3, preco_unitario: 20 }], pagamentos: [{ forma: 'pix', valor: 60 }] })]);
    assert.deepEqual(await pendentes(db), [{ anuncio_id: 'MLB3', quantidade: 4 }, { anuncio_id: 'MLB1', quantidade: 6 }, { anuncio_id: 'MLB2', quantidade: 6 }].sort((a, b) => a.anuncio_id.localeCompare(b.anuncio_id)));
  } finally { await db.close(); }
});

test('venda do canal: registra, baixa pela composição, é idempotente e estorna no cancelamento', async () => {
  const db = await preparar();
  try {
    await ler(db, [{ anuncio_id: 'MLB1', titulo: 'Dx-30', gtin: '7898058598258' }, { anuncio_id: 'MLB2', titulo: 'Kit Multiuso' }]);
    const pedido = { canal: 'mercadolivre', pedido_id: '2000001', status: 'paid', data: '2026-11-12T10:00:00-03:00', total: 105,
      itens: [{ anuncio_id: 'MLB1', titulo: 'Dx-30', quantidade: 2, preco_unitario: 22.5 }, { anuncio_id: 'MLB2', titulo: 'Kit Multiuso', quantidade: 1, preco_unitario: 60 }] };
    const reg = (p) => rpc(db, 'select marketplace_registrar_pedido($1) as r', [JSON.stringify(p)]);
    // kit sem vínculo: fica pendente, sem venda e sem mexer no estoque
    assert.equal((await reg(pedido)).acao, 'pendente_vinculo');
    assert.match((await um(db, `select erro from marketplace_pedidos where pedido_id = '2000001'`)).erro, /Kit Multiuso/);
    assert.equal(Number((await um(db, 'select estoque from produtos where id = 1')).estoque), 10);
    await db.exec(`insert into marketplace_composicao (canal, anuncio_id, produto_id, quantidade) values ('mercadolivre', 'MLB2', 1, 1), ('mercadolivre', 'MLB2', 2, 1)`);
    const r = await reg(pedido);
    assert.equal(r.acao, 'registrado');
    assert.equal(Number(r.total), 105);
    const v = await um(db, 'select origem, canal, canal_pedido, situacao, total::text from vendas where id = $1', [r.venda_id]);
    assert.deepEqual(v, { origem: 'marketplace', canal: 'mercadolivre', canal_pedido: '2000001', situacao: 'finalizada', total: '105.00' });
    // DX30: 2 avulsos + 1 no kit = 3; bicarbonato: 1. O kit de R$ 60 dividido pelo preço de venda (20 x 30) = 24 + 36
    assert.equal(Number((await um(db, 'select estoque from produtos where id = 1')).estoque), 7);
    assert.equal(Number((await um(db, 'select estoque from produtos where id = 2')).estoque), 6);
    const itens = (await db.query('select produto_id::int, quantidade::text, total::text from venda_itens where venda_id = $1 order by item', [r.venda_id])).rows;
    assert.deepEqual(itens, [{ produto_id: 1, quantidade: '2.000', total: '45.00' }, { produto_id: 1, quantidade: '1.000', total: '24.00' }, { produto_id: 2, quantidade: '1.000', total: '36.00' }]);
    assert.equal((await um(db, 'select grupo_forma(forma_pagamento_id) as g from venda_pagamentos where venda_id = $1', [r.venda_id])).g, 'Mercado Livre');
    assert.equal((await um(db, `select count(*)::int as n from caixa_lancamentos`)).n, 0, 'sem caixa: o dinheiro entra pelo canal');
    // de novo: não duplica
    assert.equal((await reg(pedido)).acao, 'ja_registrado');
    assert.equal((await um(db, `select count(*)::int as n from vendas where origem = 'marketplace'`)).n, 1);
    // cancelado: estorna uma vez só
    assert.equal((await reg({ ...pedido, status: 'cancelled' })).acao, 'estornado');
    assert.equal(Number((await um(db, 'select estoque from produtos where id = 1')).estoque), 10);
    assert.equal((await um(db, 'select situacao from vendas where id = $1', [r.venda_id])).situacao, 'cancelada');
    assert.equal((await reg({ ...pedido, status: 'cancelled' })).acao, 'ignorado');
    assert.equal(Number((await um(db, 'select estoque from produtos where id = 1')).estoque), 10);
    // aguardando pagamento não registra
    assert.equal((await reg({ ...pedido, pedido_id: '2000002', status: 'payment_required' })).acao, 'aguardando_pagamento');
  } finally { await db.close(); }
});
