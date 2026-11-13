import { useState } from 'react';
import { supabase, api, ou } from '../lib/supabase.js';
import { moeda, data, hoje, somarDias, normalizaBusca, documento } from '../lib/formato.js';
import { usePerfil, navegar } from '../lib/contexto.js';
import { Pagina, Filtros, Campo, Tabela, Paginacao, Modal, Etiqueta, Aviso, Detalhes, useConsulta, useAtrasado, useSelecao, useAvisar } from '../componentes/ui.jsx';

const POR_PAGINA = 50;

export function situacaoTitulo(t) {
  if (t.status === 'pago') return <Etiqueta tipo="ok">Pago</Etiqueta>;
  if (t.status === 'cancelado') return <Etiqueta>Cancelado</Etiqueta>;
  if (t.vencimento < hoje()) return <Etiqueta tipo="erro">Atrasado</Etiqueta>;
  return <Etiqueta tipo="info">Em aberto</Etiqueta>;
}

function aplicarFiltros(q, f) {
  if (f.situacao === 'aberto') q = q.eq('status', 'aberto');
  if (f.situacao === 'atrasado') q = q.eq('status', 'aberto').lt('vencimento', hoje());
  if (f.situacao === 'pago') q = q.eq('status', 'pago');
  if (f.semCobranca) q = q.is('cobranca_id', null);
  if (f.de) q = q.gte('vencimento', f.de);
  if (f.ate) q = q.lte('vencimento', f.ate);
  if (f.cliente) q = q.eq('cliente_id', f.cliente);
  for (const p of normalizaBusca(f.busca).split(/\s+/).filter(Boolean)) q = q.ilike('clientes.busca', `%${p}%`);
  return q;
}

export default function Receber({ params }) {
  const avisar = useAvisar();
  const [f, setF] = useState({ situacao: params.situacao || 'aberto', busca: '', de: '', ate: '', semCobranca: false, cliente: params.cliente || '' });
  const [pagina, setPagina] = useState(1);
  const [detalhe, setDetalhe] = useState(null);
  const [gerar, setGerar] = useState(false);
  const [lote, setLote] = useState(false);
  const sel = useSelecao();
  const busca = useAtrasado(f.busca);
  const filtro = { ...f, busca };
  const mudar = (campo) => (e) => { setPagina(1); sel.limpar(); setF((x) => ({ ...x, [campo]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })); };

  const lista = useConsulta(async () => {
    const de = (pagina - 1) * POR_PAGINA;
    const r = ou(await aplicarFiltros(supabase.from('contas_receber')
      .select('*, clientes!inner(id, nome, cpf_cnpj, busca)', { count: 'exact' }), filtro)
      .order('vencimento', { ascending: f.situacao !== 'pago' }).order('id').range(de, de + POR_PAGINA - 1));
    return { dados: r.data, total: r.count };
  }, [pagina, f.situacao, busca, f.de, f.ate, f.semCobranca, f.cliente]);

  const totais = useConsulta(async () => {
    // Agregação no banco agrupada por clientes.ativo (no máx. 2 linhas). O PostgREST não aceita soma com embed vazio.
    const r = ou(await aplicarFiltros(supabase.from('contas_receber').select('saldo:saldo.sum(), pago:valor_pago.sum(), clientes!inner(ativo)'), filtro));
    return { dados: r.data.reduce((t, x) => ({ saldo: t.saldo + Number(x.saldo || 0), pago: t.pago + Number(x.pago || 0) }), { saldo: 0, pago: 0 }) };
  }, [f.situacao, busca, f.de, f.ate, f.semCobranca, f.cliente]);

  const linhas = lista.dados || [];
  const selecionados = linhas.filter((l) => sel.selecionados.has(l.id));
  const clientesSel = new Set(selecionados.map((l) => l.cliente_id));

  const recarregar = () => { sel.limpar(); lista.recarregar(); totais.recarregar(); };

  return (
    <Pagina titulo="Contas a Receber" subtitulo="Crediário importado do DirectControl e cobrança pelo Asaas"
      acoes={<>
        <button type="button" className="btn btn-sec" onClick={() => setLote(true)}>Fechamento do crediário</button>
        <button type="button" className="btn btn-sec" disabled={!selecionados.length || clientesSel.size !== 1} onClick={() => setGerar(true)}
          title={clientesSel.size > 1 ? 'Selecione títulos de um único cliente' : undefined}>
          Gerar cobrança{selecionados.length ? ` (${selecionados.length})` : ''}
        </button>
        <button type="button" className="btn btn-pri" disabled={!selecionados.length || clientesSel.size !== 1}
          onClick={() => navegar(`/receber/acerto?ids=${selecionados.map((l) => l.id).join(',')}`)}
          title={clientesSel.size > 1 ? 'Selecione títulos de um único cliente' : 'Marque os títulos que o cliente vai pagar no balcão'}>
          Receber selecionados{selecionados.length ? ` (${selecionados.length})` : ''}
        </button>
      </>}>
      <Filtros>
        <Campo rotulo="Situação">
          <select value={f.situacao} onChange={mudar('situacao')}>
            <option value="aberto">Em aberto</option>
            <option value="atrasado">Atrasados</option>
            <option value="pago">Pagos</option>
            <option value="todos">Todos</option>
          </select>
        </Campo>
        <Campo rotulo="Cliente (nome, código, CPF)" largo>
          <input type="search" value={f.busca} onChange={mudar('busca')} placeholder="Digite parte do nome…" />
        </Campo>
        <Campo rotulo="Vencimento de"><input type="date" value={f.de} onChange={mudar('de')} /></Campo>
        <Campo rotulo="até"><input type="date" value={f.ate} onChange={mudar('ate')} /></Campo>
        <label className="check"><input type="checkbox" checked={f.semCobranca} onChange={mudar('semCobranca')} /> Só sem cobrança</label>
        {f.cliente && <button type="button" className="btn btn-sec btn-peq" onClick={() => setF((x) => ({ ...x, cliente: '' }))}>Cliente {f.cliente} ×</button>}
      </Filtros>

      {clientesSel.size > 1 && <Aviso tipo="alerta">A cobrança e o recebimento no balcão reúnem títulos de um único cliente. Desmarque os de outros clientes.</Aviso>}

      <div className="resumo-linha">
        <span>Saldo filtrado: <strong>{moeda(totais.dados?.saldo)}</strong></span>
        {f.situacao !== 'aberto' && f.situacao !== 'atrasado' && <span>Recebido: <strong>{moeda(totais.dados?.pago)}</strong></span>}
        {selecionados.length > 0 && <span>Selecionado: <strong>{moeda(selecionados.reduce((s, l) => s + Number(l.saldo), 0))}</strong></span>}
      </div>

      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} aoClicar={setDetalhe}
        selecao={{ ...sel, podeSelecionar: (l) => l.status === 'aberto' && !l.cobranca_id }}
        colunas={[
          { titulo: 'Vencimento', render: (l) => data(l.vencimento) },
          { titulo: 'Cliente', render: (l) => <><span className="cod">{l.cliente_id}</span> {l.clientes?.nome}</> },
          { titulo: 'Histórico', render: (l) => l.historico || l.documento },
          { titulo: 'Valor', alinhar: 'dir', render: (l) => moeda(l.valor) },
          { titulo: 'Saldo', alinhar: 'dir', render: (l) => <strong>{moeda(l.saldo)}</strong> },
          { titulo: 'Situação', render: (l) => <span className="etiquetas">{situacaoTitulo(l)}{l.cobranca_id && <Etiqueta tipo="marca">Asaas</Etiqueta>}</span> },
        ]} />
      <Paginacao pagina={pagina} total={lista.total} porPagina={POR_PAGINA} aoMudar={setPagina} />

      {detalhe && <DetalheTitulo titulo={detalhe} aoFechar={() => setDetalhe(null)} aoAlterar={() => { setDetalhe(null); recarregar(); }} />}
      {gerar && <GerarCobranca titulos={selecionados} aoFechar={() => setGerar(false)}
        aoGerar={() => { setGerar(false); avisar('Cobrança gerada no Asaas.'); recarregar(); }} />}
      {lote && <CobrancaEmLote aoFechar={() => { setLote(false); recarregar(); }} />}
    </Pagina>
  );
}

// ---------------------------------------------------------------- detalhe + baixa manual
function DetalheTitulo({ titulo: t, aoFechar, aoAlterar }) {
  const perfil = usePerfil();
  const avisar = useAvisar();
  const [baixa, setBaixa] = useState({ valor: String(t.saldo), data: hoje(), forma: '' });
  const [salvando, setSalvando] = useState(false);
  const extra = useConsulta(async () => {
    const [rec, formas] = await Promise.all([
      supabase.from('recebimentos').select('*').eq('conta_receber_id', t.id).order('data').then(ou),
      supabase.from('formas_pagamento').select('id, descricao').eq('ativo', true).order('descricao').then(ou),
    ]);
    return { dados: { recebimentos: rec.data, formas: formas.data } };
  }, [t.id]);

  async function baixar(e) {
    e.preventDefault();
    const valor = Number(String(baixa.valor).replace(',', '.'));
    setSalvando(true);
    try {
      ou(await supabase.rpc('baixar_conta_receber', { p_id: t.id, p_valor: valor, p_data: baixa.data, p_forma_id: Number(baixa.forma), p_usuario: perfil.nome }));
      avisar('Baixa registrada. Lembre de baixar também no DirectControl.');
      aoAlterar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto titulo={`Título ${t.id} — ${t.clientes?.nome || ''}`} aoFechar={aoFechar} largo>
      <Detalhes itens={[
        ['Cliente', <a key="c" href={`#/clientes/${t.cliente_id}`}>{t.cliente_id} — {t.clientes?.nome}</a>],
        ['CPF/CNPJ', documento(t.clientes?.cpf_cnpj)],
        ['Histórico', t.historico], ['Documento / venda', t.documento],
        ['Parcela', t.parcela ? `${t.parcela} de ${t.total_parcelas || '?'}` : null],
        ['Emissão', data(t.emissao)], ['Vencimento', data(t.vencimento)],
        ['Valor', moeda(t.valor)], ['Pago', moeda(t.valor_pago)], ['Saldo', moeda(t.saldo)],
        ['Situação', situacaoTitulo(t)], ['Pago em', data(t.data_pagamento)],
        ['Baixa feita em', t.baixa_origem && { legado: 'DirectControl', erp: 'ERP (manual)', asaas: 'Asaas (automática)' }[t.baixa_origem]],
        ['Observação', t.observacao],
      ]} />
      {!t.baixa_replicada_legado && <Aviso tipo="alerta">Baixado aqui, mas ainda em aberto no DirectControl — dê a baixa lá também.</Aviso>}

      <h3>Recebimentos</h3>
      <Tabela linhas={extra.dados?.recebimentos} carregando={extra.carregando} vazio="Nenhum recebimento."
        colunas={[
          { titulo: 'Data', render: (r) => data(r.data) },
          { titulo: 'Forma', campo: 'forma_descricao' },
          { titulo: 'Origem', campo: 'origem' },
          { titulo: 'Valor', alinhar: 'dir', render: (r) => moeda(r.valor) },
        ]} />

      {t.status === 'aberto' && (t.cobranca_id ? (
        <Aviso>Este título está numa cobrança Asaas — a baixa acontece sozinha quando o cliente pagar. Para receber no balcão, cancele a cobrança antes em <a href="#/cobrancas">Cobranças</a>.</Aviso>
      ) : (
        <form className="form-linha" onSubmit={baixar}>
          <h3>Baixa manual</h3>
          <Campo rotulo="Valor"><input inputMode="decimal" value={baixa.valor} onChange={(e) => setBaixa({ ...baixa, valor: e.target.value })} required /></Campo>
          <Campo rotulo="Data"><input type="date" value={baixa.data} onChange={(e) => setBaixa({ ...baixa, data: e.target.value })} required /></Campo>
          <Campo rotulo="Forma de pagamento">
            <select value={baixa.forma} onChange={(e) => setBaixa({ ...baixa, forma: e.target.value })} required>
              <option value="">Selecione…</option>
              {(extra.dados?.formas || []).map((x) => <option key={x.id} value={x.id}>{x.descricao}</option>)}
            </select>
          </Campo>
          <button type="submit" className="btn btn-pri" disabled={salvando}>{salvando ? 'Salvando…' : 'Registrar baixa'}</button>
        </form>
      ))}
    </Modal>
  );
}

// ---------------------------------------------------------------- gerar cobrança (1 cliente)
function GerarCobranca({ titulos, aoFechar, aoGerar }) {
  const avisar = useAvisar();
  const [vencimento, setVencimento] = useState(somarDias(hoje(), 3));
  const [enviando, setEnviando] = useState(false);
  const total = titulos.reduce((s, t) => s + Number(t.saldo), 0);

  async function gerar() {
    setEnviando(true);
    try {
      await api('cobrancas', { corpo: { acao: 'criar', titulos: titulos.map((t) => t.id), vencimento } });
      aoGerar();
    } catch (erro) {
      avisar(erro.message, 'erro');
      setEnviando(false);
    }
  }

  return (
    <Modal aberto titulo="Gerar cobrança no Asaas" aoFechar={aoFechar}
      rodape={<>
        <button type="button" className="btn btn-sec" onClick={aoFechar}>Cancelar</button>
        <button type="button" className="btn btn-pri" onClick={gerar} disabled={enviando}>{enviando ? 'Gerando…' : `Gerar cobrança de ${moeda(total)}`}</button>
      </>}>
      <p><strong>{titulos[0].clientes?.nome}</strong> — {titulos.length} título(s) reunidos numa única cobrança (boleto + PIX).</p>
      <ul className="lista-simples">
        {titulos.map((t) => <li key={t.id}>{data(t.vencimento)} · {t.historico || t.documento} · {moeda(t.saldo)}</li>)}
      </ul>
      <Campo rotulo="Vencimento da cobrança"><input type="date" min={hoje()} value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></Campo>
      <p className="ajuda">O Asaas envia a fatura ao cliente (e-mail/SMS/WhatsApp, conforme configurado na conta) e aplica multa e juros após o vencimento. Quando o pagamento cair, os títulos são baixados automaticamente.</p>
    </Modal>
  );
}

// ---------------------------------------------------------------- fechamento do crediário (lote)
function CobrancaEmLote({ aoFechar }) {
  const [ate, setAte] = useState(hoje());
  const [vencimento, setVencimento] = useState(somarDias(hoje(), 5));
  const [rodando, setRodando] = useState(false);
  const [resultados, setResultados] = useState([]);
  const [erro, setErro] = useState('');
  const previa = useConsulta(async () => {
    // Agrupado por cliente no banco: uma linha por cliente (bem abaixo do limite de 1000 linhas da API)
    const { data: grupos } = ou(await supabase.from('contas_receber').select('cliente_id, saldo:saldo.sum(), clientes!inner(cobranca_ativa)')
      .eq('status', 'aberto').is('cobranca_id', null).lte('vencimento', ate).eq('clientes.cobranca_ativa', true));
    return { dados: { clientes: grupos.length, valor: grupos.reduce((s, g) => s + Number(g.saldo), 0) } };
  }, [ate]);

  async function executar() {
    setRodando(true);
    setErro('');
    const pular = [];
    try {
      for (;;) {
        const r = await api('cobrancas', { corpo: { acao: 'lote', ate, vencimento, pular } });
        setResultados((x) => [...x, ...r.resultados]);
        r.resultados.filter((x) => !x.ok).forEach((x) => pular.push(x.cliente_id));
        if (!r.restantes || !r.resultados.length) break;
      }
    } catch (e) {
      setErro(e.message);
    }
    setRodando(false);
  }

  const ok = resultados.filter((r) => r.ok);
  return (
    <Modal aberto largo titulo="Fechamento do crediário — cobrança em lote" aoFechar={rodando ? () => {} : aoFechar}
      rodape={<>
        <button type="button" className="btn btn-sec" onClick={aoFechar} disabled={rodando}>Fechar</button>
        {!resultados.length && <button type="button" className="btn btn-pri" onClick={executar} disabled={rodando || !previa.dados?.clientes}>
          {rodando ? 'Gerando…' : `Gerar ${previa.dados?.clientes || 0} cobrança(s)`}</button>}
      </>}>
      <p>Gera <strong>uma cobrança por cliente</strong> somando todos os títulos em aberto, sem cobrança, que vencem até a data escolhida. Clientes com cobrança desativada no cadastro ficam de fora.</p>
      <div className="form-linha">
        <Campo rotulo="Títulos vencendo até"><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} disabled={rodando || resultados.length > 0} /></Campo>
        <Campo rotulo="Vencimento das cobranças"><input type="date" min={hoje()} value={vencimento} onChange={(e) => setVencimento(e.target.value)} disabled={rodando || resultados.length > 0} /></Campo>
      </div>
      {previa.dados && !resultados.length && <p>{previa.dados.clientes} cliente(s), total {moeda(previa.dados.valor)}.</p>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {resultados.length > 0 && <>
        <p><strong>{ok.length}</strong> cobrança(s) gerada(s), {moeda(ok.reduce((s, r) => s + Number(r.valor), 0))}. {resultados.length - ok.length > 0 && `${resultados.length - ok.length} com erro:`}</p>
        <ul className="lista-simples">
          {resultados.filter((r) => !r.ok).map((r) => <li key={r.cliente_id}><strong>{r.nome}</strong>: {r.erro}</li>)}
        </ul>
      </>}
    </Modal>
  );
}
