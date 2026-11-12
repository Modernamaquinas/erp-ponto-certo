// Entrada de notas pelo XML (src/lib/nfeXml.js + 020_entrada_compras.sql) e lista de compras.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bancoDeTeste } from './pgteste.mjs';
import { lerNfe, chaveValida, eanValido, sugestaoFiscalVenda } from '../src/lib/nfeXml.js';

const XML = readFileSync(new URL('./fixtures/nfe-compra-disbracon.xml', import.meta.url), 'utf8');

test('lê o XML real da NF-e de compra', () => {
  const n = lerNfe(XML);
  assert.equal(n.chave, '43251024845459000235550010000252231010035932');
  assert.ok(chaveValida(n.chave));
  assert.equal(chaveValida(n.chave.slice(0, 43) + '0'), false);
  assert.deepEqual([n.numero, n.serie, n.data_emissao, n.autorizada], ['25223', 1, '2025-10-03', true]);
  assert.equal(n.fornecedor.cnpj, '24845459000235');
  assert.equal(n.fornecedor.cidade_ibge, 4310330);
  assert.equal(n.destinatario.cnpj, '11877694000166');
  assert.equal(n.itens.length, 7);
  assert.equal(Math.round(n.itens.reduce((s, i) => s + i.custo_total, 0) * 100), Math.round(n.totais.total * 100));
  const tinta = n.itens.find((i) => i.codigo === '5794');
  assert.deepEqual([tinta.cst_icms, tinta.substituicao, tinta.cest, tinta.cfop], ['60', true, '2400100', '5405']);
  assert.deepEqual(sugestaoFiscalVenda(tinta), { cst_csosn: '500', cfop: 5405, origem: 0 });
  assert.deepEqual(sugestaoFiscalVenda(n.itens[0]), { cst_csosn: '102', cfop: 5102, origem: 0 });
  assert.equal(n.itens[6].ean, '47896027010457'); // GTIN-14
  assert.equal(eanValido('SEM GTIN'), null);
  assert.equal(eanValido('7898214962931'), null, 'dígito errado');
  assert.deepEqual(n.duplicatas, [{ numero: '001', vencimento: '2025-10-24', valor: 326.67 }, { numero: '002', vencimento: '2025-11-07', valor: 326.66 }]);
  assert.throws(() => lerNfe('<html></html>'), /não é o XML de uma NF-e/);
});

async function preparar() {
  const db = await bancoDeTeste();
  await db.exec(`
    insert into cidades (id, nome, uf, ibge) values (1, 'IMBE', 'RS', 4310330);
    insert into fornecedores (id, nome, cpf_cnpj) values (18, 'DISBRACON DISTRIBUIDORA LTDA', '24845459000235');
    insert into subgrupos_produto (id, nome, margem) values (1, 'TINTAS', 60);
    insert into produtos (id, nome, unidade, codigo_barras, preco_venda, custo, custo_medio, estoque, estoque_minimo, ncm, cst_csosn, cfop, subgrupo_id) values
      (7665, 'TERM. PINO PRE-ISOLADO', 'PCT', '7898214962930', 25, 12, 12, 4, 2, '85369090', '102', 5102, null),
      (7666, 'EUCALAR ACRILICA', 'UN', '7896587014102', 150, 90, 90, 0, 1, '32091010', '102', 5102, 1),
      (4563, 'ARCO DE SERRA 12', 'UN', '0000000000000', 60, 35, 35, 10, null, '82021000', '102', 5102, null);
    insert into produto_fornecedores (produto_id, fornecedor_id, codigo_no_fornecedor) values (4563, 18, '4170');
  `);
  return db;
}
const um = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const rpc = async (db, fn, p) => (await db.query(`select ${fn}($1) as r`, [JSON.stringify(p)])).rows[0].r;

test('preparar casa os itens (código no fornecedor, EAN) e lançar atualiza estoque, custo, vínculo e contas a pagar', async () => {
  const db = await preparar();
  try {
    const n = lerNfe(XML);
    const prep = await rpc(db, 'entrada_preparar', { fornecedor_cnpj: n.fornecedor.cnpj, chave: n.chave, itens: n.itens.map(({ item, codigo, ean }) => ({ item, codigo, ean })) });
    assert.equal(prep.fornecedor.id, 18);
    assert.equal(prep.duplicada, null);
    const como = Object.fromEntries(prep.itens.map((i) => [i.item, [i.produto?.id ?? null, i.como]]));
    assert.deepEqual(como[1], [7665, 'ean']);
    assert.deepEqual(como[2], [4563, 'codigo_fornecedor']);
    assert.deepEqual(como[5], [7666, 'ean']);
    assert.deepEqual(como[3], [null, null]);
    assert.equal(prep.itens.find((i) => i.item === 5).produto.margem, 60, 'margem do subgrupo');

    // lança só 3 itens: termo (fator 1), arco (caixa? não: fator 1) e tinta (aplica 500/5405 e preço novo) + 1 produto novo
    const pick = (k) => n.itens.find((i) => i.item === k);
    const linha = (i, extra) => ({ item: i.item, codigo_fornecedor: i.codigo, descricao: i.descricao, ean: i.ean, ncm: i.ncm, cest: i.cest, cfop: i.cfop,
      cst_icms: i.cst_icms, origem: i.origem, unidade: i.unidade, quantidade: i.quantidade, fator: 1, valor_unitario: i.valor_unitario,
      valor_produtos: i.valor_produtos, valor_ipi: i.valor_ipi, valor_st: i.valor_st, custo_total: i.custo_total, ...extra });
    const p = {
      chave: n.chave, numero: n.numero, serie: n.serie, data_emissao: n.data_emissao, natureza: n.natureza, xml: XML,
      fornecedor: { id: 18 }, totais: n.totais, duplicatas: n.duplicatas, gerar_pagar: true,
      itens: [
        linha(pick(1), { produto_id: 7665 }),
        linha(pick(2), { produto_id: 4563, fator: 2 }),
        linha(pick(5), { produto_id: 7666, atualizar: { cst_csosn: '500', cfop: 5405, cest: '2400100', preco_venda: 159.9 } }),
        linha(pick(3), { novo: { nome: 'Thinner 9100 900ml', unidade: 'UN', preco_venda: 18.9 } }),
      ],
    };
    const id = Number(await rpc(db, 'lancar_compra', p));
    // termo: estoque 4 + 2; custo 14,90; médio (4*12 + 2*14,9)/6
    assert.deepEqual(await um(db, 'select estoque::text, custo::text, custo_medio::text from produtos where id = 7665'), { estoque: '6.000', custo: '14.9000', custo_medio: '12.9667' });
    // arco: 2 un da nota x fator 2 = 4 no estoque; custo por unidade de estoque = 79 / 4
    assert.deepEqual(await um(db, 'select estoque::text, custo::text from produtos where id = 4563'), { estoque: '14.000', custo: '19.7500' });
    // tinta: estoque zerado -> médio = custo da compra; fiscal e preço atualizados e marcados como editados no ERP
    assert.deepEqual(await um(db, 'select estoque::text, custo_medio::text, cst_csosn, cfop, cest, preco_venda::text, alterado_erp from produtos where id = 7666'),
      { estoque: '1.000', custo_medio: '98.3500', cst_csosn: '500', cfop: 5405, cest: '2400100', preco_venda: '159.90', alterado_erp: true });
    const novo = await um(db, `select id, nome, estoque::text, ncm, codigo_barras, cst_csosn, cfop, preco_venda::text from produtos where nome = 'THINNER 9100 900ML'`);
    assert.deepEqual({ ...novo, id: undefined }, { id: undefined, nome: 'THINNER 9100 900ML', estoque: '21.000', ncm: '38140090', codigo_barras: '7896587034469', cst_csosn: '102', cfop: 5102, preco_venda: '18.90' });
    // vínculo criado: a próxima nota casa pelo código do fornecedor
    assert.equal(Number((await um(db, `select produto_id from produto_fornecedores where fornecedor_id = 18 and codigo_no_fornecedor = '4907'`)).produto_id), Number(novo.id));
    const c = await um(db, 'select origem, numero_nota, valor_total::text, fornecedor_id::int from compras where id = $1', [id]);
    assert.deepEqual(c, { origem: 'erp', numero_nota: '25223', valor_total: '653.33', fornecedor_id: 18 });
    const cp = (await db.query('select vencimento::text, valor::text, documento, parcela, total_parcelas from contas_pagar where compra_id = $1 order by parcela', [id])).rows;
    assert.deepEqual(cp, [{ vencimento: '2025-10-24', valor: '326.67', documento: '25223/001', parcela: 1, total_parcelas: 2 },
      { vencimento: '2025-11-07', valor: '326.66', documento: '25223/002', parcela: 2, total_parcelas: 2 }]);
    assert.equal((await um(db, 'select count(*)::int as n from compra_itens where compra_id = $1', [id])).n, 4);
    // a mesma nota não entra duas vezes
    await assert.rejects(rpc(db, 'lancar_compra', p), /já foi lançada/);
    const prep2 = await rpc(db, 'entrada_preparar', { fornecedor_cnpj: n.fornecedor.cnpj, chave: n.chave, itens: [] });
    assert.equal(Number(prep2.duplicada.compra_id), id);
    // regras do produto novo
    await assert.rejects(rpc(db, 'lancar_compra', { ...p, chave: null, itens: [linha(pick(4), {})] }), /escolha o produto do cadastro/);
    await assert.rejects(rpc(db, 'lancar_compra', { ...p, chave: null, itens: [linha(pick(4), { ncm: '123', novo: { nome: 'X' } })] }), /NCM do produto novo/);
  } finally { await db.close(); }
});

test('fornecedor novo é cadastrado com os dados do XML', async () => {
  const db = await preparar();
  try {
    const n = lerNfe(XML);
    await db.exec('delete from produto_fornecedores; delete from fornecedores');
    const i = n.itens[0];
    const id = Number(await rpc(db, 'lancar_compra', { numero: n.numero, data_emissao: n.data_emissao, fornecedor: n.fornecedor, totais: n.totais,
      itens: [{ item: 1, produto_id: 7665, quantidade: i.quantidade, valor_unitario: i.valor_unitario, valor_produtos: i.valor_produtos, custo_total: i.custo_total }] }));
    const f = await um(db, 'select f.nome, f.cpf_cnpj, f.cidade_id from compras c join fornecedores f on f.id = c.fornecedor_id where c.id = $1', [id]);
    assert.deepEqual(f, { nome: 'DISBRACON DISTRIBUIDORA LTDA', cpf_cnpj: '24845459000235', cidade_id: 1 });
  } finally { await db.close(); }
});

test('lista de compras: em falta, no mínimo, sugestão pela venda e último fornecedor', async () => {
  const db = await preparar();
  try {
    await db.exec(`
      insert into produtos (id, nome, estoque, estoque_minimo) values (9, 'PARADO ZERADO', 0, null), (10, 'OK', 50, 5);
      insert into vendas (id, data, total, situacao) values (1, hoje_loja() - 5, 10, 'finalizada');
      insert into venda_itens (venda_id, item, produto_id, quantidade, preco_unitario, total) values (1, 1, 7666, 9, 150, 1350);
      insert into compras (id, fornecedor_id, data_entrada) values (1, 18, hoje_loja() - 20);
      insert into compra_itens (compra_id, item, produto_id, quantidade, custo_unitario, codigo_fornecedor) values (1, 1, 7666, 1, 98, '5794');
    `);
    const r = await rpc(db, 'lista_compras', { dias: 90, cobertura: 30 });
    const porId = Object.fromEntries(r.itens.map((i) => [i.id, i]));
    assert.ok(!porId[9], 'zerado sem venda e sem mínimo fica fora');
    assert.ok(!porId[10] && !porId[4563], 'acima do mínimo / sem mínimo com estoque fica fora');
    assert.equal(porId[7665], undefined, 'estoque 4 > mínimo 2');
    const tinta = porId[7666];
    assert.equal(tinta.situacao, 'falta');
    assert.equal(tinta.sugestao, 3); // 9 vendidas / 90 dias * 30 = 3 (maior que o mínimo 1)
    assert.equal(tinta.fornecedor, 'DISBRACON DISTRIBUIDORA LTDA');
    assert.equal(tinta.codigo_fornecedor, '5794');
    const com = await rpc(db, 'lista_compras', { incluir_sem_giro: true, situacao: 'falta' });
    assert.ok(com.itens.some((i) => i.id === 9));
    await db.exec('update produtos set estoque = 2 where id = 7665');
    const min = await rpc(db, 'lista_compras', { situacao: 'minimo' });
    assert.deepEqual(min.itens.map((i) => i.id), [7665]);
    assert.equal(min.itens[0].sugestao, 2, 'no mínimo e sem venda: repõe a quantidade do mínimo');
  } finally { await db.close(); }
});
