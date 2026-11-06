import { useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { moeda, documento, telefone, filtrarBusca } from '../lib/formato.js';
import { navegar, usePerfil, podeFinanceiro } from '../lib/contexto.js';
import { Pagina, Filtros, Campo, Tabela, Paginacao, Etiqueta, useConsulta, useAtrasado } from '../componentes/ui.jsx';

const POR_PAGINA = 50;

export default function Clientes() {
  const fin = podeFinanceiro(usePerfil());
  const [termo, setTermo] = useState('');
  const [filtro, setFiltro] = useState('ativos');
  const [pagina, setPagina] = useState(1);
  const busca = useAtrasado(termo);

  const lista = useConsulta(async () => {
    const de = (pagina - 1) * POR_PAGINA;
    let q = supabase.from('clientes').select('id, nome, nome_fantasia, cpf_cnpj, celular, telefone, ativo, bloqueado, cidades(nome, uf)', { count: 'exact' });
    if (filtro === 'ativos') q = q.eq('ativo', true);
    if (filtro === 'devendo') {
      const { data } = ou(await supabase.from('v_receber_por_cliente').select('cliente_id'));
      q = q.in('id', data.map((d) => d.cliente_id));
    }
    const r = ou(await filtrarBusca(q, busca).order('nome').range(de, de + POR_PAGINA - 1));
    let saldos = new Map();
    if (fin && r.data.length) {
      const s = ou(await supabase.from('v_receber_por_cliente').select('cliente_id, saldo, atrasado').in('cliente_id', r.data.map((c) => c.id)));
      saldos = new Map(s.data.map((x) => [x.cliente_id, x]));
    }
    return { dados: r.data.map((c) => ({ ...c, receber: saldos.get(c.id) })), total: r.count };
  }, [busca, filtro, pagina, fin]);

  return (
    <Pagina titulo="Clientes" subtitulo="Cadastro mantido no DirectControl durante a Fase 1; aqui você edita os dados de cobrança">
      <Filtros>
        <Campo rotulo="Buscar (nome, código, CPF/CNPJ, telefone)" largo>
          <input type="search" autoFocus value={termo} onChange={(e) => { setPagina(1); setTermo(e.target.value); }} />
        </Campo>
        <Campo rotulo="Mostrar">
          <select value={filtro} onChange={(e) => { setPagina(1); setFiltro(e.target.value); }}>
            <option value="ativos">Ativos</option>
            <option value="todos">Todos (inclui inativos)</option>
            {fin && <option value="devendo">Com crediário em aberto</option>}
          </select>
        </Campo>
      </Filtros>
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} aoClicar={(c) => navegar(`/clientes/${c.id}`)}
        colunas={[
          { titulo: 'Código', campo: 'id', classe: 'cod' },
          { titulo: 'Nome', render: (c) => <>{c.nome}{!c.ativo && <> <Etiqueta>Inativo</Etiqueta></>}{c.bloqueado && <> <Etiqueta tipo="erro">Bloqueado</Etiqueta></>}</> },
          { titulo: 'CPF/CNPJ', render: (c) => documento(c.cpf_cnpj) },
          { titulo: 'Celular', render: (c) => telefone(c.celular || c.telefone) },
          { titulo: 'Cidade', render: (c) => (c.cidades ? `${c.cidades.nome}/${c.cidades.uf}` : '') },
          ...(fin ? [{ titulo: 'Crediário', alinhar: 'dir', render: (c) => (c.receber
            ? <span className={Number(c.receber.atrasado) > 0 ? 'texto-erro' : undefined}>{moeda(c.receber.saldo)}</span> : '') }] : []),
        ]} />
      <Paginacao pagina={pagina} total={lista.total} porPagina={POR_PAGINA} aoMudar={setPagina} />
    </Pagina>
  );
}
