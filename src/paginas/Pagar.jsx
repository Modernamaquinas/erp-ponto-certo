import { useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { moeda, data, hoje, somarDias, normalizaBusca } from '../lib/formato.js';
import { Pagina, Filtros, Campo, Tabela, Paginacao, Modal, Etiqueta, Aviso, Detalhes, useConsulta, useAtrasado, useAvisar } from '../componentes/ui.jsx';

const POR_PAGINA = 50;

function situacao(c) {
  if (c.status === 'pago') return <Etiqueta tipo="ok">Pago</Etiqueta>;
  if (c.conferir_baixa_legado) return <Etiqueta tipo="alerta">Conferir</Etiqueta>;
  if (c.vencimento < hoje()) return <Etiqueta tipo="erro">Atrasado</Etiqueta>;
  return <Etiqueta tipo="info">Em aberto</Etiqueta>;
}

function aplicar(q, f) {
  if (f.situacao === 'aberto') q = q.eq('status', 'aberto').eq('conferir_baixa_legado', false);
  if (f.situacao === 'atrasado') q = q.eq('status', 'aberto').eq('conferir_baixa_legado', false).lt('vencimento', hoje());
  if (f.situacao === 'conferir') q = q.eq('status', 'aberto').eq('conferir_baixa_legado', true);
  if (f.situacao === 'pago') q = q.eq('status', 'pago');
  if (f.de) q = q.gte('vencimento', f.de);
  if (f.ate) q = q.lte('vencimento', f.ate);
  for (const p of normalizaBusca(f.busca).split(/\s+/).filter(Boolean)) q = q.ilike('fornecedores.busca', `%${p}%`);
  return q;
}

export default function Pagar({ params }) {
  const [f, setF] = useState({ situacao: params.situacao || 'aberto', busca: '', de: '', ate: '' });
  const [pagina, setPagina] = useState(1);
  const [aberta, setAberta] = useState(null);
  const [nova, setNova] = useState(false);
  const busca = useAtrasado(f.busca);
  const filtro = { ...f, busca };
  const mudar = (campo) => (e) => { setPagina(1); setF((x) => ({ ...x, [campo]: e.target.value })); };
  // Embed com !inner só quando filtra por fornecedor (senão contas sem fornecedor sumiriam da lista)
  const embed = busca.trim() ? 'fornecedores!inner(nome, busca)' : 'fornecedores(nome)';

  const lista = useConsulta(async () => {
    const de = (pagina - 1) * POR_PAGINA;
    const r = ou(await aplicar(supabase.from('contas_pagar').select(`*, ${embed}`, { count: 'exact' }), filtro)
      .order('vencimento', { ascending: f.situacao !== 'pago' }).order('id').range(de, de + POR_PAGINA - 1));
    return { dados: r.data, total: r.count };
  }, [pagina, f.situacao, busca, f.de, f.ate]);

  const total = useConsulta(async () => {
    // Com busca por fornecedor, agrupa por fornecedores.ativo (no máx. 2 linhas): PostgREST não soma com embed vazio.
    const embedFiltro = busca.trim() ? ', fornecedores!inner(ativo)' : '';
    const r = ou(await aplicar(supabase.from('contas_pagar').select(`saldo:saldo.sum(), pago:valor_pago.sum()${embedFiltro}`), filtro));
    return { dados: r.data.reduce((t, x) => ({ saldo: t.saldo + Number(x.saldo || 0), pago: t.pago + Number(x.pago || 0) }), { saldo: 0, pago: 0 }) };
  }, [f.situacao, busca, f.de, f.ate]);

  const recarregar = () => { lista.recarregar(); total.recarregar(); };

  return (
    <Pagina titulo="Contas a Pagar" acoes={<button type="button" className="btn btn-pri" onClick={() => setNova(true)}>Nova conta</button>}>
      <Filtros>
        <Campo rotulo="Situação">
          <select value={f.situacao} onChange={mudar('situacao')}>
            <option value="aberto">Em aberto</option>
            <option value="atrasado">Atrasadas</option>
            <option value="conferir">Herdadas sem baixa (conferir)</option>
            <option value="pago">Pagas</option>
            <option value="todos">Todas</option>
          </select>
        </Campo>
        <Campo rotulo="Fornecedor" largo><input type="search" value={f.busca} onChange={mudar('busca')} placeholder="Nome ou CNPJ…" /></Campo>
        <Campo rotulo="Vencimento de"><input type="date" value={f.de} onChange={mudar('de')} /></Campo>
        <Campo rotulo="até"><input type="date" value={f.ate} onChange={mudar('ate')} /></Campo>
      </Filtros>

      {f.situacao === 'conferir' && <BaixaLegadoEmLote aoConcluir={recarregar} />}

      <div className="resumo-linha">
        <span>{f.situacao === 'pago' ? 'Pago' : 'Saldo'}: <strong>{moeda(f.situacao === 'pago' ? total.dados?.pago : total.dados?.saldo)}</strong></span>
      </div>

      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} aoClicar={setAberta}
        colunas={[
          { titulo: 'Vencimento', render: (c) => data(c.vencimento) },
          { titulo: 'Fornecedor', render: (c) => c.fornecedores?.nome || '—' },
          { titulo: 'Documento', render: (c) => c.documento },
          { titulo: 'Parcela', alinhar: 'centro', render: (c) => (c.parcela ? `${c.parcela}/${c.total_parcelas || '?'}` : '') },
          { titulo: 'Valor', alinhar: 'dir', render: (c) => moeda(c.valor) },
          { titulo: 'Saldo', alinhar: 'dir', render: (c) => <strong>{moeda(c.saldo)}</strong> },
          { titulo: 'Situação', render: situacao },
        ]} />
      <Paginacao pagina={pagina} total={lista.total} porPagina={POR_PAGINA} aoMudar={setPagina} />

      {aberta && <DetalheConta conta={aberta} aoFechar={() => setAberta(null)} aoAlterar={() => { setAberta(null); recarregar(); }} />}
      {nova && <NovaConta aoFechar={() => setNova(false)} aoSalvar={() => { setNova(false); recarregar(); }} />}
    </Pagina>
  );
}

function BaixaLegadoEmLote({ aoConcluir }) {
  const avisar = useAvisar();
  const [ate, setAte] = useState(somarDias(hoje(), -1));
  const [rodando, setRodando] = useState(false);
  async function executar() {
    if (!window.confirm(`Marcar como pagas (na data de vencimento) todas as contas herdadas sem baixa que venceram até ${data(ate)}?`)) return;
    setRodando(true);
    try {
      const { data: n } = ou(await supabase.rpc('baixar_pagar_legado_em_lote', { p_ate: ate }));
      avisar(`${n} conta(s) baixadas.`);
      aoConcluir();
    } catch (e) {
      avisar(e.message, 'erro');
    }
    setRodando(false);
  }
  return (
    <Aviso tipo="alerta">
      <p>O DirectControl nunca registrou pagamento de contas a pagar, então as contas que já venceram vieram em aberto. Se elas foram pagas no banco, baixe em lote. Antes disso, confira as mais recentes.</p>
      <div className="form-linha">
        <Campo rotulo="Baixar as vencidas até"><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Campo>
        <button type="button" className="btn btn-pri" disabled={rodando} onClick={executar}>{rodando ? 'Baixando…' : 'Baixar em lote'}</button>
      </div>
    </Aviso>
  );
}

function DetalheConta({ conta: c, aoFechar, aoAlterar }) {
  const avisar = useAvisar();
  const [baixa, setBaixa] = useState({ valor: String(c.saldo), data: hoje(), obs: '' });
  const [ocupado, setOcupado] = useState(false);

  async function baixar(e) {
    e.preventDefault();
    setOcupado(true);
    try {
      ou(await supabase.rpc('baixar_conta_pagar', { p_id: c.id, p_valor: Number(String(baixa.valor).replace(',', '.')), p_data: baixa.data, p_observacao: baixa.obs || null }));
      avisar('Pagamento registrado.');
      aoAlterar();
    } catch (erro) {
      avisar(erro.message, 'erro');
      setOcupado(false);
    }
  }

  async function excluir() {
    if (!window.confirm('Excluir esta conta a pagar?')) return;
    try {
      ou(await supabase.from('contas_pagar').delete().eq('id', c.id));
      avisar('Conta excluída.');
      aoAlterar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  return (
    <Modal aberto largo titulo={`Conta a pagar ${c.id}`} aoFechar={aoFechar}
      rodape={c.id >= 1000000 && c.status === 'aberto' && <button type="button" className="btn btn-perigo" onClick={excluir}>Excluir</button>}>
      <Detalhes itens={[
        ['Fornecedor', c.fornecedores?.nome], ['Documento', c.documento], ['Histórico', c.historico],
        ['Parcela', c.parcela ? `${c.parcela} de ${c.total_parcelas || '?'}` : null], ['Emissão', data(c.emissao)],
        ['Vencimento', data(c.vencimento)], ['Valor', moeda(c.valor)], ['Pago', moeda(c.valor_pago)], ['Saldo', moeda(c.saldo)],
        ['Situação', situacao(c)], ['Pago em', data(c.data_pagamento)], ['Observação', c.observacao],
        ['Origem', c.id >= 1000000 ? 'Lançada no ERP' : 'DirectControl'],
      ]} />
      {c.status === 'aberto' && (
        <form className="form-linha" onSubmit={baixar}>
          <h3>Registrar pagamento</h3>
          <Campo rotulo="Valor"><input inputMode="decimal" value={baixa.valor} onChange={(e) => setBaixa({ ...baixa, valor: e.target.value })} required /></Campo>
          <Campo rotulo="Data"><input type="date" value={baixa.data} onChange={(e) => setBaixa({ ...baixa, data: e.target.value })} required /></Campo>
          <Campo rotulo="Observação" largo><input value={baixa.obs} onChange={(e) => setBaixa({ ...baixa, obs: e.target.value })} placeholder="Ex.: pago via PIX Sicredi" /></Campo>
          <button type="submit" className="btn btn-pri" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Pagar'}</button>
        </form>
      )}
    </Modal>
  );
}

function NovaConta({ aoFechar, aoSalvar }) {
  const avisar = useAvisar();
  const [c, setC] = useState({ fornecedor_id: '', documento: '', historico: '', vencimento: hoje(), valor: '', parcelas: '1', plano_conta_id: '' });
  const [salvando, setSalvando] = useState(false);
  const aux = useConsulta(async () => {
    const [forn, plano] = await Promise.all([
      supabase.from('fornecedores').select('id, nome').eq('ativo', true).order('nome').then(ou),
      supabase.from('plano_contas').select('id, nome').eq('tipo', 'saida').eq('ativo', true).order('nome').then(ou),
    ]);
    return { dados: { fornecedores: forn.data, plano: plano.data } };
  }, []);
  const set = (k) => (e) => setC({ ...c, [k]: e.target.value });

  async function salvar(e) {
    e.preventDefault();
    const total = Number(String(c.valor).replace(',', '.'));
    const n = Math.max(1, Math.min(60, Number(c.parcelas) || 1));
    if (!(total > 0)) return avisar('Informe um valor válido.', 'erro');
    // Divide em parcelas mensais; a última absorve o arredondamento.
    const base = Math.floor((total / n) * 100) / 100;
    const linhas = Array.from({ length: n }, (_, i) => {
      const [a, m, d] = c.vencimento.split('-').map(Number);
      const ultimoDia = new Date(Date.UTC(a, m + i, 0)).getUTCDate(); // dia 31 vira 28/30 nos meses curtos
      const venc = new Date(Date.UTC(a, m - 1 + i, Math.min(d, ultimoDia))).toISOString().slice(0, 10);
      const valor = i === n - 1 ? Math.round((total - base * (n - 1)) * 100) / 100 : base;
      return {
        fornecedor_id: c.fornecedor_id ? Number(c.fornecedor_id) : null, documento: c.documento || null,
        historico: c.historico || null, parcela: i + 1, total_parcelas: n, emissao: hoje(), vencimento: venc,
        valor, saldo: valor, plano_conta_id: c.plano_conta_id ? Number(c.plano_conta_id) : null,
      };
    });
    setSalvando(true);
    try {
      ou(await supabase.from('contas_pagar').insert(linhas));
      avisar(n > 1 ? `${n} parcelas lançadas.` : 'Conta lançada.');
      aoSalvar();
    } catch (erro) {
      avisar(erro.message, 'erro');
      setSalvando(false);
    }
  }

  return (
    <Modal aberto titulo="Nova conta a pagar" aoFechar={aoFechar}
      rodape={<>
        <button type="button" className="btn btn-sec" onClick={aoFechar}>Cancelar</button>
        <button type="submit" form="form-nova-conta" className="btn btn-pri" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      </>}>
      <form id="form-nova-conta" className="form-grade" onSubmit={salvar}>
        <Campo rotulo="Fornecedor" largo>
          <select value={c.fornecedor_id} onChange={set('fornecedor_id')}>
            <option value="">— sem fornecedor —</option>
            {(aux.dados?.fornecedores || []).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Categoria (plano de contas)" largo>
          <select value={c.plano_conta_id} onChange={set('plano_conta_id')}>
            <option value="">—</option>
            {(aux.dados?.plano || []).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Histórico" largo><input value={c.historico} onChange={set('historico')} placeholder="Ex.: Aluguel da loja" /></Campo>
        <Campo rotulo="Documento / NF"><input value={c.documento} onChange={set('documento')} /></Campo>
        <Campo rotulo="Valor total"><input inputMode="decimal" value={c.valor} onChange={set('valor')} required /></Campo>
        <Campo rotulo="1º vencimento"><input type="date" value={c.vencimento} onChange={set('vencimento')} required /></Campo>
        <Campo rotulo="Parcelas (mensais)"><input type="number" min="1" max="60" value={c.parcelas} onChange={set('parcelas')} /></Campo>
      </form>
    </Modal>
  );
}
