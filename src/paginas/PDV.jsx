import { useEffect, useRef, useState } from 'react';
import { supabase, api, ou } from '../lib/supabase.js';
import { moeda, numero, documento, hoje, somarDias } from '../lib/formato.js';
import { navegar } from '../lib/contexto.js';
import { imprimirNota, imprimirHtml, acaoAposEmitir } from '../lib/impressao.js';
import { htmlComprovante, htmlOrcamento } from '../lib/documentos.js';
import { Pagina, Campo, Tabela, Modal, Aviso, Etiqueta, useAvisar } from '../componentes/ui.jsx';
import { BuscaCliente } from './NotasFiscais.jsx';

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
  const titulo = modo === 'orcamento' ? (params.editar ? `Orçamento ${params.editar}` : 'Novo orçamento') : orcamentoId ? `Venda do orçamento ${orcamentoId}` : 'Nova venda';
  return (
    <Pagina titulo={titulo} subtitulo={modo === 'orcamento' ? 'Orçamento para o cliente (não baixa estoque)' : 'PDV — venda no balcão com NFC-e'}
      acoes={op && <span className="pdv-operador">Operador: <strong>{op.nome}</strong>
        <button type="button" className="btn btn-sec btn-peq" onClick={() => setOp(null)}>Trocar / bloquear</button></span>}>
      {!op ? <Desbloqueio aoLiberar={setOp} /> : (
        <Carrinho key={`${modo}-${orcamentoId}-${params.editar}`} op={op} modo={modo} orcamentoId={orcamentoId} editarId={params.editar ? Number(params.editar) : null}
          aoBloquear={() => setOp(null)} />
      )}
    </Pagina>
  );
}

function Desbloqueio({ aoLiberar }) {
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
      <h2>Digite o código do operador</h2>
      <input ref={campo} className="pdv-codigo" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={codigo}
        onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); setCodigo(v); setErro(''); }}
        onKeyUp={(e) => { if (e.key !== 'Enter' && codigo.length === 4 && !conferindo) liberar(); }} aria-label="Código do operador" />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <button type="submit" className="btn btn-pri" disabled={conferindo}>{conferindo ? 'Conferindo…' : 'Liberar'}</button>
      <p className="texto-fraco">Os códigos são cadastrados pelo administrador em Sistema → Operadores.</p>
    </form>
  );
}

function Carrinho({ op, modo, orcamentoId, editarId, aoBloquear }) {
  const avisar = useAvisar();
  const [itens, setItens] = useState([]);
  const [cliente, setCliente] = useState(null);
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
    setItens([]); setCliente(null); setDescGeral(''); setResultado(null); setFinalizando(false);
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
        <Pagamento op={op} total={total} cliente={cliente} aoFechar={() => setFinalizando(false)}
          aoConcluir={(r, pagamentos) => setResultado({ ...r, pagamentos, itens: payloadItens().map((i, k) => ({ ...i, descricao: itens[k].nome })) })}
          enviar={(extra) => api('pdv', { corpo: { acao: 'finalizar', codigo: op.codigo, cliente_id: cliente?.id, orcamento_id: orcamentoId || undefined,
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

function Pagamento({ op, total, cliente, aoFechar, aoConcluir, enviar }) {
  const avisar = useAvisar();
  const [pags, setPags] = useState([{ forma: 'dinheiro', valor: String(total.toFixed(2)).replace('.', ','), parcelas: '1', primeiro_vencimento: somarDias(hoje(), 30) }]);
  const [cpf, setCpf] = useState(cliente?.cpf_cnpj || '');
  const [enviando, setEnviando] = useState(false);
  const pago = r2(pags.reduce((s, p) => s + num(p.valor), 0));
  const falta = r2(total - pago);
  const troco = falta < 0 && pags.some((p) => p.forma === 'dinheiro') ? -falta : 0;
  const set = (k, c) => (e) => setPags((l) => l.map((x, j) => (j === k ? { ...x, [c]: e.target.value } : x)));

  async function concluir() {
    if (falta > 0) return avisar(`Faltam ${moeda(falta)}.`, 'erro');
    if (pags.some((p) => p.forma === 'crediario') && !cliente) return avisar('Crediário exige cliente: escolha o cliente ao lado.', 'erro');
    setEnviando(true);
    try {
      const pagamentos = pags.filter((p) => num(p.valor) > 0).map((p) => ({ forma: p.forma, valor: num(p.valor),
        ...(p.forma === 'crediario' ? { parcelas: Number(p.parcelas) || 1, primeiro_vencimento: p.primeiro_vencimento } : {}) }));
      const r = await enviar({ pagamentos, cpf: cpf.replace(/\D/g, '') || undefined });
      aoConcluir(r, pagamentos);
    } catch (e) { avisar(e.message, 'erro'); setEnviando(false); }
  }

  return (
    <Modal aberto largo titulo={`Pagamento — total ${moeda(total)}`} aoFechar={enviando ? () => {} : aoFechar}
      rodape={<>
        <button type="button" className="btn btn-sec" onClick={aoFechar} disabled={enviando}>Voltar</button>
        <button type="button" className="btn btn-pri" onClick={concluir} disabled={enviando || falta > 0}>{enviando ? 'Finalizando e emitindo NFC-e…' : 'Concluir venda'}</button>
      </>}>
      {pags.map((p, k) => (
        <div key={k} className="filtros">
          <Campo rotulo="Forma"><select value={p.forma} onChange={set(k, 'forma')}>{FORMAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></Campo>
          <Campo rotulo="Valor"><input inputMode="decimal" value={p.valor} onChange={set(k, 'valor')} autoFocus={k === 0} /></Campo>
          {p.forma === 'crediario' && <>
            <Campo rotulo="Parcelas"><select value={p.parcelas} onChange={set(k, 'parcelas')}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}x</option>)}</select></Campo>
            <Campo rotulo="1º vencimento"><input type="date" value={p.primeiro_vencimento} onChange={set(k, 'primeiro_vencimento')} /></Campo>
          </>}
          {pags.length > 1 && <button type="button" className="btn btn-sec btn-peq" onClick={() => setPags((l) => l.filter((_, j) => j !== k))}>Remover</button>}
        </div>
      ))}
      <button type="button" className="btn btn-sec btn-peq" onClick={() => setPags((l) => [...l, { forma: 'pix', valor: falta > 0 ? String(falta.toFixed(2)).replace('.', ',') : '', parcelas: '1', primeiro_vencimento: somarDias(hoje(), 30) }])}>
        + dividir em outra forma</button>
      <Campo rotulo="CPF/CNPJ na nota (opcional)"><input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" /></Campo>
      <div className="pdv-totais">
        <div><span>Pago</span><strong>{moeda(pago)}</strong></div>
        {falta > 0 && <div className="texto-erro"><span>Falta</span><strong>{moeda(falta)}</strong></div>}
        {troco > 0 && <div className="pdv-total"><span>TROCO</span><strong>{moeda(troco)}</strong></div>}
      </div>
      <p className="texto-fraco">Cartão: passe na maquininha e confirme aqui. A venda é registrada no caixa e a NFC-e é emitida em seguida.</p>
    </Modal>
  );
}

function ResultadoVenda({ r, op, cliente, descGeral, aoNova }) {
  const avisar = useAvisar();
  const [nota, setNota] = useState(r.nota || null);
  const [erroNfce, setErroNfce] = useState(r.erro_nfce || (r.nota && r.nota.status !== 'autorizada' ? r.nota.motivo : null));
  const [tentando, setTentando] = useState(false);
  const autorizada = nota?.status === 'autorizada';
  const comprovante = () => imprimirHtml(htmlComprovante({ venda_id: r.venda_id, itens: r.itens, pagamentos: r.pagamentos, desconto_geral: descGeral,
    total: r.total, troco: r.troco, operador: op.nome, cliente: cliente?.nome, nota }), { titulo: `Venda ${r.venda_id}` });
  const danfce = () => imprimirNota(nota.id).catch((e) => avisar(`Impressão: ${e.message}`, 'erro'));

  useEffect(() => { if (autorizada && acaoAposEmitir(65) === 'automatico') danfce(); }, []);

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
        {autorizada && <button type="button" className="btn btn-sec" onClick={danfce}>Imprimir nota (DANFCE)</button>}
        <button type="button" className="btn btn-pri" autoFocus onClick={aoNova}>Nova venda</button>
      </>}>
      <div className="pdv-totais">
        <div><span>Total</span><strong>{moeda(r.total)}</strong></div>
        {r.troco > 0 && <div className="pdv-total"><span>TROCO</span><strong>{moeda(r.troco)}</strong></div>}
      </div>
      {autorizada && <Aviso tipo="ok">NFC-e {nota.serie}/{nota.numero} autorizada pela SEFAZ{nota.ambiente === 'homologacao' ? ' (homologação, sem valor fiscal)' : ''}.</Aviso>}
      {!autorizada && (
        <Aviso tipo="erro">A venda foi gravada e está no caixa, mas a NFC-e não foi autorizada: {erroNfce || 'sem resposta'}.{' '}
          <button type="button" className="btn btn-sec btn-peq" onClick={tentarDeNovo} disabled={tentando}>{tentando ? 'Emitindo…' : 'Emitir NFC-e de novo'}</button></Aviso>
      )}
    </Modal>
  );
}
