import { useState } from 'react';
import { supabase, api, ou } from '../lib/supabase.js';
import { moeda, numero, data, hoje, somarDias } from '../lib/formato.js';
import { navegar } from '../lib/contexto.js';
import { imprimirHtml } from '../lib/impressao.js';
import { htmlOrcamento } from '../lib/documentos.js';
import { Pagina, Filtros, Campo, Tabela, Paginacao, Modal, Etiqueta, Detalhes, Aviso, useConsulta, useAvisar } from '../componentes/ui.jsx';

const POR_PAGINA = 50;
export const STATUS_ORC = { aberto: ['info', 'Aberto'], convertido: ['ok', 'Virou venda'], cancelado: ['neutra', 'Cancelado'],
  consignado: ['alerta', 'Com o cliente (consignado)'], reservado: ['alerta', 'Reservado'], devolvido: ['neutra', 'Devolvido'] };
const STATUS = STATUS_ORC;
export const TIPO_ORC = { prevenda: 'pré-venda', consignado: 'consignado', reserva: 'reserva' };

export default function Orcamentos() {
  const [f, setF] = useState({ de: somarDias(hoje(), -60), ate: hoje(), status: 'aberto', numero: '', tipo: '' });
  const [pagina, setPagina] = useState(1);
  const [aberto, setAberto] = useState(null);
  const mudar = (k) => (e) => { setPagina(1); setF((x) => ({ ...x, [k]: e.target.value })); };
  const lista = useConsulta(async () => {
    const de = (pagina - 1) * POR_PAGINA;
    let q = supabase.from('orcamentos').select('*, clientes(nome), operadores(nome)', { count: 'exact' });
    if (f.numero) q = q.eq('id', Number(f.numero));
    else {
      // consignados e reservas em aberto aparecem mesmo que sejam antigos
      if (!['consignado', 'reservado'].includes(f.status)) q = q.gte('data', f.de).lte('data', f.ate);
      if (f.status === 'aberto') q = q.in('status', ['aberto', 'consignado', 'reservado']);
      else if (f.status) q = q.eq('status', f.status);
      if (f.tipo) q = q.eq('tipo', f.tipo);
    }
    const r = ou(await q.order('data', { ascending: false }).order('id', { ascending: false }).range(de, de + POR_PAGINA - 1));
    return { dados: r.data, total: r.count };
  }, [f, pagina]);

  return (
    <Pagina titulo="Orçamentos" subtitulo="Orçamentos do balcão (os do DirectControl vêm pela sincronização)"
      acoes={<button type="button" className="btn btn-pri" onClick={() => navegar('/orcamento')}>Novo orçamento</button>}>
      <Filtros>
        <Campo rotulo="Nº"><input inputMode="numeric" value={f.numero} onChange={mudar('numero')} /></Campo>
        <Campo rotulo="De"><input type="date" value={f.de} onChange={mudar('de')} /></Campo>
        <Campo rotulo="Até"><input type="date" value={f.ate} onChange={mudar('ate')} /></Campo>
        <Campo rotulo="Situação">
          <select value={f.status} onChange={mudar('status')}>
            <option value="aberto">Em aberto (inclui consignados e reservas)</option><option value="consignado">Consignados com o cliente</option>
            <option value="reservado">Reservas</option><option value="convertido">Viraram venda</option><option value="devolvido">Consignados devolvidos</option>
            <option value="cancelado">Cancelados</option><option value="">Todos</option>
          </select>
        </Campo>
        <Campo rotulo="Tipo">
          <select value={f.tipo} onChange={mudar('tipo')}>
            <option value="">Todos</option><option value="orcamento">Orçamentos</option><option value="reserva">Reservas</option>
            <option value="consignado">Consignados</option><option value="prevenda">Pré-vendas</option>
          </select>
        </Campo>
      </Filtros>
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} aoClicar={setAberto} vazio="Nenhum orçamento."
        colunas={[
          { titulo: 'Nº', render: (o) => <><span className="cod">{o.id}</span>{TIPO_ORC[o.tipo] && <> <Etiqueta tipo={o.tipo === 'prevenda' ? 'info' : 'alerta'}>{TIPO_ORC[o.tipo]}</Etiqueta></>}</> },
          { titulo: 'Data', render: (o) => data(o.data) },
          { titulo: 'Cliente', render: (o) => o.clientes?.nome || o.cliente_nome || 'CONSUMIDOR' },
          { titulo: 'Operador', render: (o) => o.operadores?.nome || (o.vendedor_legado ? `vendedor ${o.vendedor_legado}` : '') },
          { titulo: 'Validade / acerto', render: (o) => (o.validade ? <span className={['consignado', 'reservado'].includes(o.status) && o.validade < hoje() ? 'texto-erro' : ''}>{data(o.validade)}</span> : '') },
          { titulo: 'Total', alinhar: 'dir', render: (o) => moeda(o.total) },
          { titulo: 'Situação', render: (o) => <Etiqueta tipo={STATUS[o.status][0]}>{STATUS[o.status][1]}</Etiqueta> },
        ]} />
      <Paginacao pagina={pagina} total={lista.total} porPagina={POR_PAGINA} aoMudar={setPagina} />
      {aberto && <DetalheOrcamento o={aberto} aoFechar={() => setAberto(null)} aoMudar={() => { setAberto(null); lista.recarregar(); }} />}
    </Pagina>
  );
}

function DetalheOrcamento({ o, aoFechar, aoMudar }) {
  const avisar = useAvisar();
  const [cancelando, setCancelando] = useState(false);
  const [devolvendo, setDevolvendo] = useState(false);
  const [codigo, setCodigo] = useState('');
  const separado = ['consignado', 'reservado'].includes(o.status);
  const nomeTipo = { consignado: 'Consignado', reserva: 'Reserva', prevenda: 'Pré-venda' }[o.tipo] || 'Orçamento';
  async function devolver() {
    try {
      await api('pdv', { corpo: { acao: 'consignado_devolver', codigo, id: o.id } });
      avisar(o.tipo === 'consignado' ? 'Consignado devolvido: itens de volta ao estoque.' : 'Reserva liberada: itens de volta ao estoque.');
      aoMudar();
    } catch (e) { avisar(e.message, 'erro'); }
  }
  const itens = useConsulta(async () => ({ dados: ou(await supabase.from('orcamento_itens').select('*').eq('orcamento_id', o.id).order('item')).data }), [o.id]);
  async function cancelar() {
    try {
      await api('pdv', { corpo: { acao: 'orcamento_cancelar', codigo, id: o.id } });
      avisar('Orçamento cancelado.');
      aoMudar();
    } catch (e) { avisar(e.message, 'erro'); }
  }
  const imprimir = () => imprimirHtml(htmlOrcamento({ ...o, cliente_nome: o.clientes?.nome || o.cliente_nome }, itens.dados || []), { titulo: `Orçamento ${o.id}` });
  return (
    <Modal aberto largo titulo={`${nomeTipo} ${o.id}`} aoFechar={aoFechar}
      rodape={<>
        <button type="button" className="btn btn-sec" onClick={imprimir} disabled={!itens.dados}>Imprimir</button>
        {o.status === 'aberto' && <>
          <button type="button" className="btn btn-perigo" onClick={() => setCancelando(true)}>Cancelar</button>
          <button type="button" className="btn btn-sec" onClick={() => navegar(`/orcamento?editar=${o.id}`)}>Editar</button>
          <button type="button" className="btn btn-pri" onClick={() => navegar(`/pdv?orcamento=${o.id}`)}>Transformar em venda</button>
        </>}
        {separado && <>
          <button type="button" className="btn btn-perigo" onClick={() => setDevolvendo(true)}>{o.tipo === 'consignado' ? 'Devolveu tudo' : 'Liberar reserva'}</button>
          <button type="button" className="btn btn-pri" onClick={() => navegar(`/pdv?orcamento=${o.id}`)}>{o.tipo === 'consignado' ? 'Acertar (o que ficou vira venda)' : 'Vender a reserva'}</button>
        </>}
        {o.venda_id && <button type="button" className="btn btn-sec" onClick={() => navegar(`/vendas?numero=${o.venda_id}`)}>Ver venda {o.venda_id}</button>}
      </>}>
      <Detalhes itens={[['Data', data(o.data)], ['Cliente', o.clientes?.nome || o.cliente_nome], ['Validade', o.validade && data(o.validade)],
        ['Situação', STATUS[o.status][1]], ['Entregue em', o.consignado_em && new Date(o.consignado_em).toLocaleString('pt-BR')],
        ['Acertado em', o.acertado_em && new Date(o.acertado_em).toLocaleString('pt-BR')], ['Produtos', moeda(o.total_produtos)], ['Desconto', Number(o.desconto) ? moeda(o.desconto) : null], ['Total', moeda(o.total)], ['Observação', o.observacao]]} />
      <Tabela linhas={itens.dados} chave="item" carregando={itens.carregando}
        colunas={[
          { titulo: 'Produto', render: (i) => <><span className="cod">{i.produto_id}</span> {i.descricao}</> },
          { titulo: 'Qtd', alinhar: 'dir', render: (i) => numero(i.quantidade) },
          ...(['consignado', 'reserva'].includes(o.tipo) && ['convertido', 'devolvido', 'cancelado'].includes(o.status)
            ? [{ titulo: 'Devolvido', alinhar: 'dir', render: (i) => (i.quantidade_devolvida === null ? '' : numero(i.quantidade_devolvida)) },
               { titulo: 'Vendido', alinhar: 'dir', render: (i) => (i.quantidade_devolvida === null ? '' : numero(Number(i.quantidade) - Number(i.quantidade_devolvida))) }] : []),
          { titulo: 'Unitário', alinhar: 'dir', render: (i) => moeda(i.preco_unitario) },
          { titulo: 'Total', alinhar: 'dir', render: (i) => moeda(i.total) },
        ]} />
      {devolvendo && (
        <div className="filtros">
          <Aviso tipo="alerta">{o.tipo === 'consignado' ? 'Todos os itens voltam ao estoque e o consignado é encerrado sem venda.' : 'Os itens voltam ao estoque disponível.'}</Aviso>
          <Campo rotulo="Código do operador"><input type="password" inputMode="numeric" maxLength={4} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} autoFocus /></Campo>
          <button type="button" className="btn btn-perigo" disabled={codigo.length !== 4} onClick={devolver}>Confirmar</button>
        </div>
      )}
      {cancelando && (
        <div className="filtros">
          <Campo rotulo="Código do operador"><input type="password" inputMode="numeric" maxLength={4} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} autoFocus /></Campo>
          <button type="button" className="btn btn-perigo" disabled={codigo.length !== 4} onClick={cancelar}>Confirmar cancelamento</button>
        </div>
      )}
    </Modal>
  );
}
