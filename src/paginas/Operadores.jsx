import { useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { numero } from '../lib/formato.js';
import { Pagina, Campo, Tabela, Modal, Etiqueta, useConsulta, useAvisar } from '../componentes/ui.jsx';

// Operadores do caixa: código de 4 dígitos que libera o PDV e os orçamentos, com as permissões de cada um
// (equivalentes às do cadastro de usuários do DirectControl). Só o admin vê e altera.
export default function Operadores() {
  const [editando, setEditando] = useState(null);
  const lista = useConsulta(async () => ({ dados: ou(await supabase.from('operadores').select('*').order('nome')).data }), []);
  return (
    <Pagina titulo="Operadores do caixa" subtitulo="Código de 4 dígitos que libera vendas e orçamentos"
      acoes={<button type="button" className="btn btn-pri" onClick={() => setEditando({})}>Novo operador</button>}>
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} aoClicar={setEditando} vazio="Nenhum operador cadastrado. Cadastre para liberar o PDV."
        colunas={[
          { titulo: 'Nome', campo: 'nome' },
          { titulo: 'Código', render: () => '••••' },
          { titulo: 'Desconto máx.', alinhar: 'dir', render: (o) => `${numero(o.desconto_maximo)}%` },
          { titulo: 'Permissões', render: (o) => <>
            {o.vende_sem_estoque && <Etiqueta>vende sem estoque</Etiqueta>} {o.vende_abaixo_custo && <Etiqueta>abaixo do custo</Etiqueta>}
            {o.converte_orcamento && <Etiqueta>converte orçamento</Etiqueta>}</> },
          { titulo: 'Situação', render: (o) => (o.ativo ? <Etiqueta tipo="ok">Ativo</Etiqueta> : <Etiqueta tipo="neutra">Inativo</Etiqueta>) },
        ]} />
      {editando && <EditarOperador op={editando} aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); lista.recarregar(); }} />}
    </Pagina>
  );
}

function EditarOperador({ op, aoFechar, aoSalvar }) {
  const avisar = useAvisar();
  const [o, setO] = useState({ nome: op.nome || '', codigo: '', desconto_maximo: String(op.desconto_maximo ?? 5).replace('.', ','),
    vende_sem_estoque: !!op.vende_sem_estoque, vende_abaixo_custo: !!op.vende_abaixo_custo, converte_orcamento: op.converte_orcamento ?? true, ativo: op.ativo ?? true });
  const [salvando, setSalvando] = useState(false);
  const set = (k) => (e) => setO({ ...o, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function salvar(e) {
    e.preventDefault();
    const linha = { nome: o.nome.trim().toUpperCase(), desconto_maximo: Number(String(o.desconto_maximo).replace(',', '.')) || 0,
      vende_sem_estoque: o.vende_sem_estoque, vende_abaixo_custo: o.vende_abaixo_custo, converte_orcamento: o.converte_orcamento, ativo: o.ativo };
    if (!linha.nome) return avisar('Informe o nome.', 'erro');
    if (o.codigo || !op.id) {
      if (!/^\d{4}$/.test(o.codigo)) return avisar('O código precisa ter exatamente 4 dígitos.', 'erro');
      linha.codigo = o.codigo;
    }
    if (linha.desconto_maximo < 0 || linha.desconto_maximo > 100) return avisar('Desconto máximo entre 0 e 100%.', 'erro');
    setSalvando(true);
    try {
      ou(op.id ? await supabase.from('operadores').update(linha).eq('id', op.id) : await supabase.from('operadores').insert(linha));
      avisar('Operador salvo.');
      aoSalvar();
    } catch (erro) {
      avisar(/duplicate|unique/i.test(erro.message) ? 'Esse código já é de outro operador.' : erro.message, 'erro');
      setSalvando(false);
    }
  }
  return (
    <Modal aberto titulo={op.id ? `Operador ${op.nome}` : 'Novo operador'} aoFechar={aoFechar}
      rodape={<>
        <button type="button" className="btn btn-sec" onClick={aoFechar}>Cancelar</button>
        <button type="submit" form="form-operador" className="btn btn-pri" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      </>}>
      <form id="form-operador" className="form-grade" onSubmit={salvar}>
        <Campo rotulo="Nome" largo><input value={o.nome} onChange={set('nome')} autoFocus /></Campo>
        <Campo rotulo={op.id ? 'Novo código (deixe vazio para manter)' : 'Código (4 dígitos)'}>
          <input type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={o.codigo}
            onChange={(e) => setO({ ...o, codigo: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
        </Campo>
        <Campo rotulo="Desconto máximo (%)"><input inputMode="decimal" value={o.desconto_maximo} onChange={set('desconto_maximo')} /></Campo>
        <label className="check"><input type="checkbox" checked={o.vende_sem_estoque} onChange={set('vende_sem_estoque')} /> Pode vender sem estoque</label>
        <label className="check"><input type="checkbox" checked={o.vende_abaixo_custo} onChange={set('vende_abaixo_custo')} /> Pode vender abaixo do custo</label>
        <label className="check"><input type="checkbox" checked={o.converte_orcamento} onChange={set('converte_orcamento')} /> Pode transformar orçamento em venda</label>
        <label className="check"><input type="checkbox" checked={o.ativo} onChange={set('ativo')} /> Ativo</label>
      </form>
    </Modal>
  );
}
