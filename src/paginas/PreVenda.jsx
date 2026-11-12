import { useEffect, useRef, useState } from 'react';
import { supabase, api, ou } from '../lib/supabase.js';
import { moeda, numero, hoje, somarDias } from '../lib/formato.js';
import { iniciarLeitor } from '../lib/camera.js';
import { Pagina, Campo, Aviso, Etiqueta, Modal, useConsulta, useAtrasado, useAvisar } from '../componentes/ui.jsx';
import { Desbloqueio } from './PDV.jsx';

// Pré-venda pelo celular: o vendedor atende, lê os códigos de barras pela câmera e manda para o caixa com o nome
// do cliente. O caixa abre a pré-venda no PDV (botão "Pré-vendas") e recebe; só lá a venda é gravada e a NFC-e emitida.
// O rascunho fica no aparelho (localStorage) para não perder o atendimento se a página recarregar.
const RASCUNHO = 'pc-prevenda-rascunho';
const num = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const lerRascunho = () => { try { return JSON.parse(localStorage.getItem(RASCUNHO) || 'null') || { nome: '', cliente: null, itens: [] }; } catch { return { nome: '', cliente: null, itens: [] }; } };
const gravarRascunho = (r) => { try { localStorage.setItem(RASCUNHO, JSON.stringify(r)); } catch { /* sem armazenamento: segue sem rascunho */ } };
const CAMPOS_PRODUTO = 'id, nome, preco_venda, estoque, codigo_barras, unidade';

export default function PreVenda() {
  const [op, setOp] = useState(null);
  return (
    <Pagina titulo="Pré-venda" subtitulo="Atendimento pelo celular — o cliente paga no caixa"
      acoes={op && <span className="pdv-operador"><strong>{op.nome}</strong>
        <button type="button" className="btn btn-sec btn-peq" onClick={() => setOp(null)}>Sair</button></span>}>
      {!op ? <Desbloqueio aoLiberar={setOp} /> : <Atendimento op={op} />}
    </Pagina>
  );
}

function Atendimento({ op }) {
  const avisar = useAvisar();
  const [r, setR] = useState(lerRascunho);
  const [lendo, setLendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enviada, setEnviada] = useState(null);
  const [verAbertas, setVerAbertas] = useState(false);
  useEffect(() => gravarRascunho(r), [r]);

  const itens = r.itens;
  const total = r2(itens.reduce((s, i) => s + num(i.quantidade) * Number(i.preco_venda), 0));
  const mudarQtd = (k, delta) => setR((x) => ({ ...x, itens: x.itens.map((i, j) => (j === k ? { ...i, quantidade: Math.max(0, r2(num(i.quantidade) + delta)) } : i)).filter((i) => num(i.quantidade) > 0) }));
  const definirQtd = (k, v) => setR((x) => ({ ...x, itens: x.itens.map((i, j) => (j === k ? { ...i, quantidade: v } : i)) }));

  function adicionar(p, qtd = 1) {
    setR((x) => {
      const k = x.itens.findIndex((i) => i.id === p.id);
      if (k >= 0) return { ...x, itens: x.itens.map((i, j) => (j === k ? { ...i, quantidade: r2(num(i.quantidade) + qtd) } : i)) };
      return { ...x, itens: [{ id: p.id, nome: p.nome, preco_venda: Number(p.preco_venda), estoque: p.estoque, unidade: p.unidade, quantidade: qtd }, ...x.itens] };
    });
  }

  // código lido pela câmera (ou digitado): procura pelo código de barras e, se não achar, pelo código interno
  async function porCodigo(codigo) {
    const c = String(codigo).trim();
    let p = /^\d{8,14}$/.test(c) ? ou(await supabase.from('produtos').select(CAMPOS_PRODUTO).eq('ativo', true).eq('codigo_barras', c).limit(1)).data[0] : null;
    if (!p && /^\d{1,7}$/.test(c)) p = ou(await supabase.from('produtos').select(CAMPOS_PRODUTO).eq('ativo', true).eq('id', Number(c)).limit(1)).data[0];
    if (!p) { avisar(`Código ${c} não cadastrado.`, 'erro'); navigator.vibrate?.([60, 60, 60]); return null; }
    adicionar(p);
    return p;
  }

  async function enviar() {
    const nome = (r.cliente?.nome || r.nome).trim();
    if (!nome) return avisar('Informe o nome do cliente.', 'erro');
    if (!itens.length) return avisar('Nenhum produto na pré-venda.', 'erro');
    setEnviando(true);
    try {
      const res = await api('pdv', { corpo: { acao: 'orcamento_salvar', tipo: 'prevenda', codigo: op.codigo, cliente_id: r.cliente?.id, cliente_nome: nome,
        itens: itens.map((i) => ({ produto_id: i.id, quantidade: num(i.quantidade), preco_unitario: Number(i.preco_venda), desconto: 0 })) } });
      setEnviada({ id: res.id, nome: nome.toUpperCase(), total });
      setR({ nome: '', cliente: null, itens: [] });
    } catch (e) { avisar(e.message, 'erro'); }
    setEnviando(false);
  }

  if (enviada) {
    return (
      <div className="pv-enviada">
        <span className="pv-ok" aria-hidden="true">✓</span>
        <h2>Pré-venda {enviada.id} enviada ao caixa</h2>
        <p className="pv-cliente">{enviada.nome}</p>
        <p className="pv-total">{moeda(enviada.total)}</p>
        <p className="texto-fraco">Peça ao cliente para ir ao caixa e dizer o nome.</p>
        <button type="button" className="btn btn-pri pv-grande" onClick={() => setEnviada(null)}>Nova pré-venda</button>
      </div>
    );
  }

  return (
    <div className="pv">
      <ClientePreVenda r={r} setR={setR} />

      <div className="pv-acoes">
        <button type="button" className="btn btn-pri pv-grande" onClick={() => setLendo(true)}>📷 Ler código de barras</button>
      </div>
      <BuscaManual aoEscolher={(p) => adicionar(p)} aoCodigo={porCodigo} />

      {itens.length === 0 ? <Aviso>Leia o código de barras dos produtos ou procure pelo nome.</Aviso> : (
        <ul className="pv-itens">
          {itens.map((i, k) => (
            <li key={i.id}>
              <div className="pv-item-nome"><span className="cod">{i.id}</span> {i.nome}
                {num(i.quantidade) > Number(i.estoque ?? 0) && <Etiqueta tipo="erro">estoque {numero(i.estoque)}</Etiqueta>}</div>
              <div className="pv-item-linha">
                <div className="pv-qtd">
                  <button type="button" aria-label="Menos" onClick={() => mudarQtd(k, -1)}>−</button>
                  <input inputMode="decimal" value={String(i.quantidade).replace('.', ',')} aria-label="Quantidade"
                    onChange={(e) => definirQtd(k, e.target.value)} onBlur={() => definirQtd(k, Math.max(0, num(i.quantidade)) || 1)} />
                  <button type="button" aria-label="Mais" onClick={() => mudarQtd(k, 1)}>+</button>
                </div>
                <span className="texto-fraco">{moeda(i.preco_venda)}</span>
                <strong>{moeda(num(i.quantidade) * i.preco_venda)}</strong>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="pv-rodape">
        <div><span className="texto-fraco">{itens.length} {itens.length === 1 ? 'item' : 'itens'}</span><strong className="pv-total-barra">{moeda(total)}</strong></div>
        <button type="button" className="btn btn-pri pv-grande" disabled={enviando || !itens.length} onClick={enviar}>{enviando ? 'Enviando…' : 'Enviar para o caixa'}</button>
      </div>
      <div className="pv-links">
        {itens.length > 0 && <button type="button" className="btn btn-sec btn-peq" onClick={() => setR({ nome: '', cliente: null, itens: [] })}>Limpar</button>}
        <button type="button" className="btn btn-sec btn-peq" onClick={() => setVerAbertas(true)}>Pré-vendas abertas</button>
      </div>

      {lendo && <LeitorCamera aoLer={porCodigo} aoFechar={() => setLendo(false)} />}
      {verAbertas && <PreVendasAbertas op={op} aoFechar={() => setVerAbertas(false)} />}
    </div>
  );
}

function ClientePreVenda({ r, setR }) {
  const busca = useAtrasado(r.nome);
  const [focado, setFocado] = useState(false);
  const sug = useConsulta(async () => {
    if (r.cliente || busca.trim().length < 3) return { dados: [] };
    let q = supabase.from('clientes').select('id, nome, cidades(nome, uf)').eq('ativo', true);
    for (const parte of busca.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(Boolean)) q = q.ilike('busca', `%${parte.replace(/[%_]/g, '')}%`);
    return { dados: ou(await q.order('nome').limit(6)).data };
  }, [busca, r.cliente]);
  if (r.cliente) {
    return (
      <div className="resumo-linha">
        <span>Cliente: <strong>{r.cliente.nome}</strong> <span className="texto-fraco">(cadastrado)</span></span>
        <button type="button" className="btn btn-sec btn-peq" onClick={() => setR((x) => ({ ...x, cliente: null, nome: '' }))}>Trocar</button>
      </div>
    );
  }
  return (
    <div className="busca-produto">
      <Campo rotulo="Nome do cliente *" largo>
        <input value={r.nome} onChange={(e) => setR((x) => ({ ...x, nome: e.target.value }))} onFocus={() => setFocado(true)}
          onBlur={() => setTimeout(() => setFocado(false), 200)} placeholder="Como o cliente vai se identificar no caixa" autoCapitalize="characters" />
      </Campo>
      {focado && (sug.dados || []).length > 0 && (
        <ul className="lista-escolha">
          {sug.dados.map((c) => <li key={c.id}><button type="button" onClick={() => setR((x) => ({ ...x, cliente: { id: c.id, nome: c.nome } }))}>
            {c.nome} {c.cidades && <span className="texto-fraco">({c.cidades.nome}/{c.cidades.uf})</span>}</button></li>)}
        </ul>
      )}
    </div>
  );
}

function BuscaManual({ aoEscolher, aoCodigo }) {
  const [termo, setTermo] = useState('');
  const busca = useAtrasado(termo);
  const r = useConsulta(async () => {
    const t = busca.trim();
    if (t.length < 3 || /^\d+$/.test(t)) return { dados: [] };
    let q = supabase.from('produtos').select(CAMPOS_PRODUTO).eq('ativo', true);
    for (const parte of t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/)) q = q.ilike('busca', `%${parte.replace(/[%_]/g, '')}%`);
    return { dados: ou(await q.order('nome').limit(15)).data };
  }, [busca]);
  return (
    <form className="busca-produto" onSubmit={async (e) => { e.preventDefault(); if (/^\d+$/.test(termo.trim()) && await aoCodigo(termo)) setTermo(''); }}>
      <Campo rotulo="Ou procure: nome, código ou código de barras" largo>
        <input type="search" value={termo} onChange={(e) => setTermo(e.target.value)} enterKeyHint="search" />
      </Campo>
      {(r.dados || []).length > 0 && (
        <ul className="lista-escolha">
          {r.dados.map((p) => <li key={p.id}><button type="button" onClick={() => { aoEscolher(p); setTermo(''); }}>
            <span className="cod">{p.id}</span> {p.nome} — <strong>{moeda(p.preco_venda)}</strong></button></li>)}
        </ul>
      )}
    </form>
  );
}

export function LeitorCamera({ aoLer, aoFechar }) {
  const video = useRef(null);
  const [erro, setErro] = useState('');
  const [ultimo, setUltimo] = useState(null);
  const [contagem, setContagem] = useState(0);
  const lerRef = useRef(aoLer);
  lerRef.current = aoLer;
  useEffect(() => {
    let parar = null; let vivo = true;
    iniciarLeitor(video.current, async (codigo) => {
      const p = await lerRef.current(codigo);
      if (vivo && p) { setUltimo(p); setContagem((n) => n + 1); }
    }).then((f) => { if (vivo) parar = f; else f(); }).catch((e) => setErro(e.message));
    return () => { vivo = false; parar?.(); };
  }, []);
  return (
    <div className="pv-camera" role="dialog" aria-label="Leitor de código de barras">
      <video ref={video} playsInline muted />
      <div className="pv-mira" aria-hidden="true" />
      <div className="pv-camera-info">
        {erro ? <Aviso tipo="erro">{erro}</Aviso>
          : ultimo ? <span>✓ {ultimo.texto || `${ultimo.nome} — ${moeda(ultimo.preco_venda)}`} <span className="texto-fraco">({contagem} lido{contagem > 1 ? 's' : ''})</span></span>
            : <span>Aponte para o código de barras</span>}
        <button type="button" className="btn btn-pri pv-grande" onClick={aoFechar}>Concluir leitura</button>
      </div>
    </div>
  );
}

/** Lista das pré-vendas em aberto (celular: o vendedor confere/cancela; PDV: o caixa escolhe qual receber). */
export function PreVendasAbertas({ op, aoFechar, aoEscolher }) {
  const avisar = useAvisar();
  const [versao, setVersao] = useState(0);
  const [confirmar, setConfirmar] = useState(null);
  const lista = useConsulta(async () => ({
    dados: ou(await supabase.from('orcamentos').select('id, data, hora, cliente_nome, total, operadores(nome)')
      .eq('tipo', 'prevenda').eq('status', 'aberto').gte('data', somarDias(hoje(), -30)).order('data', { ascending: false }).order('id', { ascending: false }).limit(50)).data,
  }), [versao]);
  useEffect(() => { const t = setInterval(() => setVersao((v) => v + 1), 15000); return () => clearInterval(t); }, []);
  async function cancelar(id) {
    try { await api('pdv', { corpo: { acao: 'orcamento_cancelar', codigo: op.codigo, id } }); avisar(`Pré-venda ${id} cancelada.`); setVersao((v) => v + 1); }
    catch (e) { avisar(e.message, 'erro'); }
  }
  return (
    <Modal aberto largo titulo="Pré-vendas aguardando o caixa" aoFechar={aoFechar}>
      {lista.carregando && !lista.dados ? <p>Carregando…</p> : !(lista.dados || []).length ? <Aviso>Nenhuma pré-venda em aberto.</Aviso> : (
        <ul className="pv-abertas">
          {lista.dados.map((o) => (
            <li key={o.id}>
              <div>
                <strong>{o.cliente_nome}</strong>
                <span className="texto-fraco"> Nº {o.id} · {o.data !== hoje() ? `${o.data.split('-').reverse().slice(0, 2).join('/')} ` : ''}{String(o.hora || '').slice(0, 5)} · {o.operadores?.nome || ''}</span>
              </div>
              <strong>{moeda(o.total)}</strong>
              {aoEscolher
                ? <button type="button" className="btn btn-pri btn-peq" onClick={() => aoEscolher(o)}>Receber</button>
                : confirmar === o.id
                  ? <button type="button" className="btn btn-perigo btn-peq" onClick={() => { setConfirmar(null); cancelar(o.id); }}>Confirmar cancelamento</button>
                  : <button type="button" className="btn btn-sec btn-peq" onClick={() => setConfirmar(o.id)}>Cancelar</button>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
