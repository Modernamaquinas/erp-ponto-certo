import { useState } from 'react';
import { supabase, api, ou } from '../lib/supabase.js';
import { moeda, numero, data, hoje, somarDias } from '../lib/formato.js';
import { navegar } from '../lib/contexto.js';
import { imprimirHtml } from '../lib/impressao.js';
import { htmlOrcamento } from '../lib/documentos.js';
import { Pagina, Filtros, Campo, Tabela, Paginacao, Modal, Etiqueta, Detalhes, useConsulta, useAvisar } from '../componentes/ui.jsx';

const POR_PAGINA = 50;
const STATUS = { aberto: ['info', 'Aberto'], convertido: ['ok', 'Virou venda'], cancelado: ['neutra', 'Cancelado'] };

export default function Orcamentos() {
  const [f, setF] = useState({ de: somarDias(hoje(), -60), ate: hoje(), status: 'aberto', numero: '' });
  const [pagina, setPagina] = useState(1);
  const [aberto, setAberto] = useState(null);
  const mudar = (k) => (e) => { setPagina(1); setF((x) => ({ ...x, [k]: e.target.value })); };
  const lista = useConsulta(async () => {
    const de = (pagina - 1) * POR_PAGINA;
    let q = supabase.from('orcamentos').select('*, clientes(nome), operadores(nome)', { count: 'exact' });
    if (f.numero) q = q.eq('id', Number(f.numero));
    else {
      q = q.gte('data', f.de).lte('data', f.ate);
      if (f.status) q = q.eq('status', f.status);
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
            <option value="aberto">Abertos</option><option value="convertido">Viraram venda</option><option value="cancelado">Cancelados</option><option value="">Todos</option>
          </select>
        </Campo>
      </Filtros>
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} aoClicar={setAberto} vazio="Nenhum orçamento."
        colunas={[
          { titulo: 'Nº', campo: 'id', classe: 'cod' },
          { titulo: 'Data', render: (o) => data(o.data) },
          { titulo: 'Cliente', render: (o) => o.clientes?.nome || o.cliente_nome || 'CONSUMIDOR' },
          { titulo: 'Operador', render: (o) => o.operadores?.nome || (o.vendedor_legado ? `vendedor ${o.vendedor_legado}` : '') },
          { titulo: 'Validade', render: (o) => (o.validade ? data(o.validade) : '') },
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
  const [codigo, setCodigo] = useState('');
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
    <Modal aberto largo titulo={`Orçamento ${o.id}`} aoFechar={aoFechar}
      rodape={<>
        <button type="button" className="btn btn-sec" onClick={imprimir} disabled={!itens.dados}>Imprimir</button>
        {o.status === 'aberto' && <>
          <button type="button" className="btn btn-perigo" onClick={() => setCancelando(true)}>Cancelar</button>
          <button type="button" className="btn btn-sec" onClick={() => navegar(`/orcamento?editar=${o.id}`)}>Editar</button>
          <button type="button" className="btn btn-pri" onClick={() => navegar(`/pdv?orcamento=${o.id}`)}>Transformar em venda</button>
        </>}
        {o.venda_id && <button type="button" className="btn btn-sec" onClick={() => navegar(`/vendas?numero=${o.venda_id}`)}>Ver venda {o.venda_id}</button>}
      </>}>
      <Detalhes itens={[['Data', data(o.data)], ['Cliente', o.clientes?.nome || o.cliente_nome], ['Validade', o.validade && data(o.validade)],
        ['Produtos', moeda(o.total_produtos)], ['Desconto', Number(o.desconto) ? moeda(o.desconto) : null], ['Total', moeda(o.total)], ['Observação', o.observacao]]} />
      <Tabela linhas={itens.dados} chave="item" carregando={itens.carregando}
        colunas={[
          { titulo: 'Produto', render: (i) => <><span className="cod">{i.produto_id}</span> {i.descricao}</> },
          { titulo: 'Qtd', alinhar: 'dir', render: (i) => numero(i.quantidade) },
          { titulo: 'Unitário', alinhar: 'dir', render: (i) => moeda(i.preco_unitario) },
          { titulo: 'Total', alinhar: 'dir', render: (i) => moeda(i.total) },
        ]} />
      {cancelando && (
        <div className="filtros">
          <Campo rotulo="Código do operador"><input type="password" inputMode="numeric" maxLength={4} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} autoFocus /></Campo>
          <button type="button" className="btn btn-perigo" disabled={codigo.length !== 4} onClick={cancelar}>Confirmar cancelamento</button>
        </div>
      )}
    </Modal>
  );
}
