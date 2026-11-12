// Tabelas fiscais para as buscas da entrada de notas e do cadastro de produtos. NCM é grande e vem de /fiscal/ncm.json
// (gerado de tabela oficial por scripts/gerar-ncm.mjs); o resto é pequeno e fica aqui.

// CFOPs usados por um comércio varejista de ferragens (entradas, saídas, devoluções, remessas). Qualquer outro de 4 dígitos é aceito.
export const CFOPS = [
  // entradas no estado
  ['1102', 'Compra para comercialização'],
  ['1403', 'Compra para comercialização com ST (substituído)'],
  ['1202', 'Devolução de venda de mercadoria de terceiros'],
  ['1411', 'Devolução de venda com ST'],
  ['1556', 'Compra de material para uso ou consumo'],
  ['1407', 'Compra para uso ou consumo com ST'],
  ['1551', 'Compra de bem para o ativo imobilizado'],
  ['1406', 'Compra de bem para o ativo imobilizado com ST'],
  ['1910', 'Entrada de bonificação, doação ou brinde'],
  ['1911', 'Entrada de amostra grátis'],
  ['1915', 'Entrada para conserto ou reparo'],
  ['1916', 'Retorno de mercadoria remetida para conserto'],
  ['1918', 'Devolução de mercadoria remetida em consignação'],
  ['1949', 'Outra entrada não especificada'],
  // entradas de outro estado
  ['2102', 'Compra para comercialização (outro estado)'],
  ['2403', 'Compra para comercialização com ST (outro estado)'],
  ['2202', 'Devolução de venda (outro estado)'],
  ['2411', 'Devolução de venda com ST (outro estado)'],
  ['2556', 'Compra de material para uso ou consumo (outro estado)'],
  ['2407', 'Compra para uso ou consumo com ST (outro estado)'],
  ['2551', 'Compra de bem para o ativo imobilizado (outro estado)'],
  ['2910', 'Entrada de bonificação, doação ou brinde (outro estado)'],
  ['2949', 'Outra entrada não especificada (outro estado)'],
  // saídas no estado
  ['5102', 'Venda de mercadoria adquirida de terceiros'],
  ['5405', 'Venda de mercadoria com ST (substituído)'],
  ['5403', 'Venda com ST (contribuinte substituto)'],
  ['5101', 'Venda de produção do estabelecimento'],
  ['5202', 'Devolução de compra para comercialização'],
  ['5411', 'Devolução de compra com ST'],
  ['5556', 'Devolução de compra de material de uso ou consumo'],
  ['5910', 'Remessa em bonificação, doação ou brinde'],
  ['5915', 'Remessa para conserto ou reparo'],
  ['5916', 'Retorno de mercadoria recebida para conserto'],
  ['5917', 'Remessa de mercadoria em consignação'],
  ['5927', 'Baixa de estoque por perda, roubo ou deterioração'],
  ['5929', 'Lançamento relativo a operação registrada em ECF/NFC-e'],
  ['5949', 'Outra saída não especificada'],
  // saídas para outro estado
  ['6102', 'Venda de mercadoria adquirida de terceiros (outro estado)'],
  ['6108', 'Venda a não contribuinte de outro estado'],
  ['6404', 'Venda com ST já recolhida (outro estado)'],
  ['6403', 'Venda com ST (substituto, outro estado)'],
  ['6202', 'Devolução de compra (outro estado)'],
  ['6411', 'Devolução de compra com ST (outro estado)'],
  ['6949', 'Outra saída não especificada (outro estado)'],
];

// Simples Nacional (CRT 1): o que a loja usa na venda.
export const CSOSNS = [
  ['101', 'Tributada com permissão de crédito'],
  ['102', 'Tributada sem permissão de crédito'],
  ['103', 'Isenção do ICMS para faixa de receita bruta'],
  ['201', 'Com crédito e com cobrança de ICMS por ST'],
  ['202', 'Sem crédito e com cobrança de ICMS por ST'],
  ['203', 'Isenção para faixa de receita e com cobrança por ST'],
  ['300', 'Imune'],
  ['400', 'Não tributada'],
  ['500', 'ICMS cobrado anteriormente por ST ou antecipação'],
  ['900', 'Outros'],
];

// CST do ICMS (regime normal): aparece nas notas de fornecedores do Lucro Real/Presumido.
export const CSTS_ICMS = [
  ['00', 'Tributada integralmente'], ['10', 'Tributada e com cobrança de ICMS por ST'], ['20', 'Com redução de base de cálculo'],
  ['30', 'Isenta/não tributada e com cobrança por ST'], ['40', 'Isenta'], ['41', 'Não tributada'], ['50', 'Suspensão'],
  ['51', 'Diferimento'], ['60', 'ICMS cobrado anteriormente por ST'], ['70', 'Com redução de BC e cobrança por ST'], ['90', 'Outras'],
];

export const ORIGENS = [
  ['0', 'Nacional'], ['1', 'Estrangeira — importação direta'], ['2', 'Estrangeira — adquirida no mercado interno'],
  ['3', 'Nacional com conteúdo de importação > 40% e ≤ 70%'], ['4', 'Nacional, produção conforme processos básicos'],
  ['5', 'Nacional com conteúdo de importação ≤ 40%'], ['6', 'Estrangeira — importação direta, sem similar (CAMEX)'],
  ['7', 'Estrangeira — mercado interno, sem similar (CAMEX)'], ['8', 'Nacional com conteúdo de importação > 70%'],
];

export const descricao = (tabela, codigo) => tabela.find(([c]) => c === String(codigo ?? ''))?.[1] || '';

const sem = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Filtra [codigo, descricao] por código (prefixo, sem pontos) ou por todas as palavras da descrição. */
export function filtrarTabela(tabela, termo, limite = 50) {
  const t = sem(termo).trim();
  if (!t) return tabela.slice(0, limite);
  const digitos = t.replace(/[.\s-]/g, '');
  if (/^\d+$/.test(digitos)) return tabela.filter(([c]) => c.startsWith(digitos)).slice(0, limite);
  const palavras = t.split(/\s+/);
  return tabela.filter(([, d]) => { const x = sem(d); return palavras.every((p) => x.includes(p)); }).slice(0, limite);
}

let ncmCache = null;
/** Tabela NCM oficial (carregada uma vez por sessão). */
export async function carregarNcm() {
  if (!ncmCache) ncmCache = fetch('/fiscal/ncm.json').then((r) => { if (!r.ok) throw new Error('Tabela NCM indisponível'); return r.json(); });
  return ncmCache;
}

export const formatarNcm = (c) => (String(c || '').length === 8 ? `${c.slice(0, 4)}.${c.slice(4, 6)}.${c.slice(6)}` : c || '');
