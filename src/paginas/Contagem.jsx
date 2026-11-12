// Contagem cíclica de estoque (/contagem e /contagem?id=N). Banco: contagens / contagem_itens e funções contagem_* (016/017).
//  - admin/financeiro cria a lista por critério (grupo, curva ABC, há mais tempo sem contar), acompanha e fecha;
//  - qualquer usuário conta (celular com câmera, leitor ou digitando). A contagem é "cega": quem conta não vê o estoque do sistema;
//  - ao fechar com ajuste, o estoque recebe a diferença (contado − foto da criação), sem perder as vendas feitas no meio.
import { useMemo, useRef, useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { moeda, numero, dataHora, hoje } from '../lib/formato.js';
import { navegar, usePerfil, podeFinanceiro } from '../lib/contexto.js';
import { Pagina, Campo, Tabela, Modal, Aviso, Etiqueta, useAvisar, useConsulta } from '../componentes/ui.jsx';
import { LeitorCamera } from './PreVenda.jsx';

const num = (v) => Number(String(v ?? '').replace(/\./g, '').replace(',', '.'));
const SITUACAO = { aberta: ['alerta', 'Aberta'], finalizada: ['ok', 'Finalizada'], cancelada: ['neutra', 'Cancelada'] };

function NovaContagem({ aoFechar, aoCriar }) {
  const avisar = useAvisar();
  const [f, setF] = useState({ descricao: '', grupo_id: '', curva: '', quantidade: '50', nao_contados_dias: '30', apenas_com_estoque: true });
  const [enviando, setEnviando] = useState(false);
  const grupos = useConsulta(async () => ({ dados: ou(await supabase.from('grupos_produto').select('id, nome').order('nome')).data }), []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  async function criar() {
    setEnviando(true);
    try {
      const id = ou(await supabase.rpc('contagem_criar', { p: { ...f, quantidade: Number(f.quantidade) || 50, nao_contados_dias: Number(f.nao_contados_dias) || 0 } }));
      aoCriar(id);
    } catch (e) { avisar(e.message, 'erro'); setEnviando(false); }
  }
  return (
    <Modal aberto titulo="Nova contagem de estoque" aoFechar={aoFechar}
      rodape={<><button type="button" className="btn btn-sec" onClick={aoFechar}>Voltar</button>
        <button type="button" className="btn btn-pri" onClick={criar} disabled={enviando}>{enviando ? 'Gerando lista…' : 'Gerar lista'}</button></>}>
      <p className="texto-fraco">Contagem cíclica: conte poucos itens por vez, toda semana, em vez de parar a loja para um inventário. A lista prioriza os produtos que
        nunca foram contados (ou há mais tempo) e, entre eles, os que mais vendem.</p>
      <div className="form-grade">
        <Campo rotulo="Descrição" largo><input value={f.descricao} onChange={set('descricao')} placeholder={`Contagem ${hoje().split('-').reverse().join('/')}`} maxLength={80} /></Campo>
        <Campo rotulo="Grupo"><select value={f.grupo_id} onChange={set('grupo_id')}><option value="">Todos</option>{(grupos.dados || []).map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}</select></Campo>
        <Campo rotulo="Curva ABC (vendas 12 meses)"><select value={f.curva} onChange={set('curva')}><option value="">Todas</option><option value="A">A — mais vendidos (80% do faturamento)</option><option value="B">B — intermediários</option><option value="C">C — menos vendidos</option></select></Campo>
        <Campo rotulo="Quantidade de itens"><select value={f.quantidade} onChange={set('quantidade')}>{[20, 30, 50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}</select></Campo>
        <Campo rotulo="Não contados há (dias)"><select value={f.nao_contados_dias} onChange={set('nao_contados_dias')}><option value="0">Qualquer</option>{[30, 60, 90, 180].map((n) => <option key={n} value={n}>{n}</option>)}</select></Campo>
        <label className="campo campo-check"><input type="checkbox" checked={f.apenas_com_estoque} onChange={set('apenas_com_estoque')} /> <span>Só itens com estoque diferente de zero no sistema</span></label>
      </div>
    </Modal>
  );
}

function Lista() {
  const fin = podeFinanceiro(usePerfil());
  const [nova, setNova] = useState(false);
  const lista = useConsulta(async () => {
    const cs = ou(await supabase.from('contagens').select('*').order('id', { ascending: false }).limit(40)).data;
    // progresso: contagem com agregação no banco (cada contagem tem no máximo 500 itens)
    const prog = await Promise.all(cs.filter((c) => c.status === 'aberta').map(async (c) => {
      const [{ count: total }, { count: contados }] = await Promise.all([
        supabase.from('contagem_itens').select('produto_id', { count: 'exact', head: true }).eq('contagem_id', c.id),
        supabase.from('contagem_itens').select('produto_id', { count: 'exact', head: true }).eq('contagem_id', c.id).not('quantidade', 'is', null),
      ]);
      return [c.id, { total, contados }];
    }));
    const p = Object.fromEntries(prog);
    return { dados: cs.map((c) => ({ ...c, ...(p[c.id] || {}) })) };
  }, []);
  return (
    <Pagina titulo="Contagem de estoque" subtitulo="Contagem cíclica: listas pequenas, contadas no celular, com ajuste pela diferença"
      acoes={fin && <button type="button" className="btn btn-pri" onClick={() => setNova(true)}>Nova contagem</button>}>
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} aoClicar={(c) => navegar(`/contagem?id=${c.id}`)}
        vazio={fin ? 'Nenhuma contagem ainda. Clique em "Nova contagem".' : 'Nenhuma contagem aberta. Peça ao gerente para gerar uma lista.'}
        colunas={[
          { titulo: 'Nº', campo: 'id' }, { titulo: 'Descrição', campo: 'descricao' },
          { titulo: 'Situação', render: (c) => <Etiqueta tipo={SITUACAO[c.status][0]}>{SITUACAO[c.status][1]}{c.status === 'finalizada' ? (c.ajustada ? ' · estoque ajustado' : ' · sem ajuste') : ''}</Etiqueta> },
          { titulo: 'Progresso', render: (c) => (c.total ? `${c.contados}/${c.total}` : '—'), alinhar: 'dir' },
          { titulo: 'Criada', render: (c) => `${dataHora(c.criada_em)}${c.criada_por ? ` · ${c.criada_por}` : ''}` },
          { titulo: 'Fechada', render: (c) => (c.finalizada_em ? `${dataHora(c.finalizada_em)}${c.finalizada_por ? ` · ${c.finalizada_por}` : ''}` : '') }]} />
      {nova && <NovaContagem aoFechar={() => setNova(false)} aoCriar={(id) => navegar(`/contagem?id=${id}`)} />}
    </Pagina>
  );
}

function Detalhe({ id }) {
  const avisar = useAvisar();
  const fin = podeFinanceiro(usePerfil());
  const [filtro, setFiltro] = useState('pendentes');
  const [codigo, setCodigo] = useState('');
  const [qtd, setQtd] = useState('');
  const [somaUm, setSomaUm] = useState(false); // cada leitura soma 1 (bipar item por item)
  const [camera, setCamera] = useState(false);
  const [fechar, setFechar] = useState(false);
  const [versao, setVersao] = useState(0);
  const [selecionado, setSelecionado] = useState(null);
  const qtdRef = useRef(null);
  const codRef = useRef(null);

  const dados = useConsulta(async () => {
    const c = ou(await supabase.from('contagens').select('*').eq('id', id).maybeSingle()).data;
    if (!c) throw new Error('Contagem não encontrada');
    const itens = ou(await supabase.from('contagem_itens')
      .select('produto_id, estoque_sistema, custo, quantidade, contado_por, contado_em, ajuste, produtos(nome, referencia, codigo_barras, unidade, estoque)')
      .eq('contagem_id', id).order('produto_id')).data;
    return { dados: { c, itens } };
  }, [id, versao]);
  const c = dados.dados?.c;
  const itens = dados.dados?.itens || [];
  const aberta = c?.status === 'aberta';
  const contados = itens.filter((i) => i.quantidade !== null).length;
  const divergentes = itens.filter((i) => i.quantidade !== null && Number(i.quantidade) !== Number(i.estoque_sistema));
  const valorDiv = divergentes.reduce((s, i) => s + (Number(i.quantidade) - Number(i.estoque_sistema)) * Number(i.custo || 0), 0);

  const mostrar = useMemo(() => {
    if (filtro === 'pendentes') return itens.filter((i) => i.quantidade === null);
    if (filtro === 'contados') return itens.filter((i) => i.quantidade !== null);
    if (filtro === 'divergentes') return divergentes;
    return itens;
  }, [itens, filtro]);

  function achar(cod) {
    const t = String(cod || '').trim();
    if (!t) return null;
    return itens.find((i) => i.produtos?.codigo_barras === t) || (/^\d{1,7}$/.test(t) ? itens.find((i) => Number(i.produto_id) === Number(t)) : null)
      || itens.find((i) => (i.produtos?.referencia || '').toUpperCase() === t.toUpperCase());
  }

  async function lancar(item, quantidade, somar) {
    const r = ou(await supabase.rpc('contagem_lancar', { p_contagem: id, p_produto: item.produto_id, p_quantidade: quantidade, p_somar: somar }));
    setVersao((v) => v + 1);
    return r;
  }

  async function confirmar(e) {
    e?.preventDefault();
    const item = selecionado || achar(codigo);
    if (!item) { avisar(`"${codigo}" não está nesta lista.`, 'erro'); return; }
    if (somaUm && !qtd) {
      try { const r = await lancar(item, 1, true); avisar(`${item.produtos?.nome}: ${numero(r.quantidade)}`, 'ok'); } catch (er) { avisar(er.message, 'erro'); }
      setCodigo(''); setSelecionado(null); codRef.current?.focus();
      return;
    }
    if (String(qtd).trim() === '' || !(num(qtd) >= 0)) { setSelecionado(item); qtdRef.current?.focus(); return; }
    try { await lancar(item, num(qtd), false); avisar(`${item.produtos?.nome}: ${qtd}`, 'ok'); } catch (er) { avisar(er.message, 'erro'); return; }
    setCodigo(''); setQtd(''); setSelecionado(null); codRef.current?.focus();
  }

  async function lidoNaCamera(cod) {
    const item = achar(cod);
    if (!item) { avisar(`Código ${cod} não está nesta lista.`, 'erro'); return null; }
    if (somaUm) {
      try { const r = await lancar(item, 1, true); return { texto: `${item.produtos?.nome}: ${numero(r.quantidade)}` }; } catch (er) { avisar(er.message, 'erro'); return null; }
    }
    setCamera(false); setSelecionado(item); setCodigo(cod); setTimeout(() => qtdRef.current?.focus(), 50);
    return { texto: item.produtos?.nome };
  }

  async function finalizar(ajustar) {
    try {
      const r = ou(await supabase.rpc('contagem_finalizar', { p_contagem: id, p_ajustar: ajustar }));
      avisar(ajustar ? `Estoque ajustado em ${r.ajustados} produto(s) (${moeda(r.valor_ajuste)} a custo).` : 'Contagem fechada sem mexer no estoque.', 'ok');
      setFechar(false); setVersao((v) => v + 1);
    } catch (e) { avisar(e.message, 'erro'); }
  }
  async function cancelar() {
    try { ou(await supabase.rpc('contagem_cancelar', { p_contagem: id })); setFechar(false); setVersao((v) => v + 1); } catch (e) { avisar(e.message, 'erro'); }
  }

  if (dados.erro) return <Pagina titulo="Contagem"><Aviso tipo="erro">{dados.erro}</Aviso></Pagina>;
  if (!c) return <Pagina titulo="Contagem"><p>Carregando…</p></Pagina>;
  const mostrarSistema = fin && (!aberta || filtro === 'divergentes');

  return (
    <Pagina titulo={`Contagem ${c.id} — ${c.descricao}`} subtitulo={`${contados} de ${itens.length} itens contados${fin && contados ? ` · ${divergentes.length} com diferença` : ''}`}
      acoes={<>
        <a className="btn btn-sec" href="#/contagem">Voltar</a>
        <button type="button" className="btn btn-sec" onClick={() => window.print()}>Imprimir folha</button>
        {fin && aberta && <button type="button" className="btn btn-pri" onClick={() => setFechar(true)}>Fechar contagem</button>}
      </>}>
      <div className="cont-progresso" role="progressbar" aria-valuemin={0} aria-valuemax={itens.length} aria-valuenow={contados}>
        <span style={{ width: `${itens.length ? (contados / itens.length) * 100 : 0}%` }} />
      </div>
      {!aberta && <Aviso tipo={c.status === 'finalizada' ? 'ok' : 'info'}>Contagem {SITUACAO[c.status][1].toLowerCase()} em {dataHora(c.finalizada_em)}{c.finalizada_por ? ` por ${c.finalizada_por}` : ''}{c.status === 'finalizada' ? (c.ajustada ? ': estoque ajustado pela diferença.' : ': estoque não foi alterado.') : '.'}</Aviso>}
      {aberta && (
        <form className="cont-lancar" onSubmit={confirmar}>
          <Campo rotulo="Código de barras, código ou referência">
            <input ref={codRef} value={codigo} autoFocus inputMode="text" onChange={(e) => { setCodigo(e.target.value); setSelecionado(null); }} placeholder="Bipe ou digite" />
          </Campo>
          {!somaUm && <Campo rotulo="Quantidade contada"><input ref={qtdRef} className="cont-qtd" value={qtd} inputMode="decimal" onChange={(e) => setQtd(e.target.value)} placeholder="0" /></Campo>}
          <button type="submit" className="btn btn-pri">{somaUm ? 'Somar 1' : 'Gravar'}</button>
          <button type="button" className="btn btn-sec" onClick={() => setCamera(true)}>📷 Câmera</button>
          <label className="campo-check"><input type="checkbox" checked={somaUm} onChange={(e) => setSomaUm(e.target.checked)} /> <span>Cada leitura soma 1</span></label>
          {selecionado && <p className="cont-sel">→ <strong>{selecionado.produtos?.nome}</strong>{selecionado.quantidade !== null && <> (já contado: {numero(selecionado.quantidade)})</>}</p>}
        </form>
      )}
      <div className="abas" role="tablist">
        {[['pendentes', `Pendentes (${itens.length - contados})`], ['contados', `Contados (${contados})`], ...(fin ? [['divergentes', `Com diferença (${divergentes.length})`]] : []), ['todos', `Todos (${itens.length})`]].map(([k, r]) => (
          <button key={k} type="button" role="tab" aria-selected={filtro === k} className={`aba${filtro === k ? ' ativa' : ''}`} onClick={() => setFiltro(k)}>{r}</button>
        ))}
      </div>
      {fin && filtro === 'divergentes' && divergentes.length > 0 && <p className="texto-fraco">Diferença total a preço de custo: <strong className={valorDiv < 0 ? 'texto-erro' : ''}>{moeda(valorDiv)}</strong>. Antes de ajustar, recontar os itens com diferença grande.</p>}
      <Tabela chave="produto_id" linhas={mostrar} vazio={filtro === 'pendentes' ? 'Tudo contado.' : 'Nenhum item.'}
        aoClicar={aberta ? (i) => { setSelecionado(i); setCodigo(i.produtos?.codigo_barras || String(i.produto_id)); setQtd(i.quantidade !== null ? String(i.quantidade).replace('.', ',') : ''); setTimeout(() => qtdRef.current?.focus(), 30); window.scrollTo({ top: 0, behavior: 'smooth' }); } : undefined}
        colunas={[
          { titulo: 'Cód.', campo: 'produto_id' }, { titulo: 'Produto', render: (i) => i.produtos?.nome },
          { titulo: 'Ref.', render: (i) => i.produtos?.referencia }, { titulo: 'Un.', render: (i) => i.produtos?.unidade },
          { titulo: 'Contado', render: (i) => (i.quantidade === null ? <span className="cont-vazio">____</span> : numero(i.quantidade)), alinhar: 'dir' },
          ...(mostrarSistema ? [
            { titulo: 'Sistema (na criação)', render: (i) => numero(i.estoque_sistema), alinhar: 'dir' },
            { titulo: 'Diferença', render: (i) => { if (i.quantidade === null) return ''; const d = Number(i.quantidade) - Number(i.estoque_sistema); return <span className={d < 0 ? 'texto-erro' : d > 0 ? 'texto-ok' : ''}>{d > 0 ? '+' : ''}{numero(d)}</span>; }, alinhar: 'dir' },
            { titulo: 'Dif. (custo)', render: (i) => (i.quantidade === null ? '' : moeda((Number(i.quantidade) - Number(i.estoque_sistema)) * Number(i.custo || 0))), alinhar: 'dir' },
          ] : []),
          { titulo: 'Por', render: (i) => (i.contado_em ? `${i.contado_por || ''} ${dataHora(i.contado_em)}` : '') }]} />
      {camera && <LeitorCamera aoLer={lidoNaCamera} aoFechar={() => setCamera(false)} />}
      {fechar && (
        <Modal aberto titulo="Fechar contagem" aoFechar={() => setFechar(false)}
          rodape={<>
            <button type="button" className="btn btn-perigo" onClick={cancelar}>Cancelar contagem</button>
            <button type="button" className="btn btn-sec" onClick={() => finalizar(false)}>Fechar sem ajustar</button>
            <button type="button" className="btn btn-pri" onClick={() => finalizar(true)} disabled={!contados}>Ajustar estoque e fechar</button>
          </>}>
          <p><strong>{contados}</strong> de {itens.length} itens contados; <strong>{divergentes.length}</strong> com diferença ({moeda(valorDiv)} a custo).
            Itens não contados ficam como estão.</p>
          <p>O ajuste soma ao estoque atual a diferença entre o contado e o estoque do momento em que a lista foi gerada, então as vendas feitas durante a contagem continuam descontadas.</p>
          <Aviso tipo="alerta">Enquanto o DirectControl continuar sincronizando o estoque com o ERP, ele sobrescreve o estoque daqui. Faça o mesmo acerto no DirectControl
            (ou use “Fechar sem ajustar” e lance lá) até a troca definitiva de sistema.</Aviso>
        </Modal>
      )}
    </Pagina>
  );
}

export default function Contagem({ params }) {
  return params.id ? <Detalhe key={params.id} id={Number(params.id)} /> : <Lista />;
}
