// Montagem da NFC-e/NF-e (api/_lib/fiscal/montar.js) e numeração (005_fiscal.sql).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarNota, gtin, cfopDestino, dataHoraSP, statusNota } from '../api/_lib/fiscal/montar.js';
import { bancoDeTeste } from './pgteste.mjs';

const ITEM = { codigo: 9535, descricao: 'FITA ISOLANTE 19MM', ncm: '70191400', cest: '2806100', cfop: 5405, csosn: '500',
  origem: 0, unidade: 'UN', ean: '7898362380310', quantidade: 2, valor_unitario: 12.5, desconto: 1,
  ibpt: { federal: 13.45, estadual: 18, municipal: 0 } };
const ITEM2 = { ...ITEM, codigo: 2, descricao: 'PARAFUSO', ncm: '73181500', cest: null, cfop: 5102, csosn: '102', ean: 'SEM GTIN',
  quantidade: 10, valor_unitario: 0.35, desconto: 0, ibpt: {} };

test('NFC-e em homologação: totais, CSOSN, troco, pagamento integrado e texto obrigatório', () => {
  const n = montarNota({ modelo: 65, ambiente: 'homologacao', serie: 10, numero: 7, itens: [ITEM, ITEM2], dhEmi: '2026-11-11T10:00:00-03:00',
    pagamentos: [{ forma: 'debito', valor: 20, cartao: { integrado: true, cnpj: '01027058000191', bandeira: 'ELECTRON', autorizacao: '201291' } },
      { forma: 'dinheiro', valor: 10 }], destinatario: { cpf_cnpj: '044.404.240-74' } });
  const i = n.infNFe;
  assert.equal(n.ambiente, 'homologacao');
  assert.deepEqual([i.ide.mod, i.ide.serie, i.ide.nNF, i.ide.tpAmb, i.ide.tpImp, i.ide.indFinal, i.ide.indPres], [65, 10, 7, 2, 4, 1, 1]);
  assert.match(i.det[0].prod.xProd, /HOMOLOGACAO - SEM VALOR FISCAL/);
  assert.equal(i.det[1].prod.xProd, 'PARAFUSO');
  assert.deepEqual(i.det[0].imposto.ICMS, { ICMSSN500: { orig: 0, CSOSN: '500' } });
  assert.deepEqual(i.det[1].imposto.ICMS, { ICMSSN102: { orig: 0, CSOSN: '102' } });
  assert.equal(i.det[0].prod.CFOP, '5405');
  assert.equal(i.det[0].prod.CEST, '2806100');
  assert.equal(i.det[1].prod.cEAN, 'SEM GTIN');
  assert.equal(i.det[0].prod.vDesc, 1);
  assert.equal(i.total.ICMSTot.vProd, 28.5);
  assert.equal(i.total.ICMSTot.vDesc, 1);
  assert.equal(i.total.ICMSTot.vNF, 27.5);
  assert.equal(i.pag.vTroco, 2.5);
  assert.deepEqual(i.pag.detPag[0].card, { tpIntegra: 1, CNPJ: '01027058000191', tBand: '01', cAut: '201291' });
  assert.deepEqual(i.dest, { CPF: '04440424074', indIEDest: 9 });
  // tributos aproximados: 24 x (13,45% + 18%) = 3,23 + 4,32
  assert.equal(i.det[0].imposto.vTotTrib, 7.55);
  assert.match(i.infAdic.infCpl, /Trib aprox R\$ 3\.23 Federal, 4\.32 Estadual/);
  assert.equal(i.transp.modFrete, 9);
});

test('NF-e interestadual para contribuinte vira CFOP 6xxx e exige endereço', () => {
  const destinatario = { nome: 'CLIENTE SC LTDA', cpf_cnpj: '11.222.333/0001-81', ie: '254.123.456',
    endereco: { logradouro: 'RUA A', numero: '10', bairro: 'CENTRO', cMun: '4209102', municipio: 'JOINVILLE', uf: 'SC', cep: '89201-000' } };
  const n = montarNota({ modelo: 55, ambiente: 'producao', serie: 2, numero: 1, itens: [ITEM2], destinatario,
    pagamentos: [{ forma: 'boleto', valor: 3.5 }] }).infNFe;
  assert.equal(n.ide.idDest, 2);
  assert.equal(n.ide.indFinal, 0);
  assert.equal(n.ide.tpImp, 1);
  assert.equal(n.det[0].prod.CFOP, '6102');
  assert.deepEqual([n.dest.CNPJ, n.dest.IE, n.dest.indIEDest, n.dest.xNome], ['11222333000181', '254123456', 1, 'CLIENTE SC LTDA']);
  assert.equal(n.dest.enderDest.CEP, '89201000');
  assert.throws(() => montarNota({ modelo: 55, ambiente: 'producao', serie: 2, numero: 1, itens: [ITEM2],
    destinatario: { nome: 'X', cpf_cnpj: '04440424074' }, pagamentos: [{ forma: 'dinheiro', valor: 5 }] }), /endereço completo/);
});

test('validações que barram a nota antes de gastar número', () => {
  const base = { modelo: 65, ambiente: 'producao', serie: 10, numero: 1, pagamentos: [{ forma: 'dinheiro', valor: 100 }] };
  assert.throws(() => montarNota({ ...base, itens: [{ ...ITEM, ncm: null }] }), /NCM/);
  assert.throws(() => montarNota({ ...base, itens: [{ ...ITEM, csosn: '101' }] }), /CSOSN 101/);
  assert.throws(() => montarNota({ ...base, itens: [ITEM], pagamentos: [{ forma: 'debito', valor: 10 }] }), /menores que o total/);
  assert.throws(() => montarNota({ ...base, itens: [ITEM], pagamentos: [{ forma: 'debito', valor: 30 }] }), /Troco/);
  assert.throws(() => montarNota({ ...base, modelo: 55, itens: [ITEM] }), /destinatário/);
});

test('auxiliares', () => {
  assert.equal(gtin('7898362380310'), '7898362380310');
  assert.equal(gtin('7898362380311'), 'SEM GTIN');
  assert.equal(gtin('123'), 'SEM GTIN');
  assert.equal(cfopDestino(5405, true), '6405');
  assert.throws(() => cfopDestino(1102, false), /CFOP inválido/);
  assert.equal(dataHoraSP(new Date('2026-11-11T13:05:09Z')), '2026-11-11T10:05:09-03:00');
  assert.equal(statusNota('autorizado'), 'autorizada');
  assert.equal(statusNota('pendente'), 'processando');
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
