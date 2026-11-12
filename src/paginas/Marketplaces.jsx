// Marketplaces (/marketplaces): anúncios da Ponto Certo no Mercado Livre (conta MODERNAMAQUINAS, via ml-estoque do Moderna
// Gestão) ligados aos produtos do ERP. Estoque do anúncio = (estoque − reserva) ÷ quantidade do kit; enviado na hora depois das
// vendas do PDV e pela rotina agendada. Vendas do ML entram no ERP e baixam o estoque. Banco: 022/023; API: api/marketplaces.js.
import { useMemo, useRef, useState } from 'react';
import { supabase, api, ou } from '../lib/supabase.js';
import { moeda, numero, dataHora } from '../lib/formato.js';
import { navegar } from '../lib/contexto.js';
import { Pagina, Campo, Tabela, Modal, Aviso, Etiqueta, useConsulta, useAvisar } from '../componentes/ui.jsx';

const CANAL = 'mercadolivre';
const num = (v) => Number(String(v ?? '').replace(',', '.'));
const STATUS = { active: ['ok', 'ativo'], paused: ['alerta', 'pausado'], under_review: ['alerta', 'em revisão'], closed: ['neutra', 'finalizado'] };

function Vincular({ anuncio, aoFechar, aoSalvar }) {
  const avisar = useAvisar();
  const [termo, setTermo] = useState(anuncio.gtin || '');
  const [lista, setLista] = useState([]);
  const [qtd, setQtd] = useState('1');
  const t = useRef(null);
  function buscar(v) {
    setTermo(v);
    clearTimeout(t.current);
    t.current = setTimeout(async () => {
      const x = v.trim();
      if (x.length < 2) { setLista([]); return; }
      let q = supabase.from('produtos').select('id, nome, estoque, codigo_barras, unidade, ativo');
      if (/^\d{8,14}$/.test(x)) q = q.eq('codigo_barras', x);
      else if (/^\d{1,7}$/.test(x)) q = q.eq('id', Number(x));
      else for (const p of x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/)) q = q.ilike('busca', `%${p.replace(/[%_]/g, '')}%`);
      setLista(ou(await q.order('ativo', { ascending: false }).order('nome').limit(20)).data);
    }, 250);
  }
  async function escolher(p) {
    if (!(num(qtd) > 0)) return avisar('Quantidade por venda inválida.', 'erro');
    try {
      ou(await supabase.from('marketplace_composicao').upsert({ canal: CANAL, anuncio_id: anuncio.anuncio_id, produto_id: p.id, quantidade: num(qtd) }));
      aoSalvar();
    } catch (e) { avisar(e.message, 'erro'); }
  }
  return (
    <Modal aberto largo titulo={`Vincular: ${anuncio.titulo}`} aoFechar={aoFechar}>
      <p className="texto-fraco">Cada venda deste anúncio baixa a quantidade abaixo do produto escolhido. Kit com produtos diferentes: vincule cada um.</p>
      <div className="filtros">
        <Campo rotulo="Produto (nome, código ou código de barras)" largo><input autoFocus value={termo} onChange={(e) => buscar(e.target.value)} onFocus={() => termo && buscar(termo)} /></Campo>
        <Campo rotulo="Quantidade por venda (kit de 2 = 2)"><input className="input-peq" inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} /></Campo>
      </div>
      <ul className="fiscal-lista">
        {lista.map((p) => (
          <li key={p.id}><button type="button" onClick={() => escolher(p)}><strong>{p.id}</strong>
            <span>{p.nome} — estoque {numero(p.estoque)} {p.unidade}{p.codigo_barras ? ` · ${p.codigo_barras}` : ''}{!p.ativo && ' · INATIVO'}</span></button></li>
        ))}
      </ul>
    </Modal>
  );
}

function Anuncios({ cfg, aoMudar }) {
  const avisar = useAvisar();
  const [filtro, setFiltro] = useState('todos');
  const [vinc, setVinc] = useState(null);
  const [versao, setVersao] = useState(0);
  const lista = useConsulta(async () => ({ dados: ou(await supabase.from('marketplace_anuncios')
    .select('*, marketplace_composicao(produto_id, quantidade, produtos(nome, estoque))').eq('canal', CANAL).order('status').order('titulo')).data }), [versao]);
  const recarregar = () => setVersao((v) => v + 1);
  const calc = (a) => {
    const comp = a.marketplace_composicao || [];
    if (!comp.length) return null;
    const reserva = a.reserva ?? Number(cfg.reserva_padrao);
    return Math.max(Math.min(...comp.map((c) => Math.floor((Number(c.produtos?.estoque || 0) - reserva) / Number(c.quantidade)))), 0);
  };
  const linhas = useMemo(() => (lista.dados || []).filter((a) => {
    const vinculado = (a.marketplace_composicao || []).length > 0;
    if (filtro === 'sem_vinculo') return !vinculado;
    if (filtro === 'vinculados') return vinculado;
    if (filtro === 'erro') return Boolean(a.erro);
    if (filtro === 'diferente') return vinculado && calc(a) !== Number(a.estoque_canal);
    return true;
  }), [lista.dados, filtro, cfg]);
  const semVinculo = (lista.dados || []).filter((a) => !(a.marketplace_composicao || []).length).length;

  async function alterar(a, campos) {
    try { ou(await supabase.from('marketplace_anuncios').update(campos).eq('canal', CANAL).eq('anuncio_id', a.anuncio_id)); recarregar(); } catch (e) { avisar(e.message, 'erro'); }
  }
  async function desvincular(a, produtoId) {
    try { ou(await supabase.from('marketplace_composicao').delete().eq('canal', CANAL).eq('anuncio_id', a.anuncio_id).eq('produto_id', produtoId)); recarregar(); } catch (e) { avisar(e.message, 'erro'); }
  }
  return (
    <>
      <div className="abas" role="tablist">
        {[['todos', `Todos (${(lista.dados || []).length})`], ['sem_vinculo', `Sem vínculo (${semVinculo})`], ['vinculados', 'Vinculados'], ['diferente', 'ML diferente do ERP'], ['erro', 'Com erro']].map(([k, r]) => (
          <button key={k} type="button" role="tab" aria-selected={filtro === k} className={`aba${filtro === k ? ' ativa' : ''}`} onClick={() => setFiltro(k)}>{r}</button>))}
      </div>
      <Tabela chave="anuncio_id" carregando={lista.carregando} erro={lista.erro} linhas={linhas} vazio={'Nenhum anúncio. Clique em "Ler anúncios do ML".'}
        colunas={[
          { titulo: '', render: (a) => (a.foto ? <img className="mk-foto" src={a.foto} alt="" loading="lazy" /> : null) },
          { titulo: 'Anúncio', render: (a) => <>
            <a href={a.link} target="_blank" rel="noopener noreferrer">{a.titulo}</a><br />
            <small className="texto-fraco">{a.anuncio_id}{a.gtin ? ` · GTIN ${a.gtin}` : ''} · {moeda(a.preco)}</small> <Etiqueta tipo={STATUS[a.status]?.[0] || 'neutra'}>{STATUS[a.status]?.[1] || a.status}</Etiqueta></> },
          { titulo: 'Produto(s) no ERP', render: (a) => <>
            {(a.marketplace_composicao || []).map((c) => (
              <div key={c.produto_id} className="mk-comp"><span className="cod">{c.produto_id}</span> {c.produtos?.nome} <small className="texto-fraco">× {numero(c.quantidade)} · estoque {numero(c.produtos?.estoque)}</small>
                <button type="button" className="btn-link" onClick={() => desvincular(a, c.produto_id)}>tirar</button></div>))}
            <button type="button" className="btn btn-sec btn-peq" onClick={() => setVinc(a)}>{(a.marketplace_composicao || []).length ? '+ produto' : 'Vincular'}</button></> },
          { titulo: 'Reserva', render: (a) => <input className="input-peq" inputMode="decimal" defaultValue={a.reserva ?? ''} placeholder={numero(cfg.reserva_padrao)}
            onBlur={(e) => { const v = e.target.value.trim(); const nv = v === '' ? null : num(v); if (nv !== a.reserva && (nv === null || nv >= 0)) alterar(a, { reserva: nv }); }} /> },
          { titulo: 'No ML', alinhar: 'dir', render: (a) => numero(a.estoque_canal) },
          { titulo: 'ERP manda', alinhar: 'dir', render: (a) => { const q = calc(a); return q === null ? '—' : <strong className={q !== Number(a.estoque_canal) ? 'texto-erro' : ''}>{numero(q)}</strong>; } },
          { titulo: 'Sincronizar', render: (a) => <input type="checkbox" checked={a.sincronizar} disabled={!(a.marketplace_composicao || []).length} onChange={(e) => alterar(a, { sincronizar: e.target.checked })} /> },
          { titulo: 'Último envio', render: (a) => <>{a.enviado_em ? dataHora(a.enviado_em) : ''}{a.erro && <><br /><span className="texto-erro">{a.erro}</span></>}{a.sincronizar && a.pendente && <><br /><Etiqueta tipo="info">aguardando envio</Etiqueta></>}</> },
        ]} />
      {vinc && <Vincular anuncio={vinc} aoFechar={() => setVinc(null)} aoSalvar={() => { setVinc(null); recarregar(); aoMudar?.(); }} />}
    </>
  );
}

function Pedidos() {
  const lista = useConsulta(async () => ({ dados: ou(await supabase.from('marketplace_pedidos').select('*').eq('canal', CANAL).order('data', { ascending: false }).limit(200)).data }), []);
  return (
    <Tabela chave="pedido_id" carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} vazio="Nenhum pedido importado ainda."
      aoClicar={(p) => p.venda_id && navegar(`/vendas?numero=${p.venda_id}`)}
      colunas={[
        { titulo: 'Pedido', campo: 'pedido_id', classe: 'cod' }, { titulo: 'Data', render: (p) => dataHora(p.data) },
        { titulo: 'Itens', render: (p) => (p.itens || []).map((i) => `${numero(i.quantidade)}× ${i.titulo}`).join('; ') },
        { titulo: 'Total', alinhar: 'dir', render: (p) => moeda(p.total) },
        { titulo: 'Situação', render: (p) => (p.estornado_em ? <Etiqueta tipo="neutra">cancelado (estoque devolvido)</Etiqueta>
          : p.venda_id ? <Etiqueta tipo="ok">venda {p.venda_id}</Etiqueta> : p.erro ? <Etiqueta tipo="erro">{p.erro}</Etiqueta> : <Etiqueta tipo="alerta">{p.status}</Etiqueta>) },
      ]} />
  );
}

export default function Marketplaces() {
  const avisar = useAvisar();
  const [aba, setAba] = useState('anuncios');
  const [ocupado, setOcupado] = useState('');
  const [versao, setVersao] = useState(0);
  const status = useConsulta(async () => ({ dados: await api('marketplaces', { corpo: { acao: 'status' } }) }), [versao]);
  const cfg = status.dados?.config?.find((c) => c.canal === CANAL);
  async function acao(nome, rotulo, extra = {}) {
    setOcupado(nome);
    try {
      const r = await api('marketplaces', { corpo: { acao: nome, ...extra } });
      if (nome === 'ml_ler_anuncios') avisar(`${r.lidos} anúncios lidos; ${r.vinculados_automaticamente} vinculados automaticamente pelo código de barras.`, 'ok');
      else avisar(`${rotulo}: ${r.pedidos ? `${r.pedidos.registrados ?? 0} venda(s) registrada(s), ` : ''}${r.estoque ? `${r.estoque.enviados} anúncio(s) atualizado(s)${r.estoque.erros ? `, ${r.estoque.erros} com erro` : ''}` : JSON.stringify(r)}`, 'ok');
      setVersao((v) => v + 1);
    } catch (e) { avisar(e.message, 'erro'); }
    setOcupado('');
  }
  async function config(campos) {
    try { ou(await supabase.from('marketplace_config').update(campos).eq('canal', CANAL)); setVersao((v) => v + 1); } catch (e) { avisar(e.message, 'erro'); }
  }
  return (
    <Pagina titulo="Marketplaces" subtitulo="Estoque do ERP nos anúncios e vendas dos canais no ERP"
      acoes={<>
        <button type="button" className="btn btn-sec" disabled={Boolean(ocupado) || !status.dados?.configurado} onClick={() => acao('ml_ler_anuncios')}>{ocupado === 'ml_ler_anuncios' ? 'Lendo…' : 'Ler anúncios do ML'}</button>
        <button type="button" className="btn btn-pri" disabled={Boolean(ocupado) || !status.dados?.configurado} onClick={() => acao('ml_sincronizar', 'Sincronizado')}>{ocupado === 'ml_sincronizar' ? 'Sincronizando…' : 'Sincronizar agora'}</button>
      </>}>
      {status.erro && <Aviso tipo="erro">{status.erro}</Aviso>}
      {status.dados && !status.dados.configurado && <Aviso tipo="alerta">A ligação com o Mercado Livre ainda não foi configurada no servidor (função ml-estoque no Supabase do Moderna Gestão e as variáveis ML_ESTOQUE_URL / ERP_ML_SECRET na Vercel).</Aviso>}
      <div className="abas" role="tablist">
        {[['anuncios', 'Mercado Livre — anúncios'], ['pedidos', 'Mercado Livre — vendas'], ['shopee', 'Shopee']].map(([k, r]) => (
          <button key={k} type="button" role="tab" aria-selected={aba === k} className={`aba${aba === k ? ' ativa' : ''}`} onClick={() => setAba(k)}>{r}</button>))}
      </div>
      {cfg && aba !== 'shopee' && (
        <div className="mk-config">
          <label className="campo-check"><input type="checkbox" checked={cfg.sincronizar}
            onChange={(e) => config(e.target.checked ? { sincronizar: true, importar_vendas: true } : { sincronizar: false })} />
            <span><strong>Enviar o estoque do ERP para os anúncios</strong> (só os marcados em "Sincronizar")</span></label>
          <label className="campo-check"><input type="checkbox" checked={cfg.importar_vendas} disabled={cfg.sincronizar} onChange={(e) => config({ importar_vendas: e.target.checked })} />
            <span><strong>Registrar as vendas do ML no ERP</strong> e baixar o estoque{cfg.sincronizar && ' (obrigatório com o envio ligado, senão o ERP mandaria de volta a quantidade antes da venda)'}</span></label>
          <Campo rotulo="Reserva padrão por anúncio"><input className="input-peq" inputMode="decimal" defaultValue={cfg.reserva_padrao} onBlur={(e) => num(e.target.value) >= 0 && num(e.target.value) !== Number(cfg.reserva_padrao) && config({ reserva_padrao: num(e.target.value) })} /></Campo>
          {cfg.ultimo_pedido_em && <span className="texto-fraco">Pedidos lidos até {dataHora(cfg.ultimo_pedido_em)}</span>}
        </div>
      )}
      {aba === 'anuncios' && cfg && <Anuncios key={versao} cfg={cfg} aoMudar={() => setVersao((v) => v + 1)} />}
      {aba === 'pedidos' && <Pedidos key={versao} />}
      {aba === 'shopee' && (
        <Aviso>A Shopee entra no mesmo modelo (vínculo anúncio ↔ produto, reserva e envio automático). Para ligar pela API, é preciso cadastrar a Ponto Certo
          na <strong>Shopee Open Platform</strong> (open.shopee.com → Seller → criar app), com Partner ID e Partner Key, e autorizar a loja. Hoje as vendas da
          Shopee entram nos painéis da Moderna pela planilha do Seller Centre.</Aviso>
      )}
      <Aviso tipo="alerta">Enquanto o DirectControl continuar sincronizando, o estoque do ERP é o do DirectControl (atualizado a cada sincronização): os anúncios
        recebem esse número menos a reserva.</Aviso>
    </Pagina>
  );
}
