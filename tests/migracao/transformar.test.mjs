import { test } from 'node:test';
import assert from 'node:assert/strict';
import { txt, dig, bool, dinheiro, data, hora, fk, tipoPessoa, situacaoVenda, statusReceber, somarDias } from '../../scripts/migracao/transformar.mjs';

test('txt tira o preenchimento de CHAR(n) e vazio vira null', () => {
  assert.equal(txt('95096730                        '), '95096730');
  assert.equal(txt('   '), null);
  assert.equal(txt(null), null);
  assert.equal(txt(' SERRA P/ ARCO'), 'SERRA P/ ARCO');
});

test('dig mantém só dígitos', () => {
  assert.equal(dig('041.908.546-00'), '04190854600');
  assert.equal(dig('54991929947                                 '), '54991929947');
  assert.equal(dig('  '), null);
});

test('bool entende T/F com espaços', () => {
  assert.equal(bool('T   '), true);
  assert.equal(bool('F   '), false);
  assert.equal(bool(null, true), true);
});

test('dinheiro arredonda em 2 casas e null vira 0', () => {
  assert.equal(dinheiro(1.005 + 0.0001), 1.01);
  assert.equal(dinheiro(null), 0);
});

test('data e hora vêm como texto do CAST do Firebird', () => {
  assert.equal(data('2026-11-06'), '2026-11-06');
  assert.equal(data('0201-01-01'), null);
  assert.equal(hora('08:01:19.0000'), '08:01:19');
});

test('fk só mantém id que existe no destino', () => {
  const ids = new Set([1, 2]);
  assert.equal(fk(2, ids), 2);
  assert.equal(fk(3, ids), null);
  assert.equal(fk(null, ids), null);
});

test('tipoPessoa deduz pelo documento quando falta', () => {
  assert.equal(tipoPessoa(null, '11877694000166'), 'J');
  assert.equal(tipoPessoa('', '04440424074'), 'F');
  assert.equal(tipoPessoa('J   ', '04440424074'), 'J');
});

test('situacaoVenda: só T é venda válida; A com estorno é estornada', () => {
  assert.equal(situacaoVenda('T   ', null), 'finalizada');
  assert.equal(situacaoVenda('A   ', '2026-05-08'), 'estornada');
  assert.equal(situacaoVenda('A   ', null), 'aberta');
  assert.equal(situacaoVenda('C   ', '2026-05-08'), 'cancelada');
});

test('statusReceber: N com saldo zerado conta como quitada', () => {
  assert.equal(statusReceber('N   ', 156.2), 'aberto');
  assert.equal(statusReceber('N   ', 0), 'pago');
  assert.equal(statusReceber('P   ', 10), 'pago');
});

test('somarDias atravessa meses', () => {
  assert.equal(somarDias('2026-11-06', -15), '2026-10-22');
  assert.equal(somarDias('2026-12-31', 1), '2027-01-01');
});

test('TEF: rede, modalidade, bandeira e situação do PayGo/ACBr', async () => {
  const { redeTef, modalidadeTef, bandeiraTef, situacaoTef } = await import('../../scripts/migracao/transformar.mjs');
  assert.equal(redeTef('PAGSEGUR'), 'PAGSEGURO');
  assert.equal(redeTef('VEROBANR'), 'VERO');
  assert.equal(redeTef('CIELO'), 'CIELO');
  assert.equal(redeTef('dedicado'), null);
  assert.equal(modalidadeTef('10', 'CIELO', 'ELO CREDITO'), 'credito');
  assert.equal(modalidadeTef('11', 'CIELO', 'VISA'), 'credito_parcelado_loja');
  assert.equal(modalidadeTef('12', 'STONE', 'VISA'), 'credito_parcelado_adm');
  assert.equal(modalidadeTef('20', 'CIELO', 'ELECTRON'), 'debito');
  assert.equal(modalidadeTef('51', 'SHIPAY', 'PIX'), 'pix');
  assert.equal(modalidadeTef('20', 'VERO', 'BANRISUL ALIMENTACAO'), 'voucher');
  assert.equal(modalidadeTef(null, null, null), null);
  assert.equal(bandeiraTef('pix'), 'PIX');
  assert.equal(bandeiraTef('00-0040-F2C182AAC2EDE3B6'), null);
  assert.equal(bandeiraTef('d4310df2-a3db-4e94-b040-f79362'), null);
  assert.equal(situacaoTef('CNF', '0', 'STONE', '123'), 'aprovada');
  assert.equal(situacaoTef('CRT', '2', 'CIELO', '902727'), 'aprovada');
  assert.equal(situacaoTef('CRT', '77', null, null), 'nao_concluida');
  assert.equal(situacaoTef(null, '3', null, null), 'nao_concluida');
});

test('TEF: data/hora DDMMhhmmss ganha o ano da finalização ou da venda', async () => {
  const { dataHoraTef } = await import('../../scripts/migracao/transformar.mjs');
  assert.equal(dataHoraTef('0611114841', '26110611484111607521007', '2026-11-06'), '2026-11-06 11:48:41');
  assert.equal(dataHoraTef('1105151927', '24051115192705100191011', null), '2024-05-11 15:19:27');
  assert.equal(dataHoraTef('3112235900', null, '2027-01-01'), '2026-12-31 23:59:00');
  assert.equal(dataHoraTef('0705095150', null, '2023-05-07'), '2023-05-07 09:51:50');
  assert.equal(dataHoraTef(null, null, '2025-01-04'), '2025-01-04 00:00:00');
  assert.equal(dataHoraTef('3102101010', null, '2026-02-28'), '2026-02-28 00:00:00');
  assert.equal(dataHoraTef(null, null, null), null);
});
