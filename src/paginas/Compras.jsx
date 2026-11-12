import { useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { moeda, numero, data, normalizaBusca } from '../lib/formato.js';
import { navegar, usePerfil, podeFinanceiro } from '../lib/contexto.js';
import { Pagina, Filtros, Campo, Tabela, Paginacao, Modal, Detalhes, useConsulta, useAtrasado } from '../componentes/ui.jsx';

const POR_PAGINA = 50;

export default function Compras() {
  const fin = podeFinanceiro(usePerfil());
  const [termo, setTermo] = useState('');
  const [f, setF] = useState({ de: '', ate: '' });
  const [pagina, setPagina] = useState(1);
  const [aberta, setAberta] = useState(null);
  const busca = useAtrasado(termo);

  const lista = useConsulta(async () => {
    const de = (pagina - 1) * POR_PAGINA;
    const t = busca.trim();
    const porFornecedor = t && !/^\d+$/.test(t);
    let q = supabase.from('compras').select(`*, ${porFornecedor ? 'fornecedores!inner(nome, busca)' : 'fornecedores(nome)'}`, { count: 'exact' });
    if (t && /^\d{44}$/.test(t)) q = q.eq('chave_nfe', t);
    else if (t && /^\d+$/.test(t)) q = q.eq('numero_nota', t);
    else for (const p of normalizaBusca(t).split(/\s+/).filter(Boolean)) q = q.ilike('fornecedores.busca', `%${p}%`);
    if (f.de) q = q.gte('data_emissao', f.de);
    if (f.ate) q = q.lte('data_emissao', f.ate);
    const r = ou(await q.order('data_emissao', { ascending: false }).order('id', { ascending: false }).range(de, de + POR_PAGINA - 1));
    return { dados: r.data, total: r.count };
  }, [busca, f, pagina]);

  return (
    <Pagina titulo="Notas de Compra" subtitulo="Entradas lançadas no DirectControl e no ERP"
      acoes={fin && <><a className="btn btn-sec" href="#/compras/lista">Lista de compras</a><a className="btn btn-pri" href="#/compras/entrada">Entrada de nota (XML / chave)</a></>}>
      <Filtros>
        <Campo rotulo="Nº da nota, chave da NF-e ou fornecedor" largo>
          <input type="search" value={termo} onChange={(e) => { setPagina(1); setTermo(e.target.value); }} />
        </Campo>
        <Campo rotulo="Emissão de"><input type="date" value={f.de} onChange={(e) => { setPagina(1); setF({ ...f, de: e.target.value }); }} /></Campo>
        <Campo rotulo="até"><input type="date" value={f.ate} onChange={(e) => { setPagina(1); setF({ ...f, ate: e.target.value }); }} /></Campo>
      </Filtros>
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} aoClicar={setAberta}
        colunas={[
          { titulo: 'Nº nota', campo: 'numero_nota', classe: 'cod' },
          { titulo: 'Série', campo: 'serie', alinhar: 'centro' },
          { titulo: 'Emissão', render: (c) => data(c.data_emissao) },
          { titulo: 'Fornecedor', render: (c) => c.fornecedores?.nome },
          { titulo: 'Total', alinhar: 'dir', render: (c) => moeda(c.valor_total) },
        ]} />
      <Paginacao pagina={pagina} total={lista.total} porPagina={POR_PAGINA} aoMudar={setPagina} />
      {aberta && <DetalheCompra c={aberta} aoFechar={() => setAberta(null)} />}
    </Pagina>
  );
}

function DetalheCompra({ c, aoFechar }) {
  const itens = useConsulta(async () => ({ dados: ou(await supabase.from('compra_itens').select('*').eq('compra_id', c.id).order('item')).data }), [c.id]);
  return (
    <Modal aberto largo titulo={`NF ${c.numero_nota || c.id} — ${c.fornecedores?.nome || ''}`} aoFechar={aoFechar}
      rodape={<button type="button" className="btn btn-pri" onClick={() => navegar(`/etiquetas?compra=${c.id}`)}>Imprimir etiquetas</button>}>
      <Detalhes itens={[
        ['Emissão', data(c.data_emissao)], ['Entrada', data(c.data_entrada)], ['Chave NF-e', c.chave_nfe],
        ['Produtos', moeda(c.valor_produtos)], ['Frete', Number(c.valor_frete) ? moeda(c.valor_frete) : null],
        ['IPI', Number(c.valor_ipi) ? moeda(c.valor_ipi) : null], ['ICMS ST', Number(c.valor_st) ? moeda(c.valor_st) : null],
        ['Desconto', Number(c.desconto) ? moeda(c.desconto) : null], ['Total da nota', moeda(c.valor_total)],
      ]} />
      <h3>Itens</h3>
      <Tabela linhas={itens.dados} chave="item" carregando={itens.carregando}
        colunas={[
          { titulo: '#', campo: 'item' },
          { titulo: 'Produto', render: (i) => <><span className="cod">{i.produto_id}</span> {i.descricao}</> },
          { titulo: 'NCM', campo: 'ncm' },
          { titulo: 'Qtd', alinhar: 'dir', render: (i) => numero(i.quantidade) },
          { titulo: 'Custo unit.', alinhar: 'dir', render: (i) => moeda(i.custo_unitario) },
          { titulo: 'Total', alinhar: 'dir', render: (i) => moeda(i.total) },
        ]} />
    </Modal>
  );
}
