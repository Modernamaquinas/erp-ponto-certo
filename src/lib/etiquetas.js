// Etiquetas de produto em PPLA (Elgin L42 / Argox), no mesmo formato que o DirectControl grava em
// C:\EASYCONTROL\ETIQUETA.TXT e manda para \\127.0.0.1\L42. Módulo puro: roda no navegador e nos testes.
//
// Linha de campo PPLA: orientação(1) fonte(1) mult_h(1) mult_v(1) subtipo(3) linha(4) esquerda(4) dados
//   ex.: 1E8202500160007C7890203135943  = Code 128, altura 0,25", 0,16" da base, 0,07" da esquerda

const STX = '\x02';
const CRLF = '\r\n';

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, ' ');
const reais = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const pad4 = (n) => String(Math.max(0, Math.round(Number(n) || 0))).padStart(4, '0').slice(-4);
const dataBr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

export const VARIAVEIS = {
  NOME_PROD: 'Nome do produto (repita o campo para quebrar em mais linhas)',
  NOMEPRODUTO: 'Nome do produto',
  COD_PROD: 'Código do produto',
  COD_BARRAS: 'Código de barras',
  CCOD_BARRAS: 'Código de barras com prefixo C (Code 128)',
  ACOD_BARRAS: 'Código de barras com prefixo A',
  PRECO: 'Preço de venda',
  REFERENCIA: 'Referência',
  UNIDADE: 'Unidade',
  NOME_FANTASIA: 'Nome fantasia da loja',
  PARCELAS: 'Número de parcelas',
  VALOR_PARC: 'Valor da parcela',
  DESC_PERCENT: 'Desconto à vista (%)',
  TAMANHO: 'Tamanho (grade)',
  COD_FORN: 'Código do fornecedor',
  DATA_NOTACOMP: 'Data da nota de compra',
};

/** Valores das variáveis para um produto. opcoes: { loja, parcelas, desconto, data_compra } */
export function valoresProduto(p, opcoes = {}) {
  const barras = String(p.codigo_barras || '').trim() || String(p.id);
  const parcelas = Math.max(0, Math.trunc(Number(opcoes.parcelas) || 0));
  const preco = Number(p.preco_venda || 0);
  return {
    NOME_PROD: p.nome, NOMEPRODUTO: p.nome, COD_PROD: String(p.id), COD_BARRAS: barras, CCOD_BARRAS: `C${barras}`,
    ACOD_BARRAS: `A${barras}`, PRECO: reais(preco), REFERENCIA: p.referencia || '', UNIDADE: p.unidade || '',
    NOME_FANTASIA: opcoes.loja || '', PARCELAS: parcelas ? String(parcelas) : '',
    VALOR_PARC: parcelas ? reais(Math.ceil((preco / parcelas) * 100) / 100) : '',
    DESC_PERCENT: Number(opcoes.desconto) ? String(Number(opcoes.desconto)).replace('.', ',') : '',
    TAMANHO: p.tamanho || '', COD_FORN: p.fornecedor_id ? String(p.fornecedor_id) : '', DATA_NOTACOMP: dataBr(opcoes.data_compra),
  };
}

export const colunasDoModelo = (campos) => Math.max(1, ...campos.map((c) => Number(c.coluna) || 1));
export const usaVariavel = (campos, nome) => campos.some((c) => String(c.texto).includes(`[${nome}]`));

/**
 * Textos de cada campo de UMA coluna para um produto. O nome longo é quebrado entre os campos [NOME_PROD]
 * da coluna, de cima para baixo (maior `linha` primeiro), cada um com seu limite de caracteres.
 */
export function textosDaColuna(camposColuna, valores) {
  const nomes = camposColuna.filter((c) => String(c.texto).trim() === '[NOME_PROD]').sort((a, b) => b.linha - a.linha);
  const pedacoNome = new Map();
  let resto = semAcento(valores.NOME_PROD).trim();
  for (const c of nomes) {
    const n = Number(c.max_caracteres) || resto.length;
    pedacoNome.set(c, resto.slice(0, n));
    resto = resto.slice(n);
  }
  return camposColuna.map((c) => {
    let t = pedacoNome.has(c) ? pedacoNome.get(c)
      : semAcento(String(c.texto).replace(/\[([A-Z_]+)\]/g, (m, v) => (v in valores ? semAcento(valores[v]) : m)));
    if (!pedacoNome.has(c) && Number(c.max_caracteres) > 0) t = t.slice(0, Number(c.max_caracteres));
    return { campo: c, texto: t };
  });
}

/**
 * Monta as fileiras do rolo. itens: [{ produto, quantidade }]. Devolve [{ produtos: [p|null por coluna], copias }].
 * Com produtos diferentes cada coluna recebe um produto e a fileira se repete (igual ao DirectControl, que
 * imprime "3 produtos × 16"); quando sobram menos produtos que colunas, um produto ocupa mais de uma coluna.
 */
export function montarFileiras(itens, ncol) {
  const fila = itens.map((i) => ({ produto: i.produto, resta: Math.max(0, Math.trunc(Number(i.quantidade) || 0)) })).filter((i) => i.resta > 0);
  const fileiras = [];
  while (fila.some((i) => i.resta > 0)) {
    const ativos = fila.filter((i) => i.resta > 0);
    let colunas;
    if (ativos.length >= ncol) colunas = ativos.slice(0, ncol);
    else colunas = Array.from({ length: ncol }, (_, k) => ativos[k % ativos.length]);
    const porItem = new Map();
    for (const c of colunas) porItem.set(c, (porItem.get(c) || 0) + 1);
    let copias = Math.min(...[...porItem].map(([i, n]) => Math.floor(i.resta / n)));
    if (copias < 1) {
      // não fecha a fileira inteira: imprime uma vez só com o que resta (colunas vazias ficam em branco)
      const usados = new Map();
      colunas = colunas.map((c) => { const u = usados.get(c) || 0; if (u >= c.resta) return null; usados.set(c, u + 1); return c; });
      copias = 1;
      for (const [i, n] of usados) i.resta -= n;
    } else for (const [i, n] of porItem) i.resta -= n * copias;
    const anterior = fileiras.at(-1);
    const produtos = colunas.map((c) => c?.produto ?? null);
    if (anterior && anterior.produtos.every((p, k) => p === produtos[k])) anterior.copias += copias;
    else fileiras.push({ produtos, copias });
  }
  return fileiras;
}

/** Arquivo PPLA completo (texto com CRLF, só ASCII), pronto para mandar cru à impressora. */
export function gerarPPLA(modelo, campos, itens, opcoes = {}) {
  const ncol = colunasDoModelo(campos);
  const porColuna = Array.from({ length: ncol }, (_, k) => campos.filter((c) => (Number(c.coluna) || 1) === k + 1)
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.id - b.id));
  const linhas = [`${STX}c0000`, `${STX}e`, `${STX}f${String(modelo.avanco ?? 320).padStart(3, '0')}`];
  for (const f of montarFileiras(itens, ncol)) {
    linhas.push(`${STX}L`, `H${String(modelo.temperatura ?? 10).padStart(2, '0')}`, 'PC', 'A2', modelo.pixel || 'D11');
    f.produtos.forEach((p, k) => {
      if (!p) return;
      for (const { campo: c, texto } of textosDaColuna(porColuna[k], valoresProduto(p, opcoes))) {
        if (!texto.trim()) continue;
        const sub = String(c.subtipo ?? '000').padStart(3, '0').slice(-3);
        linhas.push(`${c.orientacao || '1'}${c.fonte}${c.mult_h ?? '1'}${c.mult_v ?? '1'}${sub}${pad4(c.linha)}${pad4(c.esquerda)}${texto}`);
      }
    });
    linhas.push(`:${String(Math.min(f.copias, 9999)).padStart(4, '0')}`, 'E');
  }
  return linhas.join(CRLF) + CRLF;
}

export const totalEtiquetas = (itens) => itens.reduce((s, i) => s + Math.max(0, Math.trunc(Number(i.quantidade) || 0)), 0);

// ---- prévia (aproximada) em SVG: 1 unidade = 0,01"
// altura aproximada do caractere por fonte PPLA (em 0,01"), antes do multiplicador vertical
const ALTURA_FONTE = { 0: 4, 1: 6.5, 2: 9, 3: 12, 4: 16, 5: 24, 6: 32, 7: 9, 8: 10 };
const PONTOS_FONTE9 = { 0: 4, 1: 6, 2: 8, 3: 10, 4: 12, 5: 14, 6: 18, 7: 24, 8: 30, 9: 36 };

export function alturaCampo(c) {
  if (/^[A-Za-z]$/.test(c.fonte)) return Number(c.subtipo) || 25;
  if (c.fonte === '9') return (PONTOS_FONTE9[Number(c.subtipo)] ?? 8) * 1.39;
  return (ALTURA_FONTE[c.fonte] ?? 8) * (Number(c.mult_v) || 1);
}

/** Medidas de uma etiqueta (uma coluna) a partir das posições dos campos e da descrição "3,3 CM X 2,2 CM". */
export function medidasModelo(modelo, campos) {
  const ncol = colunasDoModelo(campos);
  const esq = (k) => Math.min(...campos.filter((c) => (Number(c.coluna) || 1) === k).map((c) => c.esquerda));
  const m = String(modelo.descricao || '').match(/(\d+(?:[.,]\d+)?)\s*CM\s*X\s*(\d+(?:[.,]\d+)?)/i);
  const cm = m ? [m[1], m[2]].map((x) => Number(x.replace(',', '.')) / 0.254) : null; // cm -> 0,01"
  // colunas do rolo lado a lado: a distância entre a 1ª e a 2ª coluna é a largura de cada etiqueta + espaço
  const passo = ncol > 1 ? esq(2) - esq(1) : null;
  const topo = Math.max(...campos.map((c) => c.linha + alturaCampo(c)));
  const direita = Math.max(...campos.filter((c) => (Number(c.coluna) || 1) === 1).map((c) => c.esquerda)) + 40;
  const largura = passo || Math.max(cm ? cm[0] : 0, direita);
  const altura = Math.max(cm ? Math.min(cm[0], cm[1]) : 0, topo + 3);
  return { ncol, largura, altura, passo: passo || largura };
}
