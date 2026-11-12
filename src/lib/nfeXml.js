// Leitura do XML da NF-e de compra (nfeProc ou NFe, layout 4.00) para a entrada de notas. Puro (sem DOM): roda no navegador
// e nos testes. Devolve só o que a entrada usa: cabeçalho, fornecedor, destinatário, itens com impostos, totais e duplicatas.

// ---------------------------------------------------------------- mini parser XML (elementos, atributos e texto; sem mixed content)
function decodificar(t) {
  return t.replace(/&(lt|gt|amp|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, (m, n, d, h) => {
    if (d) return String.fromCodePoint(Number(d));
    if (h) return String.fromCodePoint(parseInt(h, 16));
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[n.toLowerCase()];
  });
}

/** XML -> árvore { nome, attrs, filhos: [], texto }. Ignora prefixos de namespace, comentários, PI e CDATA vira texto. */
export function lerXml(xml) {
  const raiz = { nome: '#raiz', attrs: {}, filhos: [], texto: '' };
  const pilha = [raiz];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const topo = pilha[pilha.length - 1];
    if (m[1] !== undefined) { topo.texto += m[1]; continue; }
    if (m[6] !== undefined) { if (m[6].trim()) topo.texto += decodificar(m[6]); continue; }
    if (!m[3]) continue; // comentário / declaração
    const nome = m[3].includes(':') ? m[3].split(':').pop() : m[3];
    if (m[2]) { // fechamento
      if (pilha.length > 1) pilha.pop();
      continue;
    }
    const attrs = {};
    for (const a of (m[4] || '').matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].split(':').pop()] = decodificar(a[2] ?? a[3]);
    const no = { nome, attrs, filhos: [], texto: '' };
    topo.filhos.push(no);
    if (!m[5]) pilha.push(no);
  }
  return raiz;
}

const filho = (no, nome) => no?.filhos.find((f) => f.nome === nome) || null;
const filhos = (no, nome) => (no ? no.filhos.filter((f) => f.nome === nome) : []);
/** Caminho "a/b/c" a partir de um nó; '*' pega o primeiro filho qualquer (ex.: ICMS/*). */
function no(base, caminho) {
  let n = base;
  for (const p of caminho.split('/')) { if (!n) return null; n = p === '*' ? n.filhos[0] || null : filho(n, p); }
  return n;
}
const txt = (base, caminho) => { const n = no(base, caminho); const t = n?.texto?.trim(); return t === undefined || t === '' ? null : t; };
const num = (base, caminho) => { const t = txt(base, caminho); return t === null ? 0 : Number(t); };
function buscar(n, nome) { // primeiro descendente com esse nome
  if (!n) return null;
  for (const f of n.filhos) { if (f.nome === nome) return f; const r = buscar(f, nome); if (r) return r; }
  return null;
}
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const so = (v) => String(v || '').replace(/\D/g, '');

/** EAN válido (GTIN-8/12/13/14 com dígito verificador); "SEM GTIN" e zeros viram null. */
export function eanValido(v) {
  const d = so(v);
  if (![8, 12, 13, 14].includes(d.length) || /^0+$/.test(d)) return null;
  const nums = d.split('').map(Number);
  const dv = nums.pop();
  const soma = nums.reverse().reduce((s, x, i) => s + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === dv ? d : null;
}

/** Chave de acesso (44 dígitos) com dígito verificador módulo 11. */
export function chaveValida(v) {
  const d = so(v);
  if (d.length !== 44) return false;
  let peso = 2; let soma = 0;
  for (let i = 42; i >= 0; i--) { soma += Number(d[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return (r < 2 ? 0 : 11 - r) === Number(d[43]);
}

/** CST/CSOSN do fornecedor indica ICMS-ST já retido/cobrado antes (então na venda da loja: CSOSN 500 / CFOP 5405). */
export function temSubstituicao(cst) {
  return ['10', '30', '60', '70', '201', '202', '203', '500'].includes(String(cst || ''));
}

/**
 * Lê o XML da NF-e. Lança Error com mensagem para o usuário se não for uma NF-e.
 * @returns {{ chave, numero, serie, modelo, data_emissao, natureza, ambiente, autorizada, protocolo,
 *   fornecedor, destinatario, itens, totais, duplicatas, info_complementar }}
 */
export function lerNfe(xml) {
  const arvore = lerXml(String(xml || '').replace(/^﻿/, ''));
  const inf = buscar(arvore, 'infNFe');
  if (!inf) throw new Error('O arquivo não é o XML de uma NF-e (não achei <infNFe>).');
  const ide = filho(inf, 'ide');
  const emit = filho(inf, 'emit');
  const dest = filho(inf, 'dest');
  const prot = buscar(arvore, 'infProt');
  const chave = so(inf.attrs.Id) || so(txt(prot, 'chNFe'));
  const modelo = txt(ide, 'mod');
  if (modelo && modelo !== '55') throw new Error(`Modelo ${modelo} não é NF-e de compra (NFC-e não serve para entrada).`);
  const end = filho(emit, 'enderEmit');

  const itens = filhos(inf, 'det').map((d) => {
    const p = filho(d, 'prod');
    const imp = filho(d, 'imposto');
    const icms = no(imp, 'ICMS/*');
    const ipi = filho(imp, 'IPI');
    const ipiTrib = filho(ipi, 'IPITrib');
    const qCom = num(p, 'qCom');
    const vProd = num(p, 'vProd');
    const vDesc = num(p, 'vDesc');
    const vFrete = num(p, 'vFrete');
    const vSeg = num(p, 'vSeg');
    const vOutro = num(p, 'vOutro');
    const vIPI = num(ipiTrib, 'vIPI');
    const vST = num(icms, 'vICMSST') + num(icms, 'vFCPST');
    const cst = txt(icms, 'CST') || txt(icms, 'CSOSN');
    return {
      item: Number(d.attrs.nItem) || 0,
      codigo: txt(p, 'cProd'),
      ean: eanValido(txt(p, 'cEAN')) || eanValido(txt(p, 'cEANTrib')),
      descricao: txt(p, 'xProd'),
      ncm: so(txt(p, 'NCM')) || null,
      cest: so(txt(p, 'CEST')) || null,
      cfop: txt(p, 'CFOP'),
      unidade: (txt(p, 'uCom') || 'UN').toUpperCase(),
      quantidade: qCom,
      valor_unitario: num(p, 'vUnCom'),
      valor_produtos: vProd,
      desconto: vDesc, frete: vFrete, seguro: vSeg, outras: vOutro,
      origem: Number(txt(icms, 'orig') || 0),
      cst_icms: cst,
      aliquota_icms: num(icms, 'pICMS'),
      valor_ipi: vIPI,
      aliquota_ipi: num(ipiTrib, 'pIPI'),
      valor_st: vST,
      substituicao: temSubstituicao(cst),
      // custo do item já com IPI, ST, frete, seguro e outras despesas, menos o desconto (crédito de ICMS não se aplica no Simples)
      custo_total: r2(vProd - vDesc + vFrete + vSeg + vOutro + vIPI + vST),
      info: txt(d, 'infAdProd'),
    };
  });

  const tot = no(inf, 'total/ICMSTot');
  return {
    chave: chave.length === 44 ? chave : null,
    numero: txt(ide, 'nNF'),
    serie: Number(txt(ide, 'serie') || 0),
    modelo: modelo || '55',
    data_emissao: (txt(ide, 'dhEmi') || txt(ide, 'dEmi') || '').slice(0, 10) || null,
    natureza: txt(ide, 'natOp'),
    tipo: txt(ide, 'tpNF') === '0' ? 'entrada' : 'saida', // tpNF do emitente: 1 = saída dele (compra para nós)
    ambiente: txt(ide, 'tpAmb') === '2' ? 'homologacao' : 'producao',
    autorizada: prot ? ['100', '150'].includes(txt(prot, 'cStat')) : null,
    protocolo: txt(prot, 'nProt'),
    fornecedor: {
      cnpj: so(txt(emit, 'CNPJ') || txt(emit, 'CPF')),
      nome: txt(emit, 'xNome'), fantasia: txt(emit, 'xFant'), ie: txt(emit, 'IE'), crt: txt(emit, 'CRT'),
      endereco: txt(end, 'xLgr'), numero: txt(end, 'nro'), complemento: txt(end, 'xCpl'), bairro: txt(end, 'xBairro'),
      cidade_ibge: Number(txt(end, 'cMun')) || null, cidade: txt(end, 'xMun'), uf: txt(end, 'UF'), cep: so(txt(end, 'CEP')) || null,
      telefone: so(txt(end, 'fone')) || null,
    },
    destinatario: { cnpj: so(txt(dest, 'CNPJ') || txt(dest, 'CPF')), nome: txt(dest, 'xNome') },
    itens,
    totais: {
      produtos: num(tot, 'vProd'), frete: num(tot, 'vFrete'), seguro: num(tot, 'vSeg'), desconto: num(tot, 'vDesc'),
      ipi: num(tot, 'vIPI'), st: num(tot, 'vST') + num(tot, 'vFCPST'), outras: num(tot, 'vOutro'), icms: num(tot, 'vICMS'), total: num(tot, 'vNF'),
    },
    duplicatas: filhos(no(inf, 'cobr'), 'dup').map((d) => ({ numero: txt(d, 'nDup'), vencimento: txt(d, 'dVenc'), valor: num(d, 'vDup') })),
    info_complementar: txt(inf, 'infAdic/infCpl'),
  };
}

/**
 * Sugestão fiscal para a VENDA do item pela loja (Simples Nacional, igual ao cadastro atual):
 * com ST na compra -> CSOSN 500 / CFOP 5405; sem ST -> CSOSN 102 / CFOP 5102. Origem da mercadoria vem da nota.
 */
export function sugestaoFiscalVenda(item) {
  return item.substituicao ? { cst_csosn: '500', cfop: 5405, origem: item.origem } : { cst_csosn: '102', cfop: 5102, origem: item.origem };
}
