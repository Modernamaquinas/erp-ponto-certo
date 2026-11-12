import { useEffect, useRef, useState } from 'react';
import { supabase, api, ou } from '../lib/supabase.js';
import { moeda, numero, documento, hoje, somarDias } from '../lib/formato.js';
import { navegar } from '../lib/contexto.js';
import { imprimirNota, imprimirHtml, acaoAposEmitir, salvarArquivoNota } from '../lib/impressao.js';
import { htmlComprovante, htmlOrcamento } from '../lib/documentos.js';
import { Pagina, Campo, Tabela, Modal, Aviso, Etiqueta, useAvisar } from '../componentes/ui.jsx';
import { BuscaCliente } from './NotasFiscais.jsx';
import { PreVendasAbertas } from './PreVenda.jsx';

// PDV (venda no balcão) e orçamento. A tela só libera depois do código de 4 dígitos do operador,
// que vai junto em cada operação (o servidor confere permissões de desconto, estoque e custo).
const FORMAS = [['dinheiro', 'Dinheiro'], ['pix', 'PIX'], ['debito', 'Cartão de débito'], ['credito', 'Cartão de crédito'],
  ['crediario', 'Crediário'], ['boleto', 'Boleto'], ['cheque', 'Cheque']];
const num = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const CFG = 'pc-pdv';
const lerCfg = () => { try { return { bloquearAposVenda: true, ...JSON.parse(localStorage.getItem(CFG) || '{}') }; } catch { return { bloquearAposVenda: true }; } };

export default function PDV({ params, modo = 'venda' }) {
  const [op, setOp] = useState(null); // { codigo, nome, desconto_maximo, ... }
  const orcamentoId = params.orcamento ? Number(params.orcamento) : null;
  const [preVendas, setPreVendas] = useState(false);
  const titulo = modo === 'orcamento' ? (params.editar ? `Orçamento ${params.editar}` : 'Novo orçamento') : orcamentoId ? `Venda do orçamento/pré-venda ${orcamentoId}` : 'Nova venda';
  return (
    <Pagina titulo={titulo} subtitulo={modo === 'orcamento' ? 'Orçamento para o cliente (não baixa estoque)' : 'PDV — venda no balcão com NFC-e'}
      acoes={op && <span className="pdv-operador">
        {modo === 'venda' && <BotaoPreVendas aoAbrir={() => setPreVendas(true)} />}
        Operador: <strong>{op.nome}</strong>
        <button type="button" className="btn btn-sec btn-peq" onClick={() => setOp(null)}>Trocar / bloquear</button></span>}>
      {preVendas && op && <PreVendasAbertas op={op} aoFechar={() => setPreVendas(false)}
        aoEscolher={(o) => { setPreVendas(false); navegar(`/pdv?orcamento=${o.id}`); }} />}
      {!op ? <Desbloqueio aoLiberar={setOp} /> : (
        <Carrinho key={`${modo}-${orcamentoId}-${params.editar}`} op={op} modo={modo} orcamentoId={orcamentoId} editarId={params.editar ? Number(params.editar) : null}
          aoBloquear={() => setOp(null)} />
      )}
    </Pagina>
  );
}

export function Desbloqueio({ aoLiberar }) {
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [conferindo, setConferindo] = useState(false);
  const campo = useRef(null);
  useEffect(() => { campo.current?.focus(); }, []);
  async function liberar(e) {
    e?.preventDefault();
    if (!/^\d{4}$/.test(codigo)) return setErro('O código tem 4 dígitos.');
    setConferindo(true); setErro('');
    try {
      const r = await api('pdv', { corpo: { acao: 'operador', codigo } });
      aoLiberar({ ...r.operador, codigo });
    } catch (e2) { setErro(e2.message); setCodigo(''); campo.current?.focus(); }
    setConferindo(false);
  }
  return (
    <form className="pdv-bloqueio" onSubmit={liberar}>
      <span className="pdv-cadeado" aria-hidden="true">🔒</span>
      <h2>Digite o seu número de cadastro</h2>
      <input ref={campo} className="pdv-codigo" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={codigo}
        onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); setCodigo(v); setErro(''); }}
        onKeyUp={(e) => { if (e.key !== 'Enter' && codigo.length === 4 && !conferindo) liberar(); }} aria-label="Número do cadastro" />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <button type="submit" className="btn btn-pri" disabled={conferindo}>{conferindo ? 'Conferindo…' : 'Liberar'}</button>
      <p className="texto-fraco">O número (4 dígitos) é cadastrado pelo administrador em Sistema → Usuários.</p>
    </form>
  );
}

function Carrinho({ op, modo, orcamentoId, editarId, aoBloquear }) {
  const avisar = useAvisar();
  const [itens, setItens] = useState([]);
  const [cliente, setCliente] = useState(null);
  const [nomeAvulso, setNomeAvulso] = useState('');
  const [descGeral, setDescGeral] = useState('');
  const [termo, setTermo] = useState('');
  const [sugestoes, setSugestoes] = useState([]);
  const [finalizando, setFinalizando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [orc, setOrc] = useState({ validade: somarDias(hoje(), 10), observacao: '' });
  const busca = useRef(null);
  const carregarId = orcamentoId || editarId;

  // carrega o orçamento (para converter em venda ou editar)
  useEffect(() => {
    if (!carregarId) return;
    (async () => {
      const o = ou(await supabase.from('orcamentos').select('*, clientes(id, nome, cpf_cnpj, cidades(nome, uf))').eq('id', carregarId).single()).data;
      const its = ou(await supabase.from('orcamento_itens').select('produto_id, descricao, quantidade, preco_unitario, desconto, produtos(nome, estoque, ncm, codigo_barras, unidade)')
        .eq('orcamento_id', carregarId).order('item')).data;
      if (o.status !== 'aberto') avisar(`Orçamento ${o.status}: não pode ser alterado nem convertido.`, 'erro');
      setItens(its.map((i) => ({ id: i.produto_id, nome: i.produtos?.nome || i.descricao, estoque: i.produtos?.estoque, ncm: i.produtos?.ncm,
        quantidade: String(i.quantidade).replace('.', ','), preco: String(i.preco_unitario).replace('.', ','), desconto: Number(i.desconto) ? String(i.desconto).replace('.', ',') : '' })));
      if (o.clientes) setCliente(o.clientes);
      else setNomeAvulso(o.cliente_nome || '');
      setOrc({ validade: o.validade || somarDias(hoje(), 10), observacao: o.observacao || '' });
      const descItens = its.reduce((s, i) => s + Number(i.desconto), 0);
      const dg = r2(Number(o.desconto) - descItens);
      if (dg > 0) setDescGeral(String(dg).replace('.', ','));
    })().catch((e) => avisar(e.message, 'erro'));
  }, [carregarId]);

  useEffect(() => { busca.current?.focus(); }, []);

  // pesquisa: "3*7891234567890" = 3 unidades; código de barras ou código interno exatos entram direto
  async function pesquisar(texto, adicionarSeUnico) {
    const m = /^(\d+(?:[.,]\d+)?)\*(.+)$/.exec(texto.trim());
    const qtd = m ? m[1].replace('.', ',') : '1';
    const t = (m ? m[2] : texto).trim();
    if (t.length < 2 && !/^\d+$/.test(t)) { setSugestoes([]); return; }
    let q = supabase.from('produtos').select('id, nome, preco_venda, estoque, ncm, codigo_barras, unidade').eq('ativo', true);
    if (/^\d{8,14}$/.test(t)) q = q.eq('codigo_barras', t);
    else if (/^\d{1,7}$/.test(t)) q = q.eq('id', Number(t));
    else for (const parte of t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/)) q = q.ilike('busca', `%${parte.replace(/[%_]/g, '')}%`);
    const lista = ou(await q.order('nome').limit(12)).data;
    if (adicionarSeUnico && lista.length === 1 && /^\d+$/.test(t)) { adicionar(lista[0], qtd); return; }
    if (adicionarSeUnico && !lista.length) avisar('Produto não encontrado.', 'erro');
    setSugestoes(lista.map((p) => ({ ...p, qtd })));
  }
  useEffect(() => { const h = setTimeout(() => { if (termo && !/^\d+$/.test(termo.replace(/^\d+[.,]?\d*\*/, ''))) pesquisar(termo, false).catch(() => {}); }, 300); return () => clearTimeout(h); }, [termo]);

  function adicionar(p, qtd = '1') {
    setItens((l) => {
      const k = l.findIndex((x) => x.id === p.id && !num(x.desconto));
      if (k >= 0) return l.map((x, j) => (j === k ? { ...x, quantidade: String(r2(num(x.quantidade) + num(qtd))).replace('.', ',') } : x));
      return [...l, { id: p.id, nome: p.nome, estoque: p.estoque, ncm: p.ncm, quantidade: qtd, preco: String(p.preco_venda).replace('.', ','), desconto: '' }];
    });
    setTermo(''); setSugestoes([]); busca.current?.focus();
  }

  const bruto = (i) => r2(num(i.quantidade) * num(i.preco));
  const totalProdutos = r2(itens.reduce((s, i) => s + bruto(i), 0));
  const descItens = r2(itens.reduce((s, i) => s + num(i.desconto), 0));
  const total = r2(totalProdutos - descItens - num(descGeral));
  const descPerc = totalProdutos ? ((descItens + num(descGeral)) / totalProdutos) * 100 : 0;
  const setItem = (k, campo) => (e) => setItens((l) => l.map((x, j) => (j === k ? { ...x, [campo]: e.target.value } : x)));
  const payloadItens = () => itens.map((i) => ({ produto_id: i.id, quantidade: num(i.quantidade), preco_unitario: num(i.preco), desconto: num(i.desconto) }));

  async function salvarOrcamento() {
    try {
      const r = await api('pdv', { corpo: { acao: 'orcamento_salvar', codigo: op.codigo, id: editarId || undefined, cliente_id: cliente?.id,
        validade: orc.validade || null, observacao: orc.observacao || null, desconto_geral: num(descGeral), itens: payloadItens() } });
      avisar(`Orçamento ${r.id} salvo.`);
      const o = ou(await supabase.from('orcamentos').select('*').eq('id', r.id).single()).data;
      setResultado({ orcamento: o, itens: payloadItens().map((i, k) => ({ ...i, descricao: itens[k].nome })) });
    } catch (e) { avisar(e.message, 'erro'); }
  }

  // atalhos do teclado
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'F2') { e.preventDefault(); busca.current?.focus(); }
      if (e.key === 'F10' && itens.length && !finalizando && !resultado) { e.preventDefault(); modo === 'orcamento' ? salvarOrcamento() : setFinalizando(true); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  function novaVenda() {
    setItens([]); setCliente(null); setNomeAvulso(''); setDescGeral(''); setResultado(null); setFinalizando(false);
    if (orcamentoId || editarId) navegar(modo === 'orcamento' ? '/orcamentos' : '/pdv');
    if (modo === 'venda' && lerCfg().bloquearAposVenda) aoBloquear();
    else setTimeout(() => busca.current?.focus(), 50);
  }

  return (
    <div className="pdv">
      <div className="pdv-principal">
        <div className="busca-produto">
          <Campo rotulo="Produto — código de barras, código ou nome (F2). Quantidade: 3*código" largo>
            <input ref={busca} value={termo} onChange={(e) => setTermo(e.target.value)} autoComplete="off" className="pdv-busca"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (sugestoes.length === 1) adicionar(sugestoes[0], sugestoes[0].qtd); else pesquisar(termo, true).catch((x) => avisar(x.message, 'erro')); } }} />
          </Campo>
          {sugestoes.length > 0 && (
            <ul className="lista-escolha">
              {sugestoes.map((p) => (
                <li key={p.id}><button type="button" onClick={() => adicionar(p, p.qtd)}>
                  <span className="cod">{p.id}</span> {p.nome} — <strong>{moeda(p.preco_venda)}</strong>
                  <span className="texto-fraco"> estoque {numero(p.estoque)}</span>{!p.ncm && <Etiqueta tipo="erro">sem NCM</Etiqueta>}
                </button></li>
              ))}
            </ul>
          )}
        </div>
        <Tabela linhas={itens.map((x, k) => ({ ...x, k }))} chave="k" vazio="Passe o código de barras ou digite o produto."
          colunas={[
            { titulo: '#', render: (i) => i.k + 1 },
            { titulo: 'Produto', render: (i) => <><span className="cod">{i.id}</span> {i.nome}
              {modo === 'venda' && !op.vende_sem_estoque && num(i.quantidade) > Number(i.estoque) && <Etiqueta tipo="erro">estoque {numero(i.estoque)}</Etiqueta>}</> },
            { titulo: 'Qtd', render: (i) => <input className="input-peq" inputMode="decimal" value={i.quantidade} onChange={setItem(i.k, 'quantidade')} /> },
            { titulo: 'Unitário', render: (i) => <input className="input-peq" inputMode="decimal" value={i.preco} onChange={setItem(i.k, 'preco')} /> },
            { titulo: 'Desconto', render: (i) => <input className="input-peq" inputMode="decimal" value={i.desconto} onChange={setItem(i.k, 'desconto')} placeholder="0,00" /> },
            { titulo: 'Total', alinhar: 'dir', render: (i) => moeda(bruto(i) - num(i.desconto)) },
            { titulo: '', render: (i) => <button type="button" className="btn btn-sec btn-peq" onClick={() => setItens((l) => l.filter((_, j) => j !== i.k))}>✕</button> },
          ]} />
      </div>

      <aside className="pdv-lateral">
        {!cliente && nomeAvulso && <div className="resumo-linha"><span>Cliente da pré-venda: <strong>{nomeAvulso}</strong></span></div>}
        <BuscaCliente cliente={cliente} aoEscolher={setCliente} />
        {modo === 'orcamento' && <>
          <Campo rotulo="Validade"><input type="date" value={orc.validade} onChange={(e) => setOrc({ ...orc, validade: e.target.value })} /></Campo>
          <Campo rotulo="Observação" largo><textarea rows={3} value={orc.observacao} onChange={(e) => setOrc({ ...orc, observacao: e.target.value })} /></Campo>
        </>}
        <div className="pdv-totais">
          <div><span>Itens</span><strong>{itens.length}</strong></div>
          <div><span>Produtos</span><strong>{moeda(totalProdutos)}</strong></div>
          {descItens > 0 && <div><span>Desc. nos itens</span><strong>-{moeda(descItens)}</strong></div>}
          <Campo rotulo={`Desconto geral (máx. ${numero(op.desconto_maximo)}%)`}>
            <input inputMode="decimal" value={descGeral} onChange={(e) => setDescGeral(e.target.value)} placeholder="0,00" />
          </Campo>
          {descPerc > Number(op.desconto_maximo) + 0.001 && <Aviso tipo="erro">Desconto de {numero(descPerc.toFixed(2))}% acima do permitido para {op.nome}.</Aviso>}
          <div className="pdv-total"><span>TOTAL</span><strong>{moeda(total)}</strong></div>
        </div>
        {modo === 'orcamento'
          ? <button type="button" className="btn btn-pri pdv-finalizar" disabled={!itens.length} onClick={salvarOrcamento}>Salvar orçamento (F10)</button>
          : <button type="button" className="btn btn-pri pdv-finalizar" disabled={!itens.length || total <= 0} onClick={() => setFinalizando(true)}>Finalizar venda (F10)</button>}
        {itens.length > 0 && <button type="button" className="btn btn-sec" onClick={() => { setItens([]); setDescGeral(''); }}>Cancelar itens</button>}
      </aside>

      {finalizando && !resultado && (
        <Pagamento op={op} total={total} cliente={cliente} descGeral={descGeral} setDescGeral={setDescGeral} totalProdutos={totalProdutos} descItens={descItens}
          aoFechar={() => setFinalizando(false)}
          aoConcluir={(r, pagamentos, extra) => setResultado({ ...r, pagamentos, ...extra, itens: payloadItens().map((i, k) => ({ ...i, descricao: itens[k].nome })) })}
          enviar={(extra) => api('pdv', { corpo: { acao: 'finalizar', codigo: op.codigo, cliente_id: cliente?.id, cliente_nome: cliente ? undefined : nomeAvulso || undefined, orcamento_id: orcamentoId || undefined,
            desconto_geral: num(descGeral), itens: payloadItens(), ...extra } })} />
      )}
      {resultado?.venda_id && <ResultadoVenda r={resultado} op={op} cliente={cliente} descGeral={num(descGeral)} aoNova={novaVenda} />}
      {resultado?.orcamento && (
        <Modal aberto titulo={`Orçamento ${resultado.orcamento.id} salvo`} aoFechar={() => { setResultado(null); navegar('/orcamentos'); }}
          rodape={<>
            <button type="button" className="btn btn-sec" onClick={() => { setResultado(null); navegar('/orcamentos'); }}>Fechar</button>
            <button type="button" className="btn btn-pri" autoFocus onClick={() => imprimirHtml(htmlOrcamento(resultado.orcamento, resultado.itens), { titulo: `Orçamento ${resultado.orcamento.id}` })}>Imprimir orçamento</button>
          </>}>
          <p>Total: <strong>{moeda(resultado.orcamento.total)}</strong>{resultado.orcamento.validade && <> — válido até {resultado.orcamento.validade.split('-').reverse().join('/')}</>}</p>
        </Modal>
      )}
    </div>
  );
}

function Pagamento({ op, total: totalItens, cliente, descGeral, setDescGeral, totalProdutos, descItens, aoFechar, aoConcluir, enviar }) {
  const avisar = useAvisar();
  // campos opcionais da finalização: desconto em R$ (o mesmo "desconto geral" do carrinho), frete e endereço de entrega
  const [frete, setFrete] = useState('');
  const [endereco, setEndereco] = useState('');
  const [docFiscal, setDocFiscal] = useState('nfce');
  const total = r2(totalItens + num(frete));
  const valorTxt = (v) => String(v.toFixed(2)).replace('.', ',');
  const [pags, setPags] = useState([{ forma: 'dinheiro', valor: valorTxt(total), parcelas: '1', primeiro_vencimento: somarDias(hoje(), 30) }]);
  // com uma forma só, o valor acompanha o total quando muda o desconto ou o frete
  useEffect(() => { setPags((l) => (l.length === 1 ? [{ ...l[0], valor: valorTxt(total) }] : l)); }, [total]);
  const [cpf, setCpf] = useState(cliente?.cpf_cnpj || '');
  const [enviando, setEnviando] = useState(false);
  const descPerc = totalProdutos ? ((descItens + num(descGeral)) / totalProdutos) * 100 : 0;
  const nfe = docFiscal === 'nfe';
  // dinheiro: "recebido" é a nota que o cliente entregou; o que passa do valor vira troco (o servidor já trata o excesso em dinheiro como troco)
  const efetivo = (p) => (p.forma === 'dinheiro' && num(p.recebido) > num(p.valor) ? num(p.recebido) : num(p.valor));
  const pago = r2(pags.reduce((s, p) => s + efetivo(p), 0));
  const falta = r2(total - pago);
  const troco = falta < 0 && pags.some((p) => p.forma === 'dinheiro') ? -falta : 0;
  const set = (k, c) => (e) => setPags((l) => l.map((x, j) => (j === k ? { ...x, [c]: e.target.value } : x)));

  async function concluir() {
    if (falta > 0) return avisar(`Faltam ${moeda(falta)}.`, 'erro');
    if (pags.some((p) => p.forma === 'dinheiro' && String(p.recebido || '').trim() && num(p.recebido) < num(p.valor))) {
      return avisar('O dinheiro recebido é menor que o valor em dinheiro: corrija o recebido ou divida o restante em outra forma.', 'erro');
    }
    if (pags.some((p) => p.forma === 'crediario') && !cliente) return avisar('Crediário exige cliente: escolha o cliente ao lado.', 'erro');
    if (nfe && !cliente) return avisar('NF-e exige cliente cadastrado: escolha o cliente ao lado (com CPF/CNPJ e endereço).', 'erro');
    if (num(frete) < 0) return avisar('Frete inválido.', 'erro');
    if (num(frete) > 0 && !cliente) return avisar('Venda com frete precisa do cliente cadastrado: a nota de entrega leva o CPF/CNPJ e o endereço dele.', 'erro');
    if (descPerc > Number(op.desconto_maximo) + 0.001) return avisar(`Desconto acima do máximo de ${numero(op.desconto_maximo)}% para ${op.nome}.`, 'erro');
    setEnviando(true);
    try {
      const pagamentos = pags.filter((p) => efetivo(p) > 0).map((p) => ({ forma: p.forma, valor: efetivo(p),
        ...(p.forma === 'crediario' ? { parcelas: Number(p.parcelas) || 1, primeiro_vencimento: p.primeiro_vencimento } : {}) }));
      const extra = { frete: num(frete), endereco_entrega: endereco.trim() || undefined, documento_fiscal: docFiscal };
      const r = await enviar({ pagamentos, cpf: nfe ? undefined : cpf.replace(/\D/g, '') || undefined, ...extra });
      aoConcluir(r, pagamentos, { frete: extra.frete, endereco: extra.endereco_entrega, documento_fiscal: docFiscal });
    } catch (e) { avisar(e.message, 'erro'); setEnviando(false); }
  }

  return (
    <Modal aberto largo titulo={`Pagamento — total ${moeda(total)}`} aoFechar={enviando ? () => {} : aoFechar}
      rodape={<>
        <button type="button" className="btn btn-sec" onClick={aoFechar} disabled={enviando}>Voltar</button>
        <button type="button" className="btn btn-pri" onClick={concluir} disabled={enviando || falta > 0}>{enviando ? `Finalizando e emitindo ${nfe ? 'NF-e' : 'NFC-e'}…` : 'Concluir venda'}</button>
      </>}>
      <div className="pdv-documento" role="radiogroup" aria-label="Documento fiscal">
        <label className={`pdv-doc${!nfe ? ' ativo' : ''}`}><input type="radio" name="docfiscal" checked={!nfe} onChange={() => setDocFiscal('nfce')} />
          <span><strong>NFC-e</strong><small>cupom na térmica (padrão)</small></span></label>
        <label className={`pdv-doc${nfe ? ' ativo' : ''}`}><input type="radio" name="docfiscal" checked={nfe} onChange={() => setDocFiscal('nfe')} />
          <span><strong>NF-e</strong><small>DANFE em folha A4 (empresa, entrega, garantia)</small></span></label>
      </div>
      {nfe && !cliente && <Aviso tipo="erro">NF-e precisa do cliente cadastrado com CPF/CNPJ e endereço completo: volte e escolha o cliente.</Aviso>}
      {nfe && cliente && <Aviso>A NF-e sai para <strong>{cliente.nome}</strong> com o endereço do cadastro. Se faltar algo, corrija em Clientes → Editar cadastro.</Aviso>}
      <div className="filtros">
        <Campo rotulo={`Desconto em R$ (máx. ${numero(op.desconto_maximo)}%)`}>
          <input inputMode="decimal" value={descGeral} onChange={(e) => setDescGeral(e.target.value)} placeholder="0,00" />
        </Campo>
        <Campo rotulo="Frete (R$)"><input inputMode="decimal" value={frete} onChange={(e) => setFrete(e.target.value)} placeholder="0,00" /></Campo>
        <Campo rotulo="Endereço de entrega (opcional)" largo>
          <input value={endereco} onChange={(e) => setEndereco(e.target.value)} maxLength={300} placeholder="Rua, número, bairro, cidade, referência" />
        </Campo>
      </div>
      {descPerc > Number(op.desconto_maximo) + 0.001 && <Aviso tipo="erro">Desconto de {numero(descPerc.toFixed(2))}% acima do permitido para {op.nome}.</Aviso>}
      {num(frete) > 0 && !cliente && <Aviso tipo="erro">Com frete, escolha o cliente cadastrado: a SEFAZ exige o CPF/CNPJ e o endereço dele na nota de entrega.</Aviso>}
      {num(frete) > 0 && cliente && !nfe && <p className="texto-fraco">Com frete, a NFC-e sai como entrega a domicílio para o endereço do cadastro de {cliente.nome}; o frete soma no total.</p>}
      <h3 className="pdv-subtitulo">Pagamento</h3>
      {pags.map((p, k) => (
        <div key={k} className="filtros">
          <Campo rotulo="Forma"><select value={p.forma} onChange={set(k, 'forma')}>{FORMAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></Campo>
          <Campo rotulo="Valor"><input inputMode="decimal" value={p.valor} onChange={set(k, 'valor')} autoFocus={k === 0 && p.forma !== 'dinheiro'} /></Campo>
          {p.forma === 'dinheiro' && <>
            <Campo rotulo="Dinheiro recebido (R$)">
              <input className="pdv-recebido" inputMode="decimal" value={p.recebido || ''} onChange={set(k, 'recebido')} placeholder="0,00" autoFocus={k === 0} />
            </Campo>
            {num(p.recebido) > 0 && (num(p.recebido) >= num(p.valor)
              ? <div className="pdv-troco-linha"><span>Troco</span><strong>{moeda(r2(num(p.recebido) - num(p.valor)))}</strong></div>
              : <div className="pdv-troco-linha falta"><span>Faltam</span><strong>{moeda(r2(num(p.valor) - num(p.recebido)))}</strong></div>)}
          </>}
          {p.forma === 'crediario' && <>
            <Campo rotulo="Parcelas"><select value={p.parcelas} onChange={set(k, 'parcelas')}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}x</option>)}</select></Campo>
            <Campo rotulo="1º vencimento"><input type="date" value={p.primeiro_vencimento} onChange={set(k, 'primeiro_vencimento')} /></Campo>
          </>}
          {pags.length > 1 && <button type="button" className="btn btn-sec btn-peq" onClick={() => setPags((l) => l.filter((_, j) => j !== k))}>Remover</button>}
        </div>
      ))}
      <button type="button" className="btn btn-sec btn-peq" onClick={() => setPags((l) => [...l, { forma: 'pix', valor: falta > 0 ? String(falta.toFixed(2)).replace('.', ',') : '', parcelas: '1', primeiro_vencimento: somarDias(hoje(), 30) }])}>
        + dividir em outra forma</button>
      {!nfe && <Campo rotulo="CPF/CNPJ na nota (opcional)"><input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" /></Campo>}
      <div className="pdv-totais">
        {num(frete) > 0 && <div><span>Produtos{num(descGeral) > 0 ? ' (com desconto)' : ''}</span><strong>{moeda(totalItens)}</strong></div>}
        {num(frete) > 0 && <div><span>Frete</span><strong>{moeda(num(frete))}</strong></div>}
      </div>
      <div className="pdv-valores">
        <div className="pdv-valor v-total"><span>Total</span><strong>{moeda(total)}</strong></div>
        <div className="pdv-valor v-recebido"><span>Recebido</span><strong>{moeda(pago)}</strong></div>
        {falta > 0 && <div className="pdv-valor v-falta"><span>Falta</span><strong>{moeda(falta)}</strong></div>}
        {troco > 0 && <div className="pdv-valor v-troco"><span>Troco</span><strong>{moeda(troco)}</strong></div>}
      </div>
      <p className="texto-fraco">Cartão: passe na maquininha e confirme aqui. A venda é registrada no caixa e a {nfe ? 'NF-e' : 'NFC-e'} é emitida em seguida.</p>
    </Modal>
  );
}

function ResultadoVenda({ r, op, cliente, descGeral, aoNova }) {
  const avisar = useAvisar();
  const [nota, setNota] = useState(r.nota || null);
  const [erroNfce, setErroNfce] = useState(r.erro_nfce || (r.nota && r.nota.status !== 'autorizada' ? r.nota.motivo : null));
  const [tentando, setTentando] = useState(false);
  const autorizada = nota?.status === 'autorizada';
  const ehNfe = r.documento_fiscal === 'nfe';
  const sigla = ehNfe ? 'NF-e' : 'NFC-e';
  const comprovante = () => imprimirHtml(htmlComprovante({ venda_id: r.venda_id, itens: r.itens, pagamentos: r.pagamentos, desconto_geral: descGeral,
    frete: r.frete, endereco: r.endereco, total: r.total, troco: r.troco, operador: op.nome, cliente: cliente?.nome, nota }), { titulo: `Venda ${r.venda_id}` });
  const danfce = () => imprimirNota(nota.id).catch((e) => avisar(`Impressão: ${e.message}`, 'erro'));
  const salvar = (tipo) => salvarArquivoNota(nota.id, tipo).catch((e) => avisar(`Salvar: ${e.message}`, 'erro'));
  const [zap, setZap] = useState(null); // { fone } enquanto o formulário do WhatsApp está aberto
  const [abrindoZap, setAbrindoZap] = useState(false);
  async function abrirZap() {
    let fone = '';
    if (cliente?.id) {
      const { data } = await supabase.from('clientes').select('celular, celular_cobranca, telefone').eq('id', cliente.id).maybeSingle();
      fone = data?.celular || data?.celular_cobranca || data?.telefone || '';
    }
    setZap({ fone });
  }
  async function enviarZap() {
    let d = String(zap.fone || '').replace(/D/g, '');
    if (d.length === 10 || d.length === 11) d = `55${d}`;
    if (d.length < 12) return avisar('Informe o celular com DDD.', 'erro');
    setAbrindoZap(true);
    try {
      const l = await api('fiscal', { corpo: { acao: 'link', id: nota.id } });
      const nome = (cliente?.nome || '').split(' ')[0];
      const msg = `Olá${nome ? ` ${nome.charAt(0)}${nome.slice(1).toLowerCase()}` : ''}! Segue a NF-e nº ${nota.numero} da Ponto Certo Ferragens, no valor de ${moeda(r.total)}.

`
        + `DANFE (PDF): ${l.danfe}
XML: ${l.xml}

Os links valem por ${l.dias} dias. Obrigado pela preferência!`;
      window.open(`https://wa.me/${d}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
      setZap(null);
    } catch (e) { avisar(`WhatsApp: ${e.message}`, 'erro'); }
    setAbrindoZap(false);
  }

  useEffect(() => { if (autorizada && acaoAposEmitir(ehNfe ? 55 : 65) === 'automatico') danfce(); }, []);

  async function tentarDeNovo() {
    setTentando(true);
    try {
      const x = await api('pdv', { corpo: { acao: 'emitir_nfce', venda_id: r.venda_id } });
      setNota(x.nota);
      setErroNfce(x.nota.status === 'autorizada' ? null : x.nota.motivo);
    } catch (e) { setErroNfce(e.message); }
    setTentando(false);
  }

  return (
    <Modal aberto titulo={`Venda ${r.venda_id} concluída`} aoFechar={aoNova}
      rodape={<>
        <button type="button" className="btn btn-sec" onClick={comprovante}>Imprimir comprovante</button>
        {autorizada && <button type="button" className="btn btn-sec" onClick={danfce}>{ehNfe ? 'Imprimir DANFE (A4)' : 'Imprimir nota (DANFCE)'}</button>}
        <button type="button" className="btn btn-pri" autoFocus onClick={aoNova}>Nova venda</button>
      </>}>
      <div className="pdv-valores">
        <div className="pdv-valor v-total"><span>Total</span><strong>{moeda(r.total)}</strong></div>
        {r.troco > 0 && <div className="pdv-valor v-troco"><span>Troco</span><strong>{moeda(r.troco)}</strong></div>}
      </div>
      {autorizada && <Aviso tipo="ok">{sigla} {nota.serie}/{nota.numero} autorizada pela SEFAZ{nota.ambiente === 'homologacao' ? ' (homologação, sem valor fiscal)' : ''}.</Aviso>}
      {autorizada && ehNfe && (
        <div className="pdv-nfe-acoes">
          <button type="button" className="btn btn-sec" onClick={() => salvar('danfe')}>Salvar PDF (DANFE)</button>
          <button type="button" className="btn btn-sec" onClick={() => salvar('xml')}>Salvar XML</button>
          <button type="button" className="btn btn-zap" onClick={abrirZap}>Enviar por WhatsApp</button>
        </div>
      )}
      {zap && (
        <div className="pdv-zap">
          <Campo rotulo="Celular do cliente (com DDD)"><input inputMode="tel" value={zap.fone} autoFocus onChange={(e) => setZap({ fone: e.target.value })} placeholder="(54) 99999-9999" /></Campo>
          <button type="button" className="btn btn-zap" onClick={enviarZap} disabled={abrindoZap}>{abrindoZap ? 'Gerando link…' : 'Abrir WhatsApp'}</button>
          <button type="button" className="btn btn-sec btn-peq" onClick={() => setZap(null)}>Cancelar</button>
          <p className="texto-fraco">Abre o WhatsApp com a mensagem pronta e os links do PDF e do XML (válidos por 60 dias). Confira e aperte enviar.</p>
        </div>
      )}
      {!autorizada && (
        <Aviso tipo="erro">A venda foi gravada e está no caixa, mas a {sigla} não foi autorizada: {erroNfce || 'sem resposta'}.{' '}
          {ehNfe && 'Se for cadastro do cliente (endereço, CPF/CNPJ, IE), corrija em Clientes e tente de novo. '}
          <button type="button" className="btn btn-sec btn-peq" onClick={tentarDeNovo} disabled={tentando}>{tentando ? 'Emitindo…' : `Emitir ${sigla} de novo`}</button></Aviso>
      )}
    </Modal>
  );
}

// Contador de pré-vendas aguardando o caixa (atualiza a cada 20 s).
function BotaoPreVendas({ aoAbrir }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let vivo = true;
    const contar = async () => {
      const { count } = await supabase.from('orcamentos').select('id', { count: 'exact', head: true }).eq('tipo', 'prevenda').eq('status', 'aberto')
        .gte('data', somarDias(hoje(), -30));
      if (vivo) setN(count || 0);
    };
    contar().catch(() => {});
    const t = setInterval(() => contar().catch(() => {}), 20000);
    return () => { vivo = false; clearInterval(t); };
  }, []);
  return <button type="button" className={`btn btn-peq ${n ? 'btn-pri' : 'btn-sec'}`} onClick={aoAbrir}>Pré-vendas{n ? ` (${n})` : ''}</button>;
}
