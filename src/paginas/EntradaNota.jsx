// Entrada de nota de compra (/compras/entrada): arquivo XML ou chave de acesso (código de barras do DANFE, baixa pela Focus/MD-e).
// O XML preenche fornecedor, itens, impostos e duplicatas; cada item é ligado ao cadastro (código no fornecedor ou EAN) ou vira
// produto novo; os campos fiscais ficam editáveis com busca (NCM/CFOP/CSOSN/CEST). Lançar = lancar_compra (020): estoque,
// custo/custo médio, vínculo com o fornecedor, dados fiscais/preço escolhidos e contas a pagar das duplicatas.
import { useMemo, useRef, useState } from 'react';
import { supabase, api, ou } from '../lib/supabase.js';
import { moeda, numero, data, hoje, documento } from '../lib/formato.js';
import { navegar } from '../lib/contexto.js';
import { lerNfe, chaveValida, sugestaoFiscalVenda } from '../lib/nfeXml.js';
import { formatarNcm, descricao, CSOSNS } from '../lib/fiscalTabelas.js';
import { Pagina, Campo, Aviso, Etiqueta, Modal, useAvisar } from '../componentes/ui.jsx';
import { CampoNcm, CampoCfop, CampoCsosn, CampoOrigem, CampoCest, SugestoesCadastro } from '../componentes/CamposFiscais.jsx';

const CNPJ_LOJA = '11877694000166';
const num = (v) => Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0;
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const txt = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
const FISCAIS = ['ncm', 'cest', 'cst_csosn', 'cfop', 'origem'];

/** Estado inicial de uma linha da nota a partir do item do XML e do produto casado (ou null). */
function novaLinha(it, casado, margemPadrao) {
  const sug = { ncm: it.ncm || '', cest: it.cest || '', ...sugestaoFiscalVenda(it) };
  const pr = casado?.produto || null;
  const fiscal = pr ? { ncm: pr.ncm || '', cest: pr.cest || '', cst_csosn: pr.cst_csosn || '', cfop: pr.cfop ?? '', origem: pr.origem ?? 0 } : { ...sug };
  return {
    it, produto: pr, como: casado?.como || null, novo: pr ? null : null, fator: '1',
    fiscal, sugestao: sug, preco: '', margem: pr?.margem ? String(pr.margem) : String(margemPadrao), aberto: false,
  };
}

function divergencias(l) {
  if (!l.produto) return [];
  const p = l.produto; const s = l.sugestao; const out = [];
  if (s.ncm && s.ncm !== (p.ncm || '')) out.push(`NCM da nota ${formatarNcm(s.ncm)} ≠ cadastro ${formatarNcm(p.ncm) || '—'}`);
  if (String(s.cst_csosn) !== String(p.cst_csosn || '')) out.push(`nota ${l.it.substituicao ? 'com' : 'sem'} ST → sugerido CSOSN ${s.cst_csosn}/${s.cfop}, cadastro ${p.cst_csosn || '—'}/${p.cfop || '—'}`);
  if (s.cest && s.cest !== (p.cest || '')) out.push(`CEST da nota ${s.cest} ≠ cadastro ${p.cest || '—'}`);
  return out;
}

function BuscaProduto({ aoEscolher, aoFechar, inicial }) {
  const [termo, setTermo] = useState(inicial || '');
  const [lista, setLista] = useState([]);
  const t = useRef(null);
  function buscar(v) {
    setTermo(v);
    clearTimeout(t.current);
    t.current = setTimeout(async () => {
      const x = v.trim();
      if (x.length < 2) { setLista([]); return; }
      let q = supabase.from('produtos').select('id, nome, unidade, codigo_barras, estoque, custo, custo_medio, preco_venda, margem, ncm, cest, cst_csosn, cfop, origem, ativo, grupo_id');
      if (/^\d{8,14}$/.test(x)) q = q.eq('codigo_barras', x);
      else if (/^\d{1,7}$/.test(x)) q = q.eq('id', Number(x));
      else for (const p of x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/)) q = q.ilike('busca', `%${p.replace(/[%_]/g, '')}%`);
      setLista(ou(await q.order('ativo', { ascending: false }).order('nome').limit(25)).data);
    }, 250);
  }
  return (
    <Modal aberto largo titulo="Ligar ao produto do cadastro" aoFechar={aoFechar}>
      <input className="fiscal-busca" autoFocus value={termo} onChange={(e) => buscar(e.target.value)} placeholder="Nome, código ou código de barras" />
      <ul className="fiscal-lista">
        {lista.map((p) => (
          <li key={p.id}><button type="button" onClick={() => aoEscolher(p)}>
            <strong>{p.id}</strong><span>{p.nome} — estoque {numero(p.estoque)} {p.unidade} · {moeda(p.preco_venda)}{!p.ativo && ' · INATIVO'}</span>
          </button></li>
        ))}
      </ul>
    </Modal>
  );
}

function Origem({ aoCarregar }) {
  const avisar = useAvisar();
  const [chave, setChave] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [resumo, setResumo] = useState(null);
  const arquivo = useRef(null);
  async function lerArquivo(f) {
    if (!f) return;
    try { aoCarregar(await f.text()); } catch (e) { avisar(e.message, 'erro'); }
  }
  async function buscarChave(manifestar = false) {
    const c = chave.replace(/\D/g, '');
    if (!chaveValida(c)) return avisar('Chave inválida: confira os 44 dígitos (o último é o dígito verificador).', 'erro');
    setBuscando(true);
    try {
      const r = await api('fiscal', { corpo: { acao: 'nfe_recebida', chave: c, manifestar } });
      if (r.situacao === 'ok') aoCarregar(r.xml);
      else if (r.situacao === 'precisa_ciencia') setResumo({ ...r.resumo, chave: c });
      else if (r.situacao === 'ciencia_registrada') { avisar(r.mensagem, 'ok'); setResumo(null); }
      else avisar('A nota ainda não chegou à Focus pela SEFAZ (pode levar algumas horas depois da emissão). Use o XML do fornecedor ou tente mais tarde.', 'erro');
    } catch (e) { avisar(e.message, 'erro'); }
    setBuscando(false);
  }
  return (
    <div className="entrada-origem">
      <div className="entrada-opcao"
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); lerArquivo(e.dataTransfer.files[0]); }}>
        <h2>Arquivo XML</h2>
        <p className="texto-fraco">Arraste aqui o XML que o fornecedor mandou (e-mail) ou escolha o arquivo.</p>
        <input ref={arquivo} type="file" accept=".xml,text/xml,application/xml" hidden onChange={(e) => lerArquivo(e.target.files[0])} />
        <button type="button" className="btn btn-pri" onClick={() => arquivo.current?.click()}>Escolher XML</button>
      </div>
      <form className="entrada-opcao" onSubmit={(e) => { e.preventDefault(); buscarChave(false); }}>
        <h2>Chave de acesso / código de barras do DANFE</h2>
        <p className="texto-fraco">Bipe o código de barras do DANFE ou digite os 44 números. O XML é baixado da SEFAZ pela Focus NFe.</p>
        <input className="entrada-chave" value={chave} onChange={(e) => setChave(e.target.value.replace(/\D/g, '').slice(0, 44))} inputMode="numeric" placeholder="44 dígitos" autoFocus />
        <small className="texto-fraco">{chave.length}/44{chave.length === 44 && (chaveValida(chave) ? ' ✓' : ' — dígito verificador não confere')}</small>
        <button type="submit" className="btn btn-pri" disabled={buscando || chave.length !== 44}>{buscando ? 'Buscando…' : 'Buscar nota'}</button>
      </form>
      {resumo && (
        <Modal aberto titulo="Nota encontrada, falta a ciência" aoFechar={() => setResumo(null)}
          rodape={<><button type="button" className="btn btn-sec" onClick={() => setResumo(null)}>Agora não</button>
            <button type="button" className="btn btn-pri" disabled={buscando} onClick={() => buscarChave(true)}>{buscando ? 'Registrando…' : 'Registrar ciência e baixar'}</button></>}>
          <p><strong>{resumo.emitente}</strong> ({documento(resumo.cnpj)}) — {moeda(resumo.valor)}, emitida em {data(resumo.emissao)}.</p>
          <p>Para liberar o XML completo, a SEFAZ exige o evento <strong>Ciência da operação</strong> em nome da Ponto Certo. Ele só registra que a loja
            conhece a nota (não confirma o recebimento nem gera imposto). Depois, a confirmação ou recusa pode ser feita normalmente.</p>
        </Modal>
      )}
    </div>
  );
}

export default function EntradaNota() {
  const avisar = useAvisar();
  const [xml, setXml] = useState('');
  const [nota, setNota] = useState(null);
  const [prep, setPrep] = useState(null);
  const [linhas, setLinhas] = useState([]);
  const [cab, setCab] = useState({ data_entrada: hoje(), observacao: '', gerar_pagar: true });
  const [dups, setDups] = useState([]);
  const [margemPadrao, setMargemPadrao] = useState('60');
  const [buscando, setBuscando] = useState(null); // índice da linha
  const [grupos, setGrupos] = useState([]);
  const [lancando, setLancando] = useState(false);
  const [feito, setFeito] = useState(null);

  async function carregar(texto) {
    let n;
    try { n = lerNfe(texto); } catch (e) { avisar(e.message, 'erro'); return; }
    try {
      const p = ou(await supabase.rpc('entrada_preparar', { p: { fornecedor_cnpj: n.fornecedor.cnpj, chave: n.chave, itens: n.itens.map(({ item, codigo, ean }) => ({ item, codigo, ean })) } }));
      const g = ou(await supabase.from('grupos_produto').select('id, nome').order('nome')).data;
      setGrupos(g);
      setXml(texto); setNota(n); setPrep(p);
      setLinhas(n.itens.map((it) => novaLinha(it, p.itens.find((x) => x.item === it.item), num(margemPadrao))));
      setDups(n.duplicatas.map((d) => ({ ...d, valor: txt(d.valor) })));
      setCab((c) => ({ ...c, gerar_pagar: n.duplicatas.length > 0 }));
    } catch (e) { avisar(e.message, 'erro'); }
  }

  const setL = (k, f) => setLinhas((l) => l.map((x, j) => (j === k ? { ...x, ...(typeof f === 'function' ? f(x) : f) } : x)));
  const setFiscal = (k, campo) => (v) => setL(k, (x) => ({ fiscal: { ...x.fiscal, [campo]: v } }));

  const calc = useMemo(() => linhas.map((l) => {
    const qtdEst = r2(l.it.quantidade * (num(l.fator) || 1));
    const custoUn = qtdEst ? l.it.custo_total / qtdEst : 0;
    const margem = num(l.margem);
    const sugerido = r2(custoUn * (1 + margem / 100));
    const precoAtual = l.produto ? Number(l.produto.preco_venda) : 0;
    return { qtdEst, custoUn, sugerido, precoAtual, custoAntes: l.produto ? Number(l.produto.custo || 0) : null };
  }), [linhas]);

  const pendentes = linhas.filter((l) => !l.produto && !l.novo).length;
  const somaItens = r2(linhas.reduce((s, l) => s + l.it.custo_total, 0));
  const somaDups = r2(dups.reduce((s, d) => s + num(d.valor), 0));
  const outroDest = nota && nota.destinatario.cnpj !== CNPJ_LOJA;

  async function lancar() {
    if (prep.duplicada) return avisar(`Esta nota já foi lançada (compra ${prep.duplicada.compra_id}).`, 'erro');
    if (pendentes) return avisar(`${pendentes} item(ns) sem produto: ligue ao cadastro ou marque como produto novo.`, 'erro');
    for (const [k, l] of linhas.entries()) {
      if (l.novo && !l.novo.nome.trim()) return avisar(`Item ${l.it.item}: informe o nome do produto novo.`, 'erro');
      if (l.novo && !/^\d{8}$/.test(l.fiscal.ncm)) return avisar(`Item ${l.it.item}: NCM com 8 dígitos.`, 'erro');
      if (l.novo && !(num(l.preco) > 0) && !(calc[k].sugerido > 0)) return avisar(`Item ${l.it.item}: informe o preço de venda.`, 'erro');
      if (!(num(l.fator) > 0)) return avisar(`Item ${l.it.item}: fator inválido.`, 'erro');
    }
    if (cab.gerar_pagar && dups.some((d) => !d.vencimento || !(num(d.valor) > 0))) return avisar('Duplicatas: informe vencimento e valor.', 'erro');
    setLancando(true);
    try {
      const itens = linhas.map((l, k) => {
        const base = { item: l.it.item, codigo_fornecedor: l.it.codigo, descricao: l.it.descricao, ean: l.it.ean, ncm: l.it.ncm, cest: l.it.cest, cfop: l.it.cfop,
          cst_icms: l.it.cst_icms, origem: l.it.origem, unidade: l.it.unidade, quantidade: l.it.quantidade, fator: num(l.fator) || 1,
          valor_unitario: l.it.valor_unitario, valor_produtos: l.it.valor_produtos, valor_ipi: l.it.valor_ipi, valor_st: l.it.valor_st, custo_total: l.it.custo_total };
        if (l.novo) {
          return { ...base, novo: { nome: l.novo.nome, unidade: l.novo.unidade, codigo_barras: l.it.ean, grupo_id: l.novo.grupo_id || null, preco_venda: num(l.preco) || calc[k].sugerido },
            atualizar: { ncm: l.fiscal.ncm, cest: l.fiscal.cest, cst_csosn: l.fiscal.cst_csosn, cfop: Number(l.fiscal.cfop) || 5102, origem: Number(l.fiscal.origem) || 0 } };
        }
        // produto existente: só manda o que mudou em relação ao cadastro
        const atualizar = {};
        for (const c of FISCAIS) {
          const novo = c === 'cfop' || c === 'origem' ? (l.fiscal[c] === '' ? null : Number(l.fiscal[c])) : l.fiscal[c] || '';
          const antes = c === 'cfop' || c === 'origem' ? (l.produto[c] ?? null) : l.produto[c] || '';
          if (String(novo ?? '') !== String(antes ?? '')) atualizar[c] = novo;
        }
        if (num(l.preco) > 0 && r2(num(l.preco)) !== r2(Number(l.produto.preco_venda))) atualizar.preco_venda = r2(num(l.preco));
        if (l.it.ean && !l.produto.codigo_barras) atualizar.codigo_barras = l.it.ean;
        return { ...base, produto_id: l.produto.id, ...(Object.keys(atualizar).length ? { atualizar } : {}) };
      });
      const p = { chave: nota.chave, numero: nota.numero, serie: nota.serie, data_emissao: nota.data_emissao, data_entrada: cab.data_entrada, natureza: nota.natureza,
        observacao: cab.observacao || null, xml, fornecedor: prep.fornecedor ? { id: prep.fornecedor.id } : nota.fornecedor, totais: nota.totais,
        duplicatas: dups.map((d) => ({ numero: d.numero, vencimento: d.vencimento, valor: num(d.valor) })), gerar_pagar: cab.gerar_pagar && dups.length > 0, itens };
      const id = ou(await supabase.rpc('lancar_compra', { p }));
      setFeito({ id, novos: linhas.filter((l) => l.novo).length });
      api('marketplaces', { corpo: { acao: 'ml_sincronizar' } }).catch(() => {}); // estoque subiu: atualiza os anúncios
    } catch (e) { avisar(e.message, 'erro'); }
    setLancando(false);
  }

  if (feito) {
    return (
      <Pagina titulo="Nota lançada">
        <Aviso tipo="ok">Compra {feito.id} lançada: estoque, custo e vínculos atualizados{feito.novos ? `, ${feito.novos} produto(s) novo(s) cadastrado(s)` : ''}{cab.gerar_pagar && dups.length ? ` e ${dups.length} conta(s) a pagar criada(s)` : ''}.</Aviso>
        <div className="pagina-acoes">
          <button type="button" className="btn btn-pri" onClick={() => navegar(`/etiquetas?compra=${feito.id}`)}>Imprimir etiquetas</button>
          <button type="button" className="btn btn-sec" onClick={() => { setFeito(null); setNota(null); setXml(''); }}>Lançar outra nota</button>
          <button type="button" className="btn btn-sec" onClick={() => navegar('/compras')}>Ver notas de compra</button>
        </div>
      </Pagina>
    );
  }

  if (!nota) {
    return (
      <Pagina titulo="Entrada de nota de compra" subtitulo="Pelo XML ou pela chave de acesso (código de barras do DANFE)"
        acoes={<a className="btn btn-sec" href="#/compras">Voltar</a>}>
        <Origem aoCarregar={carregar} />
        <Aviso tipo="alerta">Enquanto o DirectControl continuar sincronizando com o ERP, o estoque e as compras vêm de lá: lance a nota <strong>num só sistema</strong>.
          Lançando aqui, o estoque é recalculado pelo DirectControl na próxima sincronização (o cadastro fiscal e os preços editados aqui ficam).</Aviso>
      </Pagina>
    );
  }

  const f = nota.fornecedor;
  return (
    <Pagina titulo={`NF-e ${nota.numero} série ${nota.serie}`} subtitulo={`${f.nome} — ${documento(f.cnpj)} — emitida em ${data(nota.data_emissao)}`}
      acoes={<button type="button" className="btn btn-sec" onClick={() => setNota(null)}>Trocar nota</button>}>
      {prep.duplicada && <Aviso tipo="erro">Esta nota já foi lançada {prep.duplicada.origem === 'legado' ? 'no DirectControl' : 'no ERP'} (compra {prep.duplicada.compra_id}, entrada {data(prep.duplicada.data_entrada)}). Não dá para lançar de novo.</Aviso>}
      {outroDest && <Aviso tipo="erro">O destinatário desta nota é {documento(nota.destinatario.cnpj)} ({nota.destinatario.nome}), não a Ponto Certo.</Aviso>}
      {nota.ambiente === 'homologacao' && <Aviso tipo="erro">XML de homologação (sem valor fiscal).</Aviso>}
      {nota.autorizada === false && <Aviso tipo="erro">O XML não traz autorização da SEFAZ.</Aviso>}
      {nota.autorizada === null && <Aviso tipo="alerta">XML sem o protocolo de autorização (veio só a NF-e, sem o nfeProc). Confira a nota na SEFAZ.</Aviso>}

      <div className="entrada-cab">
        <div className="entrada-bloco">
          <h3>Fornecedor</h3>
          {prep.fornecedor ? <p><Etiqueta tipo="ok">cadastrado</Etiqueta> {prep.fornecedor.nome} <span className="cod">{prep.fornecedor.id}</span></p>
            : <p><Etiqueta tipo="alerta">novo</Etiqueta> será cadastrado com os dados do XML: {f.nome}, {f.cidade}/{f.uf}</p>}
          <p className="texto-fraco">{nota.natureza}{nota.chave && <> · chave {nota.chave}</>}</p>
        </div>
        <div className="entrada-bloco entrada-totais">
          <h3>Totais da nota</h3>
          <div><span>Produtos</span><strong>{moeda(nota.totais.produtos)}</strong></div>
          {nota.totais.frete > 0 && <div><span>Frete</span><strong>{moeda(nota.totais.frete)}</strong></div>}
          {nota.totais.ipi > 0 && <div><span>IPI</span><strong>{moeda(nota.totais.ipi)}</strong></div>}
          {nota.totais.st > 0 && <div><span>ICMS-ST</span><strong>{moeda(nota.totais.st)}</strong></div>}
          {nota.totais.desconto > 0 && <div><span>Desconto</span><strong>-{moeda(nota.totais.desconto)}</strong></div>}
          {nota.totais.outras > 0 && <div><span>Outras despesas</span><strong>{moeda(nota.totais.outras)}</strong></div>}
          <div className="entrada-total"><span>Total</span><strong>{moeda(nota.totais.total)}</strong></div>
          {Math.abs(somaItens - nota.totais.total) > 0.05 && <p className="texto-erro">Custo dos itens ({moeda(somaItens)}) não fecha com o total da nota.</p>}
        </div>
        <div className="entrada-bloco">
          <h3>Entrada</h3>
          <div className="filtros">
            <Campo rotulo="Data de entrada"><input type="date" value={cab.data_entrada} max={hoje()} onChange={(e) => setCab({ ...cab, data_entrada: e.target.value })} /></Campo>
            <Campo rotulo="Margem padrão p/ sugestão (%)"><input inputMode="decimal" value={margemPadrao} onChange={(e) => setMargemPadrao(e.target.value)} /></Campo>
          </div>
          <Campo rotulo="Observação" largo><input value={cab.observacao} onChange={(e) => setCab({ ...cab, observacao: e.target.value })} maxLength={200} /></Campo>
        </div>
      </div>

      <h3 className="pdv-subtitulo">Itens ({linhas.length}){pendentes > 0 && <> — <span className="texto-erro">{pendentes} sem produto</span></>}</h3>
      <div className="tabela-caixa">
        <table className="tabela entrada-itens">
          <thead><tr><th>#</th><th>Item da nota</th><th className="al-dir">Qtd nota</th><th>Fator</th><th className="al-dir">Entra no estoque</th>
            <th className="al-dir">Custo un.</th><th>Produto no cadastro</th><th className="al-dir">Preço de venda</th><th>Fiscal (venda)</th></tr></thead>
          <tbody>
            {linhas.map((l, k) => {
              const c = calc[k]; const div = divergencias(l);
              const subiu = c.custoAntes && c.custoUn > c.custoAntes * 1.005;
              return [
                <tr key={`l${k}`} className={!l.produto && !l.novo ? 'linha-pendente' : ''}>
                  <td>{l.it.item}</td>
                  <td><div className="entrada-desc">{l.it.descricao}</div>
                    <small className="texto-fraco">cód. {l.it.codigo}{l.it.ean ? ` · EAN ${l.it.ean}` : ''} · NCM {formatarNcm(l.it.ncm)} · CFOP {l.it.cfop} · {l.it.substituicao ? 'com ST' : `CST ${l.it.cst_icms}`}</small></td>
                  <td className="al-dir">{numero(l.it.quantidade)} {l.it.unidade}<br /><small className="texto-fraco">{moeda(l.it.valor_unitario)}</small></td>
                  <td><input className="input-peq" inputMode="decimal" value={l.fator} onChange={(e) => setL(k, { fator: e.target.value })} title="Unidades de estoque por unidade da nota (ex.: caixa com 12 = 12)" /></td>
                  <td className="al-dir"><strong>{numero(c.qtdEst)}</strong> {l.produto?.unidade || l.novo?.unidade || l.it.unidade}</td>
                  <td className="al-dir">{moeda(c.custoUn)}{c.custoAntes !== null && <><br /><small className={subiu ? 'texto-erro' : 'texto-fraco'}>antes {moeda(c.custoAntes)}</small></>}</td>
                  <td>
                    {l.produto ? <>
                      <span className="cod">{l.produto.id}</span> {l.produto.nome}{' '}
                      <Etiqueta tipo="ok">{l.como === 'codigo_fornecedor' ? 'pelo código do fornecedor' : l.como === 'ean' ? 'pelo EAN' : 'escolhido'}</Etiqueta>
                      {!l.produto.ativo && <Etiqueta tipo="erro">inativo</Etiqueta>}
                      <br /><button type="button" className="btn-link" onClick={() => setBuscando(k)}>trocar</button>
                    </> : l.novo ? <>
                      <input className="entrada-novo" value={l.novo.nome} onChange={(e) => setL(k, (x) => ({ novo: { ...x.novo, nome: e.target.value } }))} maxLength={120} />
                      <div className="entrada-novo-linha">
                        <select value={l.novo.grupo_id || ''} onChange={(e) => setL(k, (x) => ({ novo: { ...x.novo, grupo_id: e.target.value ? Number(e.target.value) : null } }))}>
                          <option value="">Grupo…</option>{grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}</select>
                        <input className="input-peq" value={l.novo.unidade} onChange={(e) => setL(k, (x) => ({ novo: { ...x.novo, unidade: e.target.value.toUpperCase().slice(0, 6) } }))} title="Unidade de venda" />
                      </div>
                      <Etiqueta tipo="alerta">produto novo</Etiqueta> <button type="button" className="btn-link" onClick={() => setL(k, { novo: null })}>desfazer</button>
                    </> : <>
                      <button type="button" className="btn btn-sec btn-peq" onClick={() => setBuscando(k)}>Ligar ao cadastro</button>{' '}
                      <button type="button" className="btn btn-sec btn-peq" onClick={() => setL(k, { novo: { nome: l.it.descricao.toUpperCase().slice(0, 120), unidade: l.it.unidade, grupo_id: null }, aberto: true })}>Produto novo</button>
                    </>}
                  </td>
                  <td className="al-dir">
                    {l.produto && <small className="texto-fraco">atual {moeda(c.precoAtual)}<br /></small>}
                    <input className="input-peq" inputMode="decimal" value={l.preco} onChange={(e) => setL(k, { preco: e.target.value })} placeholder={l.novo ? txt(c.sugerido.toFixed(2)) : 'manter'} />
                    <br /><button type="button" className="btn-link" title={`custo × (1 + ${l.margem}%)`} onClick={() => setL(k, { preco: txt(c.sugerido.toFixed(2)) })}>sugerido {moeda(c.sugerido)}</button>
                    {l.produto && c.precoAtual < c.sugerido * 0.98 && subiu && <Etiqueta tipo="erro">custo subiu</Etiqueta>}
                  </td>
                  <td>
                    <span className="entrada-fiscal-resumo">{formatarNcm(l.fiscal.ncm) || 'sem NCM'} · {l.fiscal.cst_csosn || '—'}/{l.fiscal.cfop || '—'}{l.fiscal.cest ? ` · CEST ${l.fiscal.cest}` : ''}</span>
                    {div.length > 0 && <Etiqueta tipo="alerta" title={div.join('\n')}>{div.length} diferença(s)</Etiqueta>}
                    <br /><button type="button" className="btn-link" onClick={() => setL(k, (x) => ({ aberto: !x.aberto }))}>{l.aberto ? 'fechar' : 'editar fiscal'}</button>
                  </td>
                </tr>,
                l.aberto && (
                  <tr key={`f${k}`} className="entrada-fiscal-linha"><td colSpan={9}>
                    <div className="entrada-fiscal">
                      <CampoNcm valor={l.fiscal.ncm} aoMudar={setFiscal(k, 'ncm')} />
                      <CampoCest valor={l.fiscal.cest} aoMudar={setFiscal(k, 'cest')} ncm={l.fiscal.ncm} />
                      <CampoCsosn valor={l.fiscal.cst_csosn} aoMudar={(v) => setL(k, (x) => ({ fiscal: { ...x.fiscal, cst_csosn: v, cfop: v === '500' ? 5405 : v === '102' ? 5102 : x.fiscal.cfop } }))} />
                      <CampoCfop valor={l.fiscal.cfop} aoMudar={setFiscal(k, 'cfop')} tipo="saida" rotulo="CFOP de venda" />
                      <CampoOrigem valor={l.fiscal.origem} aoMudar={setFiscal(k, 'origem')} />
                      <Campo rotulo="Margem (%)"><input className="input-peq" inputMode="decimal" value={l.margem} onChange={(e) => setL(k, { margem: e.target.value })} /></Campo>
                    </div>
                    <div className="fiscal-sugestoes">
                      <span className="texto-fraco">Pela nota: NCM {formatarNcm(l.sugestao.ncm)} · {l.it.substituicao ? 'com ST' : 'sem ST'} → CSOSN {l.sugestao.cst_csosn} ({descricao(CSOSNS, l.sugestao.cst_csosn)}) / CFOP {l.sugestao.cfop}</span>
                      <button type="button" className="btn btn-sec btn-peq" onClick={() => setL(k, (x) => ({ fiscal: { ...x.sugestao } }))}>Aplicar dados da nota</button>
                      {l.produto && <button type="button" className="btn btn-sec btn-peq" onClick={() => setL(k, (x) => ({ fiscal: { ncm: x.produto.ncm || '', cest: x.produto.cest || '', cst_csosn: x.produto.cst_csosn || '', cfop: x.produto.cfop ?? '', origem: x.produto.origem ?? 0 } }))}>Manter cadastro</button>}
                    </div>
                    <SugestoesCadastro ncm={l.fiscal.ncm} aoAplicar={(s) => setL(k, (x) => ({ fiscal: { ...x.fiscal, ...s } }))} />
                    {div.length > 0 && <ul className="entrada-div">{div.map((d) => <li key={d}>{d}</li>)}</ul>}
                  </td></tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>

      <div className="entrada-rodape">
        <div className="entrada-bloco">
          <h3>Duplicatas (contas a pagar)</h3>
          {dups.length === 0 ? <p className="texto-fraco">A nota não traz duplicatas (pagamento à vista ou combinado à parte).</p> : <>
            <label className="campo-check"><input type="checkbox" checked={cab.gerar_pagar} onChange={(e) => setCab({ ...cab, gerar_pagar: e.target.checked })} /> <span>Lançar em Contas a Pagar</span></label>
            {dups.map((d, k) => (
              <div key={k} className="filtros">
                <Campo rotulo={`Parcela ${d.numero || k + 1}`}><input type="date" value={d.vencimento || ''} onChange={(e) => setDups((l) => l.map((x, j) => (j === k ? { ...x, vencimento: e.target.value } : x)))} /></Campo>
                <Campo rotulo="Valor"><input inputMode="decimal" value={d.valor} onChange={(e) => setDups((l) => l.map((x, j) => (j === k ? { ...x, valor: e.target.value } : x)))} /></Campo>
              </div>
            ))}
            {Math.abs(somaDups - nota.totais.total) > 0.05 && <p className="texto-fraco">Duplicatas somam {moeda(somaDups)} (nota: {moeda(nota.totais.total)}).</p>}
          </>}
        </div>
        <div className="entrada-bloco entrada-final">
          <button type="button" className="btn btn-pri pdv-finalizar" onClick={lancar} disabled={lancando || Boolean(prep.duplicada) || outroDest || pendentes > 0}>
            {lancando ? 'Lançando…' : 'Lançar nota no estoque'}</button>
          <p className="texto-fraco">Soma ao estoque, atualiza custo e custo médio, grava o vínculo do código do fornecedor e os dados fiscais/preços alterados.</p>
        </div>
      </div>
      {buscando !== null && <BuscaProduto inicial={linhas[buscando].it.ean || ''} aoFechar={() => setBuscando(null)}
        aoEscolher={(p) => { setL(buscando, (x) => ({ ...novaLinha(x.it, { produto: p, como: 'manual' }, num(margemPadrao)), fator: x.fator, como: 'manual' })); setBuscando(null); }} />}
    </Pagina>
  );
}
