// Gera public/fiscal/ncm.json (busca de NCM na entrada de notas e no cadastro) a partir da tabela oficial do Siscomex:
//   node scripts/gerar-ncm.mjs                 (baixa de portalunico.siscomex.gov.br)
//   node scripts/gerar-ncm.mjs caminho.json    (usa um arquivo já baixado)
// Saída: { vigencia, ato, itens: [[codigo8, descricao composta]] } — a descrição junta a posição (4 dígitos) com os desdobramentos,
// porque a descrição do código final sozinha costuma ser só "- Outros".
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const URL_OFICIAL = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json?perfil=PUBLICO';

const fonte = process.argv[2]
  ? JSON.parse(readFileSync(process.argv[2], 'utf8'))
  : await (await fetch(URL_OFICIAL, { signal: AbortSignal.timeout(120000) })).json();

const limpa = (t) => String(t || '').replace(/<[^>]+>/g, '').replace(/^[\s\-–]+/, '').replace(/\s+/g, ' ').replace(/[:.]$/, '').trim();
const desc = new Map(fonte.Nomenclaturas.map((n) => [n.Codigo.replace(/\D/g, ''), limpa(n.Descricao)]));
const encurta = (t, n) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

const itens = [];
for (const n of fonte.Nomenclaturas) {
  const c = n.Codigo.replace(/\D/g, '');
  if (c.length !== 8) continue;
  const partes = [];
  const posicao = desc.get(c.slice(0, 4));
  if (posicao) partes.push(encurta(posicao, 90));
  for (const pre of [c.slice(0, 5), c.slice(0, 6), c.slice(0, 7)]) {
    const d = desc.get(pre);
    if (d && d !== partes[partes.length - 1] && !/^outr[oa]s$/i.test(d)) partes.push(encurta(d, 70));
  }
  const final = desc.get(c);
  if (final && final !== partes[partes.length - 1]) partes.push(final);
  itens.push([c, partes.join(' › ')]);
}
itens.sort((a, b) => a[0].localeCompare(b[0]));
mkdirSync(new URL('../public/fiscal/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/fiscal/ncm.json', import.meta.url),
  JSON.stringify({ vigencia: fonte.Data_Ultima_Atualizacao_NCM, ato: fonte.Ato, itens }));
console.log(`${itens.length} NCMs — ${fonte.Data_Ultima_Atualizacao_NCM} (${fonte.Ato})`);
