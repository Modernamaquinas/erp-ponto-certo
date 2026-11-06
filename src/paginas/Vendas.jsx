import { useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { moeda, numero, data, hoje, inicioDoMes, documento } from '../lib/formato.js';
import { Pagina, Filtros, Campo, Tabela, Paginacao, Modal, Detalhes, Etiqueta, useConsulta } from '../componentes/ui.jsx';

const POR_PAGINA = 50;
const SITUACAO = { finalizada: ['ok', 'Finalizada'], estornada: ['erro', 'Estornada'], cancelada: ['neutra', 'Cancelada'], aberta: ['alerta', 'Não finalizada'] };

export default function Vendas({ params }) {
  const [f, setF] = useState({ de: params.cliente ? '' : inicioDoMes(), ate: params.cliente ? '' : hoje(), situacao: 'finalizada', cliente: params.cliente || '', numero: '' });
  const [pagina, setPagina] = useState(1);
  const [aberta, setAberta] = useState(null);
  const mudar = (k) => (e) => { setPagina(1); setF((x) => ({ ...x, [k]: e.target.value })); };

  const aplicar = (q) => {
    if (f.numero) return q.eq('id', Number(f.numero));
    if (f.de) q = q.gte('data', f.de);
    if (f.ate) q = q.lte('data', f.ate);
    if (f.situacao !== 'todas') q = q.eq('situacao', f.situacao);
    if (f.cliente) q = q.eq('cliente_id', f.cliente);
    return q;
  };
  const lista = useConsulta(async () => {
    const de = (pagina - 1) * POR_PAGINA;
    const r = ou(await aplicar(supabase.from('vendas').select('*, clientes(nome)', { count: 'exact' }))
      .order('data', { ascending: false }).order('hora', { ascending: false }).range(de, de + POR_PAGINA - 1));
    return { dados: r.data, total: r.count };
  }, [f, pagina]);
  const total = useConsulta(async () => {
    const r = ou(await aplicar(supabase.from('vendas').select('soma:total.sum()')));
    return { dados: Number(r.data[0]?.soma || 0) };
  }, [f]);

  return (
    <Pagina titulo="Vendas" subtitulo="Histórico importado do DirectControl (o PDV continua lá até a Fase 2)">
      <Filtros>
        <Campo rotulo="Nº da venda"><input inputMode="numeric" value={f.numero} onChange={mudar('numero')} /></Campo>
        <Campo rotulo="De"><input type="date" value={f.de} onChange={mudar('de')} /></Campo>
        <Campo rotulo="Até"><input type="date" value={f.ate} onChange={mudar('ate')} /></Campo>
        <Campo rotulo="Situação">
          <select value={f.situacao} onChange={mudar('situacao')}>
            <option value="finalizada">Finalizadas</option>
            <option value="estornada">Estornadas</option>
            <option value="todas">Todas</option>
          </select>
        </Campo>
        {f.cliente && <button type="button" className="btn btn-sec btn-peq" onClick={() => setF((x) => ({ ...x, cliente: '' }))}>Cliente {f.cliente} ×</button>}
      </Filtros>
      <div className="resumo-linha">
        <span>Total: <strong>{moeda(total.dados)}</strong></span>
        <span>{lista.total} venda(s)</span>
        {lista.total > 0 && <span>Ticket médio: <strong>{moeda(Number(total.dados || 0) / lista.total)}</strong></span>}
      </div>
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} aoClicar={setAberta}
        colunas={[
          { titulo: 'Venda', campo: 'id', classe: 'cod' },
          { titulo: 'Data', render: (v) => `${data(v.data)} ${v.hora ? v.hora.slice(0, 5) : ''}` },
          { titulo: 'Cliente', render: (v) => (v.cliente_id === 1 || !v.clientes ? (v.cliente_nome || 'AO CONSUMIDOR') : v.clientes.nome) },
          { titulo: 'NFC-e', render: (v) => v.numero_nfce || '' },
          { titulo: 'Total', alinhar: 'dir', render: (v) => moeda(v.total) },
          { titulo: 'Situação', render: (v) => <Etiqueta tipo={SITUACAO[v.situacao][0]}>{SITUACAO[v.situacao][1]}</Etiqueta> },
        ]} />
      <Paginacao pagina={pagina} total={lista.total} porPagina={POR_PAGINA} aoMudar={setPagina} />
      {aberta && <DetalheVenda v={aberta} aoFechar={() => setAberta(null)} />}
    </Pagina>
  );
}

function DetalheVenda({ v, aoFechar }) {
  const d = useConsulta(async () => {
    const [itens, pgtos] = await Promise.all([
      supabase.from('venda_itens').select('*').eq('venda_id', v.id).order('item').then(ou),
      supabase.from('venda_pagamentos').select('*, formas_pagamento(descricao)').eq('venda_id', v.id).order('item').then(ou),
    ]);
    return { dados: { itens: itens.data, pgtos: pgtos.data } };
  }, [v.id]);

  return (
    <Modal aberto largo titulo={`Venda ${v.id}`} aoFechar={aoFechar}>
      <Detalhes itens={[
        ['Data', `${data(v.data)} ${v.hora || ''}`], ['Cliente', v.clientes?.nome || v.cliente_nome], ['CPF na nota', documento(v.cpf_nota)],
        ['Produtos', moeda(v.total_produtos)], ['Desconto', Number(v.desconto) ? moeda(v.desconto) : null],
        ['Acréscimo', Number(v.acrescimo) ? moeda(v.acrescimo) : null], ['Total', moeda(v.total)],
        ['NFC-e', v.numero_nfce], ['NF-e', v.numero_nfe], ['Caixa', v.num_caixa], ['Observação', v.observacao],
      ]} />
      <h3>Itens</h3>
      <Tabela linhas={d.dados?.itens} chave="item" carregando={d.carregando}
        colunas={[
          { titulo: '#', campo: 'item' },
          { titulo: 'Produto', render: (i) => <><span className="cod">{i.produto_id}</span> {i.descricao}</> },
          { titulo: 'Qtd', alinhar: 'dir', render: (i) => numero(i.quantidade) },
          { titulo: 'Unitário', alinhar: 'dir', render: (i) => moeda(i.preco_unitario) },
          { titulo: 'Total', alinhar: 'dir', render: (i) => moeda(i.total) },
        ]} />
      <h3>Pagamento</h3>
      <Tabela linhas={d.dados?.pgtos} chave="item" carregando={d.carregando}
        colunas={[
          { titulo: 'Forma', render: (p) => p.formas_pagamento?.descricao },
          { titulo: 'Parcelas', alinhar: 'centro', render: (p) => p.parcelas || '' },
          { titulo: 'Valor', alinhar: 'dir', render: (p) => moeda(p.valor) },
        ]} />
    </Modal>
  );
}
