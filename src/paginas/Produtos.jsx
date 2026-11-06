import { useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { moeda, numero, data, filtrarBusca } from '../lib/formato.js';
import { usePerfil, podeFinanceiro } from '../lib/contexto.js';
import { Pagina, Filtros, Campo, Tabela, Paginacao, Modal, Detalhes, Etiqueta, useConsulta, useAtrasado } from '../componentes/ui.jsx';

const POR_PAGINA = 50;

export default function Produtos() {
  const verCusto = podeFinanceiro(usePerfil());
  const [termo, setTermo] = useState('');
  const [filtro, setFiltro] = useState('ativos');
  const [grupo, setGrupo] = useState('');
  const [pagina, setPagina] = useState(1);
  const [aberto, setAberto] = useState(null);
  const busca = useAtrasado(termo);

  const grupos = useConsulta(async () => ({ dados: ou(await supabase.from('grupos_produto').select('id, nome').order('nome')).data }), []);
  const lista = useConsulta(async () => {
    const de = (pagina - 1) * POR_PAGINA;
    let q = supabase.from('produtos').select('id, nome, marca, referencia, codigo_barras, unidade, preco_venda, custo, estoque, estoque_minimo, ativo', { count: 'exact' });
    if (filtro !== 'todos') q = q.eq('ativo', true);
    if (filtro === 'sem_estoque') q = q.lte('estoque', 0);
    if (filtro === 'com_estoque') q = q.gt('estoque', 0);
    if (grupo) q = q.eq('grupo_id', grupo);
    // Código de barras exato tem prioridade (leitor no balcão)
    if (/^\d{8,14}$/.test(busca.trim())) q = q.eq('codigo_barras', busca.trim());
    else q = filtrarBusca(q, busca);
    const r = ou(await q.order('nome').range(de, de + POR_PAGINA - 1));
    return { dados: r.data, total: r.count };
  }, [busca, filtro, grupo, pagina]);

  return (
    <Pagina titulo="Produtos e Preços" subtitulo="Preço e estoque vêm do DirectControl (sincronizados); alterações continuam sendo feitas lá na Fase 1">
      <Filtros>
        <Campo rotulo="Buscar (partes do nome, referência, marca ou código de barras)" largo>
          <input type="search" autoFocus value={termo} onChange={(e) => { setPagina(1); setTermo(e.target.value); }} placeholder="Ex.: abrac nylon 200" />
        </Campo>
        <Campo rotulo="Grupo">
          <select value={grupo} onChange={(e) => { setPagina(1); setGrupo(e.target.value); }}>
            <option value="">Todos</option>
            {(grupos.dados || []).map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Mostrar">
          <select value={filtro} onChange={(e) => { setPagina(1); setFiltro(e.target.value); }}>
            <option value="ativos">Ativos</option>
            <option value="com_estoque">Com estoque</option>
            <option value="sem_estoque">Sem estoque / negativo</option>
            <option value="todos">Todos (inclui inativos)</option>
          </select>
        </Campo>
      </Filtros>
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} aoClicar={setAberto}
        colunas={[
          { titulo: 'Código', campo: 'id', classe: 'cod' },
          { titulo: 'Cód. barras', campo: 'codigo_barras', classe: 'cod' },
          { titulo: 'Produto', render: (p) => <>{p.nome}{!p.ativo && <> <Etiqueta>Inativo</Etiqueta></>}</> },
          { titulo: 'Marca', campo: 'marca' },
          { titulo: 'Un', campo: 'unidade' },
          { titulo: 'Estoque', alinhar: 'dir', render: (p) => <span className={Number(p.estoque) < 0 ? 'texto-erro' : undefined}>{numero(p.estoque)}</span> },
          ...(verCusto ? [{ titulo: 'Custo', alinhar: 'dir', render: (p) => moeda(p.custo) }] : []),
          { titulo: 'Preço', alinhar: 'dir', render: (p) => <strong>{moeda(p.preco_venda)}</strong> },
        ]} />
      <Paginacao pagina={pagina} total={lista.total} porPagina={POR_PAGINA} aoMudar={setPagina} />
      {aberto && <DetalheProduto id={aberto.id} verCusto={verCusto} aoFechar={() => setAberto(null)} />}
    </Pagina>
  );
}

function DetalheProduto({ id, verCusto, aoFechar }) {
  const d = useConsulta(async () => {
    const [p, forn, compras] = await Promise.all([
      supabase.from('produtos').select('*, grupos_produto(nome), subgrupos_produto(nome)').eq('id', id).single().then(ou),
      supabase.from('produto_fornecedores').select('*, fornecedores(nome)').eq('produto_id', id).order('data', { ascending: false }).limit(10).then(ou),
      supabase.from('compra_itens').select('quantidade, custo_unitario, compras(id, data_emissao, numero_nota, fornecedores(nome))').eq('produto_id', id).limit(30).then(ou),
    ]);
    const ultimas = compras.data.filter((c) => c.compras).sort((a, b) => (b.compras.data_emissao || '').localeCompare(a.compras.data_emissao || '')).slice(0, 8).map((c, key) => ({ ...c, key }));
    return { dados: { p: p.data, forn: forn.data, compras: ultimas } };
  }, [id]);
  const p = d.dados?.p;

  return (
    <Modal aberto largo titulo={p ? p.nome : 'Produto'} aoFechar={aoFechar}>
      {!p ? <p>Carregando…</p> : <>
        <Detalhes itens={[
          ['Código', p.id], ['Código de barras', p.codigo_barras], ['Referência', p.referencia], ['Marca', p.marca], ['Unidade', p.unidade],
          ['Grupo', [p.grupos_produto?.nome, p.subgrupos_produto?.nome].filter(Boolean).join(' › ')],
          ['Preço de venda', moeda(p.preco_venda)],
          ['Preço atacado', p.preco_atacado ? `${moeda(p.preco_atacado)} a partir de ${numero(p.qtd_atacado)}` : null],
          ...(verCusto ? [['Custo', moeda(p.custo)], ['Custo médio', moeda(p.custo_medio)], ['Margem', p.margem && `${numero(p.margem)}%`]] : []),
          ['Estoque', numero(p.estoque)], ['Estoque mínimo', numero(p.estoque_minimo)],
          ['NCM', p.ncm], ['CEST', p.cest], ['CFOP', p.cfop], ['CST/CSOSN', p.cst_csosn],
          ['Última entrada', data(p.data_ultima_entrada)], ['Última saída', data(p.data_ultima_saida)], ['Utilização', p.utilizacao],
        ]} />
        {verCusto && d.dados.compras.length > 0 && <>
          <h3>Últimas compras</h3>
          <Tabela linhas={d.dados.compras} chave="key" colunas={[
            { titulo: 'Data', render: (c) => data(c.compras.data_emissao) },
            { titulo: 'Fornecedor', render: (c) => c.compras.fornecedores?.nome },
            { titulo: 'NF', render: (c) => c.compras.numero_nota },
            { titulo: 'Qtd', alinhar: 'dir', render: (c) => numero(c.quantidade) },
            { titulo: 'Custo unit.', alinhar: 'dir', render: (c) => moeda(c.custo_unitario) },
          ]} />
        </>}
        {d.dados.forn.length > 0 && <>
          <h3>Fornecedores</h3>
          <Tabela linhas={d.dados.forn} colunas={[
            { titulo: 'Fornecedor', render: (f) => f.fornecedores?.nome },
            { titulo: 'Código no fornecedor', campo: 'codigo_no_fornecedor' },
            ...(verCusto ? [{ titulo: 'Preço', alinhar: 'dir', render: (f) => moeda(f.preco_custo) }] : []),
            { titulo: 'Data', render: (f) => data(f.data) },
          ]} />
        </>}
      </>}
    </Modal>
  );
}
