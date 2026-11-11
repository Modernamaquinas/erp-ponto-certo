// Montagem da NFC-e/NF-e (api/_lib/fiscal/montar.js) e numeração (005_fiscal.sql).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarNota, gtin, cfopDestino, dataHoraSP, statusNota, documentoValido } from '../api/_lib/fiscal/montar.js';
import { bancoDeTeste } from './pgteste.mjs';

const ITEM = { codigo: 9535, descricao: 'FITA ISOLANTE 19MM', ncm: '70191400', cest: '2806100', cfop: 5405, csosn: '500',
  origem: 0, unidade: 'UN', ean: '7898362380310', quantidade: 2, valor_unitario: 12.5, desconto: 1,
  ibpt: { federal: 13.45, estadual: 18, municipal: 0 } };
const ITEM2 = { ...ITEM, codigo: 2, descricao: 'PARAFUSO', ncm: '73181500', cest: null, cfop: 5102, csosn: '102', ean: 'SEM GTIN',
  quantidade: 10, valor_unitario: 0.35, desconto: 0, ibpt: {} };

test('NFC-e em homologação: totais, CSOSN, troco, pagamento integrado e texto obrigatório', () => {
  const { nota: n, total } = montarNota({ modelo: 65, ambiente: 'homologacao', serie: 10, numero: 7, itens: [ITEM, ITEM2], dhEmi: '2026-11-11T10:00:00-03:00',
    pagamentos: [{ forma: 'debito', valor: 20, cartao: { integrado: true, cnpj: '01027058000191', bandeira: 'ELECTRON', autorizacao: '201291' } },
      { forma: 'dinheiro', valor: 10 }], destinatario: { cpf_cnpj: '111.444.777-35' } });
  assert.deepEqual([n.cnpj_emitente, n.numero, n.serie, n.local_destino, n.presenca_comprador, n.modalidade_frete], ['11877694000166', '7', '10', 1, 1, 9]);
  assert.equal(n.data_emissao, '2026-11-11T10:00:00-03:00');
  assert.match(n.items[0].descricao, /HOMOLOGACAO - SEM VALOR FISCAL/);
  assert.equal(n.items[1].descricao, 'PARAFUSO');
  assert.deepEqual([n.items[0].icms_situacao_tributaria, n.items[0].icms_origem, n.items[0].cfop, n.items[0].cest], ['500', 0, '5405', '2806100']);
  assert.deepEqual([n.items[1].icms_situacao_tributaria, n.items[1].cfop, n.items[1].codigo_barras_comercial], ['102', '5102', 'SEM GTIN']);
  assert.deepEqual([n.items[0].pis_situacao_tributaria, n.items[0].cofins_situacao_tributaria], ['99', '99']);
  assert.deepEqual([n.items[0].valor_bruto, n.items[0].valor_desconto, n.items[0].codigo_ncm], [25, 1, '70191400']);
  assert.equal(total, 27.5);
  assert.equal(n.valor_troco, 2.5);
  assert.deepEqual(n.formas_pagamento[0], { forma_pagamento: '04', valor_pagamento: 20, tipo_integracao: 1, cnpj_credenciadora: '01027058000191',
    bandeira_operadora: '01', numero_autorizacao: '201291' });
  assert.deepEqual(n.formas_pagamento[1], { forma_pagamento: '01', valor_pagamento: 10 });
  assert.equal(n.cpf_destinatario, '11144477735');
  assert.equal(n.indicador_inscricao_estadual_destinatario, 9);
  // tributos aproximados: 24 x (13,45% + 18%) = 3,23 + 4,32
  assert.equal(n.items[0].valor_total_tributos, 7.55);
  assert.ok(n.informacoes_adicionais_contribuinte.includes('Trib aprox R$ 3.23 Federal, 4.32 Estadual'));
  assert.equal(n.valor_total, undefined); // NFC-e: a Focus calcula os totais
});

test('NF-e interestadual para contribuinte vira CFOP 6xxx e exige endereço', () => {
  const destinatario = { nome: 'CLIENTE SC LTDA', cpf_cnpj: '11.222.333/0001-81', ie: '254.123.456',
    endereco: { logradouro: 'RUA A', numero: '10', bairro: 'CENTRO', cMun: '4209102', municipio: 'JOINVILLE', uf: 'SC', cep: '89201-000' } };
  const { nota: n } = montarNota({ modelo: 55, ambiente: 'producao', serie: 2, numero: 1, itens: [ITEM2], destinatario,
    pagamentos: [{ forma: 'boleto', valor: 3.5 }] });
  assert.deepEqual([n.local_destino, n.consumidor_final, n.tipo_documento, n.finalidade_emissao], [2, 0, 1, 1]);
  assert.equal(n.items[0].cfop, '6102');
  assert.deepEqual([n.cnpj_destinatario, n.inscricao_estadual_destinatario, n.indicador_inscricao_estadual_destinatario, n.nome_destinatario],
    ['11222333000181', '254123456', 1, 'CLIENTE SC LTDA']);
  assert.deepEqual([n.cep_destinatario, n.uf_destinatario, n.codigo_municipio_destinatario, n.municipio_destinatario], ['89201000', 'SC', '4209102', 'JOINVILLE']);
  assert.deepEqual([n.valor_produtos, n.valor_desconto, n.valor_total], [3.5, 0, 3.5]);
  const homolog = montarNota({ modelo: 55, ambiente: 'homologacao', serie: 2, numero: 1, itens: [ITEM2], destinatario,
    pagamentos: [{ forma: 'boleto', valor: 3.5 }] }).nota;
  assert.match(homolog.nome_destinatario, /HOMOLOGACAO/);
  assert.throws(() => montarNota({ modelo: 55, ambiente: 'producao', serie: 2, numero: 1, itens: [ITEM2],
    destinatario: { nome: 'X', cpf_cnpj: '11144477735' }, pagamentos: [{ forma: 'dinheiro', valor: 5 }] }), /endereço completo/);
});

test('validações que barram a nota antes de gastar número', () => {
  const base = { modelo: 65, ambiente: 'producao', serie: 10, numero: 1, pagamentos: [{ forma: 'dinheiro', valor: 100 }] };
  assert.throws(() => montarNota({ ...base, itens: [{ ...ITEM, ncm: null }] }), /NCM/);
  assert.throws(() => montarNota({ ...base, itens: [{ ...ITEM, csosn: '101' }] }), /CSOSN 101/);
  assert.throws(() => montarNota({ ...base, itens: [ITEM], pagamentos: [{ forma: 'debito', valor: 10 }] }), /menores que o total/);
  assert.throws(() => montarNota({ ...base, itens: [ITEM], pagamentos: [{ forma: 'debito', valor: 30 }] }), /Troco/);
  assert.throws(() => montarNota({ ...base, modelo: 55, itens: [ITEM] }), /destinatário/);
  assert.throws(() => montarNota({ ...base, itens: [ITEM], destinatario: { cpf_cnpj: '12345678900' } }), /CPF do destinatário inválido/);
});

test('auxiliares', () => {
  assert.equal(documentoValido('111.444.777-35'), true);
  assert.equal(documentoValido('111.444.777-36'), false);
  assert.equal(documentoValido('11.222.333/0001-81'), true);
  assert.equal(documentoValido('11.222.333/0001-82'), false);
  assert.equal(documentoValido('00000000000'), false);
  assert.equal(documentoValido('11877694000166'), true);
  assert.equal(gtin('7898362380310'), '7898362380310');
  assert.equal(gtin('7898362380311'), 'SEM GTIN');
  assert.equal(gtin('123'), 'SEM GTIN');
  assert.equal(cfopDestino(5405, true), '6405');
  assert.throws(() => cfopDestino(1102, false), /CFOP inválido/);
  assert.equal(dataHoraSP(new Date('2026-11-11T13:05:09Z')), '2026-11-11T10:05:09-03:00');
  assert.equal(statusNota('autorizado'), 'autorizada');
  assert.equal(statusNota('erro_autorizacao'), 'rejeitada');
  assert.equal(statusNota('processando_autorizacao'), 'processando');
});

test('numeração: sequência por série/ambiente e reaproveitamento do número rejeitado', async () => {
  const db = await bancoDeTeste();
  try {
    const reservar = async () => (await db.query(`select * from reservar_numero_fiscal(65, 10, 'homologacao')`)).rows[0];
    const nota = (num, tent, status) => db.query(`insert into notas_fiscais (modelo, serie, numero, ambiente, tentativa, status, valor_total, referencia)
      values (65, 10, $1, 'homologacao', $2, $3, 1, $4)`, [num, tent, status, `r-${num}-${tent}`]);
    assert.deepEqual(await reservar(), { numero: 1, tentativa: 1 });
    await nota(1, 1, 'autorizada');
    assert.deepEqual(await reservar(), { numero: 2, tentativa: 1 });
    await nota(2, 1, 'rejeitada');
    // o 2 não existe na SEFAZ: volta a ser usado, como 2ª tentativa
    assert.deepEqual(await reservar(), { numero: 2, tentativa: 2 });
    await nota(2, 2, 'autorizada');
    assert.deepEqual(await reservar(), { numero: 3, tentativa: 1 });
    // outra série/ambiente tem sequência própria
    assert.equal((await db.query(`select * from reservar_numero_fiscal(65, 10, 'producao')`)).rows[0].numero, 1);
    assert.equal((await db.query(`select * from reservar_numero_fiscal(55, 2, 'homologacao')`)).rows[0].numero, 1);
    // dois números válidos iguais são impossíveis
    await assert.rejects(nota(1, 9, 'autorizada'), /duplicate|unique/);
  } finally {
    await db.close();
  }
});
