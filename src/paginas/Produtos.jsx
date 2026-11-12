import { useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { moeda, numero, data, filtrarBusca } from '../lib/formato.js';
import { usePerfil, podeFinanceiro, navegar } from '../lib/contexto.js';
import { Pagina, Filtros, Campo, Tabela, Paginacao, Modal, Detalhes, Etiqueta, useConsulta, useAtrasado } from '../componentes/ui.jsx';
import EditarCadastro from '../componentes/EditarCadastro.jsx';

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
    <Pagina titulo="Produtos e Preços" subtitulo="Clique no produto para ver e editar o cadastro">
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
      {aberto && <DetalheProduto id={aberto.id} verCusto={verCusto} aoFechar={() => setAberto(null)} aoAlterar={lista.recarregar} />}
    </Pagina>
  );
}

function DetalheProduto({ id, verCusto, aoFechar, aoAlterar }) {
  const [editando, setEditando] = useState(false);
  const d = useConsulta(async () => {
    const [p, forn, compras] = await Promise.all([
      supabase.from('produtos').select('*, grupos_produto(nome), subgrupos_produto(nome)').eq('id', id).single().then(ou),
      supabase.from('produto_fornecedores').select('*, fornecedores(nome)').eq('produto_id', id).order('data', { ascending: false }).limit(10).then(ou),
      supabase.from('compra_itens').select('quantidade, custo_unitario, compras(id, data_emissao, numero_nota, fornecedores(nome))').eq('produto_id', id).limit(30).then(ou),
    ]);
    const ultimas = compras.data.filter((c) => c.compras).sort((a, b) => (b.compras.data_emissao || '').localeCompare(a.compras.data_emissao || '')).slice(0, 8).map((c, key) => ({ ...c, key }));
    return { dados: { p: p.data, forn: forn.data, compras: ultimas } };
  }, [id, editando]);
  const p = d.dados?.p;

  return (
    <Modal aberto largo titulo={p ? p.nome : 'Produto'} aoFechar={aoFechar}
      rodape={p && <>
        <button type="button" className="btn btn-sec" onClick={() => navegar(`/etiquetas?produto=${p.id}`)}>Etiquetas</button>
        {verCusto && <button type="button" className="btn btn-pri" onClick={() => setEditando(true)}>Editar produto</button>}
      </>}>
      {editando && p && <EditarProduto p={p} aoFechar={() => setEditando(false)} aoSalvar={() => { setEditando(false); aoAlterar(); }} />}
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

function EditarProduto({ p, aoFechar, aoSalvar }) {
  const aux = useConsulta(async () => {
    const [g, s] = await Promise.all([
      supabase.from('grupos_produto').select('id, nome').order('nome').then(ou),
      supabase.from('subgrupos_produto').select('id, nome, grupo_id').order('nome').then(ou),
    ]);
    return { dados: { grupos: g.data, subgrupos: s.data } };
  }, []);
  if (!aux.dados) return null;
  const ncm = (v) => (/^\d{8}$/.test(v) ? null : 'NCM com 8 dígitos');
  return (
    <EditarCadastro titulo={`Editar produto ${p.id}`} tabela="produtos" id={p.id} valores={p} aoFechar={aoFechar} aoSalvar={aoSalvar}
      aviso="O estoque não se altera aqui: ele muda pelas vendas, compras e ajuste de estoque."
      campos={[
        { campo: 'nome', rotulo: 'Nome do produto', largo: true, obrigatorio: true, max: 120 },
        { campo: 'codigo_barras', rotulo: 'Código de barras (EAN)', max: 14 },
        { campo: 'referencia', rotulo: 'Referência', max: 60 },
        { campo: 'marca', rotulo: 'Marca', max: 60 },
        { campo: 'unidade', rotulo: 'Unidade (UN, CX, M, KG…)', max: 6 },
        { campo: 'grupo_id', rotulo: 'Grupo', tipo: 'select', numerico: true, opcoes: aux.dados.grupos.map((g) => [g.id, g.nome]) },
        { campo: 'subgrupo_id', rotulo: 'Subgrupo', tipo: 'select', numerico: true, opcoes: aux.dados.subgrupos.map((g) => [g.id, g.nome]) },
        { campo: 'preco_venda', rotulo: 'Preço de venda (R$)', tipo: 'decimal', obrigatorio: true },
        { campo: 'custo', rotulo: 'Custo (R$)', tipo: 'decimal' },
        { campo: 'margem', rotulo: 'Margem (%)', tipo: 'decimal' },
        { campo: 'preco_atacado', rotulo: 'Preço atacado (R$)', tipo: 'decimal' },
        { campo: 'qtd_atacado', rotulo: 'Atacado a partir de (qtd)', tipo: 'decimal' },
        { campo: 'estoque_minimo', rotulo: 'Estoque mínimo', tipo: 'decimal' },
        { campo: 'ncm', rotulo: 'NCM', tipo: 'digitos', max: 10, validar: ncm },
        { campo: 'cest', rotulo: 'CEST', tipo: 'digitos', max: 9 },
        { campo: 'cfop', rotulo: 'CFOP (5102 ou 5405)', tipo: 'inteiro', max: 4 },
        { campo: 'cst_csosn', rotulo: 'CSOSN', tipo: 'select', opcoes: [['102', '102 - tributado sem crédito'], ['103', '103 - isento'], ['300', '300 - imune'],
          ['400', '400 - não tributado'], ['500', '500 - ICMS cobrado por ST'], ['900', '900 - outros']] },
        { campo: 'origem', rotulo: 'Origem', tipo: 'select', numerico: true, opcoes: [[0, '0 - Nacional'], [1, '1 - Estrangeira (importação direta)'], [2, '2 - Estrangeira (mercado interno)']] },
        { campo: 'utilizacao', rotulo: 'Utilização / aplicação', tipo: 'area', largo: true, maiusculo: false, max: 2000 },
        { campo: 'ativo', rotulo: 'Produto ativo', tipo: 'check' },
      ]} />
  );
}
