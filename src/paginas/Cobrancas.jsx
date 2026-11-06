import { useState } from 'react';
import { supabase, api, ou } from '../lib/supabase.js';
import { moeda, data, dataHora, linkWhatsApp } from '../lib/formato.js';
import { navegar } from '../lib/contexto.js';
import { Pagina, Filtros, Campo, Tabela, Paginacao, Modal, Etiqueta, Aviso, Detalhes, useConsulta, useSelecao, useAvisar } from '../componentes/ui.jsx';

const POR_PAGINA = 50;
const STATUS = {
  pendente: ['info', 'Pendente'], vencida: ['erro', 'Vencida'], paga: ['ok', 'Paga'],
  cancelada: ['neutra', 'Cancelada'], estornada: ['alerta', 'Estornada'], erro: ['erro', 'Erro'],
};
const etiqueta = (s) => <Etiqueta tipo={STATUS[s]?.[0]}>{STATUS[s]?.[1] || s}</Etiqueta>;

const ABAS = [
  ['cobrancas', 'Cobranças'],
  ['replicar', 'Baixas a repetir no DirectControl'],
  ['conflitos', 'Conflitos'],
];

export default function Cobrancas({ params }) {
  const aba = params.aba || 'cobrancas';
  return (
    <Pagina titulo="Cobranças Asaas" subtitulo="Boleto + PIX com baixa automática do crediário">
      <div className="abas" role="tablist">
        {ABAS.map(([id, rotulo]) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} className={`aba${aba === id ? ' ativa' : ''}`}
            onClick={() => navegar(id === 'cobrancas' ? '/cobrancas' : `/cobrancas?aba=${id}`)}>{rotulo}</button>
        ))}
      </div>
      {aba === 'cobrancas' && <ListaCobrancas />}
      {aba === 'replicar' && <BaixasAReplicar />}
      {aba === 'conflitos' && <Conflitos />}
    </Pagina>
  );
}

function ListaCobrancas() {
  const [status, setStatus] = useState('abertas');
  const [pagina, setPagina] = useState(1);
  const [aberta, setAberta] = useState(null);
  const lista = useConsulta(async () => {
    const de = (pagina - 1) * POR_PAGINA;
    let q = supabase.from('cobrancas').select('*, clientes(nome, celular, celular_cobranca)', { count: 'exact' });
    if (status === 'abertas') q = q.in('status', ['pendente', 'vencida']);
    else if (status !== 'todas') q = q.eq('status', status);
    const r = ou(await q.order('criado_em', { ascending: false }).range(de, de + POR_PAGINA - 1));
    return { dados: r.data, total: r.count };
  }, [status, pagina]);

  return (
    <>
      <Filtros>
        <Campo rotulo="Situação">
          <select value={status} onChange={(e) => { setPagina(1); setStatus(e.target.value); }}>
            <option value="abertas">Pendentes e vencidas</option>
            <option value="paga">Pagas</option>
            <option value="cancelada">Canceladas</option>
            <option value="erro">Com erro</option>
            <option value="todas">Todas</option>
          </select>
        </Campo>
      </Filtros>
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} aoClicar={setAberta}
        vazio="Nenhuma cobrança. Gere cobranças em Contas a Receber."
        colunas={[
          { titulo: 'Criada', render: (c) => dataHora(c.criado_em) },
          { titulo: 'Cliente', render: (c) => <><span className="cod">{c.cliente_id}</span> {c.clientes?.nome}</> },
          { titulo: 'Títulos', alinhar: 'centro', render: (c) => c.titulos.length },
          { titulo: 'Vencimento', render: (c) => data(c.vencimento) },
          { titulo: 'Valor', alinhar: 'dir', render: (c) => moeda(c.valor) },
          { titulo: 'Situação', render: (c) => etiqueta(c.status) },
          { titulo: 'Pago em', render: (c) => (c.data_pagamento ? `${data(c.data_pagamento)} · ${c.tipo_pagamento || ''}` : '') },
        ]} />
      <Paginacao pagina={pagina} total={lista.total} porPagina={POR_PAGINA} aoMudar={setPagina} />
      {aberta && <DetalheCobranca cobranca={aberta} aoFechar={() => setAberta(null)} aoAlterar={() => { setAberta(null); lista.recarregar(); }} />}
    </>
  );
}

function DetalheCobranca({ cobranca, aoFechar, aoAlterar }) {
  const avisar = useAvisar();
  const [c, setC] = useState(cobranca);
  const [ocupado, setOcupado] = useState('');
  const celular = c.clientes?.celular_cobranca || c.clientes?.celular;
  const aberta = ['pendente', 'vencida'].includes(c.status);

  async function acao(nome) {
    if (nome === 'cancelar' && !window.confirm('Cancelar esta cobrança no Asaas? Os títulos voltam a ficar livres para nova cobrança ou baixa.')) return;
    setOcupado(nome);
    try {
      const r = await api('cobrancas', { corpo: { acao: nome, id: c.id } });
      setC({ ...c, ...r.cobranca });
      avisar(nome === 'cancelar' ? 'Cobrança cancelada.' : 'Situação atualizada pelo Asaas.');
      if (nome === 'cancelar') aoAlterar();
    } catch (e) {
      avisar(e.message, 'erro');
    }
    setOcupado('');
  }

  async function copiar(texto, oque) {
    try {
      await navigator.clipboard.writeText(texto);
      avisar(`${oque} copiado.`);
    } catch {
      avisar('Não foi possível copiar.', 'erro');
    }
  }

  const mensagem = `Olá! Segue a cobrança do seu crediário na Ponto Certo Ferragens, no valor de ${moeda(c.valor)} com vencimento em ${data(c.vencimento)}.\n\nPague por boleto ou PIX neste link: ${c.link_fatura}\n\nObrigado!`;
  const whats = c.link_fatura && linkWhatsApp(celular, mensagem);

  return (
    <Modal aberto largo titulo={`Cobrança ${c.id} — ${c.clientes?.nome || ''}`} aoFechar={aoFechar}
      rodape={<>
        {c.asaas_payment_id && <button type="button" className="btn btn-sec" disabled={!!ocupado} onClick={() => acao('atualizar')}>{ocupado === 'atualizar' ? 'Consultando…' : 'Atualizar do Asaas'}</button>}
        {(aberta || c.status === 'erro') && <button type="button" className="btn btn-perigo" disabled={!!ocupado} onClick={() => acao('cancelar')}>{ocupado === 'cancelar' ? 'Cancelando…' : 'Cancelar cobrança'}</button>}
      </>}>
      {c.erro && <Aviso tipo="erro">{c.erro}</Aviso>}
      <Detalhes itens={[
        ['Situação', etiqueta(c.status)], ['Valor', moeda(c.valor)], ['Vencimento', data(c.vencimento)],
        ['Pago em', data(c.data_pagamento)], ['Valor pago', c.valor_pago && moeda(c.valor_pago)],
        ['Líquido recebido', c.valor_liquido && moeda(c.valor_liquido)], ['Forma', c.tipo_pagamento],
        ['Descrição', c.descricao], ['ID no Asaas', c.asaas_payment_id],
        ['Títulos', <a key="t" href={`#/receber?cliente=${c.cliente_id}&situacao=todos`}>{c.titulos.join(', ')}</a>],
      ]} />
      {aberta && c.link_fatura && (
        <div className="botoes-cobranca">
          <a className="btn btn-pri" href={c.link_fatura} target="_blank" rel="noreferrer">Abrir fatura</a>
          {whats ? <a className="btn btn-whats" href={whats} target="_blank" rel="noreferrer">Enviar pelo WhatsApp</a>
            : <span className="ajuda">Cliente sem celular cadastrado para WhatsApp.</span>}
          {c.pix_copia_cola && <button type="button" className="btn btn-sec" onClick={() => copiar(c.pix_copia_cola, 'PIX copia e cola')}>Copiar PIX</button>}
          {c.linha_digitavel && <button type="button" className="btn btn-sec" onClick={() => copiar(c.linha_digitavel, 'Linha digitável')}>Copiar linha digitável</button>}
          {c.link_boleto && <a className="btn btn-sec" href={c.link_boleto} target="_blank" rel="noreferrer">PDF do boleto</a>}
        </div>
      )}
    </Modal>
  );
}

function BaixasAReplicar() {
  const avisar = useAvisar();
  const sel = useSelecao();
  const lista = useConsulta(async () => {
    const r = ou(await supabase.from('contas_receber').select('*, clientes(nome)').eq('baixa_replicada_legado', false)
      .order('data_pagamento').limit(1000));
    return { dados: r.data };
  }, []);

  async function marcar() {
    try {
      ou(await supabase.from('contas_receber').update({ baixa_replicada_legado: true }).in('id', [...sel.selecionados]));
      avisar('Marcado como baixado no DirectControl.');
      sel.limpar();
      lista.recarregar();
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  return (
    <>
      <Aviso>
        Enquanto o caixa roda no DirectControl, títulos pagos pelo Asaas ou baixados aqui continuam em aberto lá. Dê a baixa
        no DirectControl (Contas a Receber → Recebe Conta) e marque aqui. A sincronização também limpa esta lista sozinha quando
        encontra o título quitado no DirectControl.
      </Aviso>
      <div className="barra-acoes">
        <button type="button" className="btn btn-pri" disabled={!sel.selecionados.size} onClick={marcar}>
          Já baixei no DirectControl ({sel.selecionados.size})
        </button>
      </div>
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} selecao={sel} vazio="Nada pendente."
        colunas={[
          { titulo: 'Título', campo: 'id' },
          { titulo: 'Cliente', render: (l) => <><span className="cod">{l.cliente_id}</span> {l.clientes?.nome}</> },
          { titulo: 'Histórico (no DirectControl)', render: (l) => l.historico || l.documento },
          { titulo: 'Vencimento', render: (l) => data(l.vencimento) },
          { titulo: 'Pago em', render: (l) => data(l.data_pagamento) },
          { titulo: 'Via', render: (l) => (l.baixa_origem === 'asaas' ? <Etiqueta tipo="marca">Asaas</Etiqueta> : <Etiqueta>Manual</Etiqueta>) },
          { titulo: 'Valor pago', alinhar: 'dir', render: (l) => moeda(l.valor_pago) },
        ]} />
    </>
  );
}

function Conflitos() {
  const avisar = useAvisar();
  const lista = useConsulta(async () => ({ dados: ou(await supabase.from('v_cobrancas_conflito').select('*')).data }), []);

  async function cancelar(id) {
    try {
      await api('cobrancas', { corpo: { acao: 'cancelar', id } });
      avisar('Cobrança cancelada no Asaas.');
      lista.recarregar();
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  return (
    <>
      <Aviso>Cobranças Asaas ainda abertas cujos títulos já foram recebidos no balcão (DirectControl). Cancele para o cliente não pagar duas vezes; se só parte dos títulos foi paga, cancele e gere uma nova cobrança com o restante.</Aviso>
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} chave="cobranca_id" vazio="Nenhum conflito."
        colunas={[
          { titulo: 'Cobrança', campo: 'cobranca_id' },
          { titulo: 'Cliente', render: (l) => <><span className="cod">{l.cliente_id}</span> {l.nome}</> },
          { titulo: 'Valor', alinhar: 'dir', render: (l) => moeda(l.valor) },
          { titulo: 'Títulos já pagos', render: (l) => l.titulos_pagos_no_balcao.join(', ') },
          { titulo: '', render: (l) => <button type="button" className="btn btn-perigo btn-peq" onClick={() => cancelar(l.cobranca_id)}>Cancelar no Asaas</button> },
        ]} />
    </>
  );
}
