import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LINK_NOTA_SEGREDO = 'segredo-de-teste';
const { assinarLinkNota, linkNotaValido } = await import('../api/_lib/fiscal/link.js');
const ler = (qs) => Object.fromEntries(new URLSearchParams(qs));

test('link assinado abre só a nota e o arquivo assinados, dentro da validade', () => {
  const agora = Date.UTC(2026, 10, 12);
  const q = ler(assinarLinkNota(42, 'danfe', agora));
  assert.equal(linkNotaValido(q, agora), true);
  assert.equal(linkNotaValido({ ...q, id: '43' }, agora), false, 'outra nota');
  assert.equal(linkNotaValido({ ...q, arquivo: 'xml' }, agora), false, 'outro arquivo');
  assert.equal(linkNotaValido({ ...q, exp: String(Number(q.exp) + 86400) }, agora), false, 'validade adulterada');
  assert.equal(linkNotaValido({ ...q, sig: q.sig.slice(0, -1) + (q.sig.endsWith('A') ? 'B' : 'A') }, agora), false, 'assinatura errada');
  assert.equal(linkNotaValido(q, agora + 61 * 86400000), false, 'vencido');
  assert.equal(linkNotaValido({ arquivo: 'danfe', id: '42' }, agora), false, 'sem assinatura');
  assert.throws(() => assinarLinkNota(42, 'outro'));
});
