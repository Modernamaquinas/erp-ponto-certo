import { useState } from 'react';
import { supabase, api, ou } from '../lib/supabase.js';
import { numero } from '../lib/formato.js';
import { usePerfil } from '../lib/contexto.js';
import { Pagina, Campo, Tabela, Modal, Etiqueta, Aviso, useConsulta, useAvisar } from '../componentes/ui.jsx';

// Cadastro de usuários. Cada usuário tem um NÚMERO DE CADASTRO de 4 dígitos, que é a chave que libera o PDV e os
// orçamentos (tabela operadores), com as permissões de caixa. O login no ERP (e-mail e senha) é opcional:
// quem só trabalha no caixa precisa apenas do número.
const PAPEIS = { admin: 'Administrador', financeiro: 'Financeiro', vendedor: 'Vendedor' };

export default function Usuarios() {
  const [editando, setEditando] = useState(null);
  const lista = useConsulta(async () => {
    const [login, ops] = await Promise.all([
      api('usuarios', { metodo: 'GET' }).then((r) => r.usuarios),
      supabase.from('operadores').select('*').order('nome').then(ou).then((r) => r.data),
    ]);
    const porUser = new Map(ops.filter((o) => o.user_id).map((o) => [o.user_id, o]));
    const linhas = login.map((u) => ({ chave: u.user_id, nome: u.nome, login: u, op: porUser.get(u.user_id) || null }));
    for (const o of ops) if (!o.user_id || !login.some((u) => u.user_id === o.user_id)) linhas.push({ chave: `op-${o.id}`, nome: o.nome, login: null, op: o });
    return { dados: linhas.sort((a, b) => a.nome.localeCompare(b.nome)) };
  }, []);

  return (
    <Pagina titulo="Usuários" subtitulo="Número do cadastro (4 dígitos) libera o PDV; login no ERP é opcional"
      acoes={<button type="button" className="btn btn-pri" onClick={() => setEditando({})}>Novo usuário</button>}>
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} chave="chave" aoClicar={setEditando}
        colunas={[
          { titulo: 'Nome', campo: 'nome' },
          { titulo: 'Nº do cadastro (PDV)', render: (l) => (l.op ? <span className="cod">••••</span> : <Etiqueta tipo="alerta">sem número</Etiqueta>) },
          { titulo: 'Login no ERP', render: (l) => (l.login ? <>{l.login.email} <Etiqueta>{PAPEIS[l.login.papel]}</Etiqueta></> : '—') },
          { titulo: 'Desconto máx.', alinhar: 'dir', render: (l) => (l.op ? `${numero(l.op.desconto_maximo)}%` : '') },
          { titulo: 'Situação', render: (l) => ((l.op ? l.op.ativo : l.login.ativo) ? <Etiqueta tipo="ok">Ativo</Etiqueta> : <Etiqueta>Inativo</Etiqueta>) },
        ]} />
      {editando && <EditarUsuario linha={editando} aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); lista.recarregar(); }} />}
    </Pagina>
  );
}

function EditarUsuario({ linha, aoFechar, aoSalvar }) {
  const eu = usePerfil();
  const avisar = useAvisar();
  const op = linha.op || {};
  const login = linha.login || null;
  const novo = !linha.chave;
  const [u, setU] = useState({
    nome: linha.nome || '', codigo: '', ativo: op.id ? op.ativo : (login?.ativo ?? true),
    desconto_maximo: String(op.desconto_maximo ?? 5).replace('.', ','), vende_sem_estoque: !!op.vende_sem_estoque,
    vende_abaixo_custo: !!op.vende_abaixo_custo, converte_orcamento: op.converte_orcamento ?? true,
    temLogin: !!login, email: login?.email || '', senha: '', papel: login?.papel || 'vendedor',
  });
  const [salvando, setSalvando] = useState(false);
  const set = (k) => (e) => setU({ ...u, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const souEu = login?.user_id === eu.user_id;

  async function salvar(e) {
    e.preventDefault();
    const nome = u.nome.trim().toUpperCase();
    if (!nome) return avisar('Informe o nome.', 'erro');
    if ((!op.id || u.codigo) && !/^\d{4}$/.test(u.codigo)) return avisar('O número do cadastro precisa ter exatamente 4 dígitos.', 'erro');
    const desc = Number(String(u.desconto_maximo).replace(',', '.'));
    if (!(desc >= 0 && desc <= 100)) return avisar('Desconto máximo entre 0 e 100%.', 'erro');
    if (u.temLogin && !login && (!u.email || u.senha.length < 8)) return avisar('Para login no ERP informe e-mail e senha (mín. 8 caracteres).', 'erro');
    setSalvando(true);
    try {
      // 1. login no ERP (opcional)
      let userId = login?.user_id || op.user_id || null;
      if (u.temLogin && !login) {
        userId = (await api('usuarios', { corpo: { nome, email: u.email.trim(), senha: u.senha, papel: u.papel } })).user_id;
      } else if (login) {
        ou(await supabase.from('perfis').update({ nome, papel: souEu ? login.papel : u.papel, ativo: souEu ? true : u.ativo }).eq('user_id', login.user_id));
      }
      // 2. número do cadastro + permissões do PDV
      const dados = { nome, ativo: u.ativo, desconto_maximo: desc, vende_sem_estoque: u.vende_sem_estoque, vende_abaixo_custo: u.vende_abaixo_custo,
        converte_orcamento: u.converte_orcamento, user_id: userId, ...(u.codigo ? { codigo: u.codigo } : {}) };
      ou(op.id ? await supabase.from('operadores').update(dados).eq('id', op.id) : await supabase.from('operadores').insert(dados));
      avisar('Usuário salvo.');
      aoSalvar();
    } catch (erro) {
      avisar(/operadores_codigo_key|duplicate.*codigo/i.test(erro.message) ? 'Esse número de cadastro já é de outro usuário.' : erro.message, 'erro');
      setSalvando(false);
    }
  }

  return (
    <Modal aberto largo titulo={novo ? 'Novo usuário' : `Usuário ${linha.nome}`} aoFechar={aoFechar}
      rodape={<>
        <button type="button" className="btn btn-sec" onClick={aoFechar}>Cancelar</button>
        <button type="submit" form="form-usuario" className="btn btn-pri" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      </>}>
      <form id="form-usuario" className="form-grade" onSubmit={salvar}>
        <Campo rotulo="Nome" largo><input value={u.nome} onChange={set('nome')} autoFocus /></Campo>
        <Campo rotulo={op.id ? 'Novo nº do cadastro (vazio = manter)' : 'Nº do cadastro — chave do PDV (4 dígitos)'}>
          <input type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={u.codigo}
            onChange={(e) => setU({ ...u, codigo: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
        </Campo>
        <Campo rotulo="Desconto máximo no PDV (%)"><input inputMode="decimal" value={u.desconto_maximo} onChange={set('desconto_maximo')} /></Campo>
        <label className="check"><input type="checkbox" checked={u.vende_sem_estoque} onChange={set('vende_sem_estoque')} /> Pode vender sem estoque</label>
        <label className="check"><input type="checkbox" checked={u.vende_abaixo_custo} onChange={set('vende_abaixo_custo')} /> Pode vender abaixo do custo</label>
        <label className="check"><input type="checkbox" checked={u.converte_orcamento} onChange={set('converte_orcamento')} /> Pode transformar orçamento em venda</label>
        <label className="check"><input type="checkbox" checked={u.ativo} disabled={souEu} onChange={set('ativo')} /> Ativo</label>

        <h3 className="campo-largo">Login no ERP (opcional)</h3>
        {login ? <>
          <Campo rotulo="E-mail" largo><input value={u.email} disabled /></Campo>
          <Campo rotulo="Papel">
            <select value={u.papel} disabled={souEu} onChange={set('papel')}>{Object.entries(PAPEIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Campo>
        </> : <>
          <label className="check"><input type="checkbox" checked={u.temLogin} onChange={set('temLogin')} /> Este usuário entra no ERP com e-mail e senha</label>
          {u.temLogin && <>
            <Campo rotulo="E-mail" largo><input type="email" value={u.email} onChange={set('email')} /></Campo>
            <Campo rotulo="Senha inicial (mín. 8)"><input type="password" minLength={8} value={u.senha} onChange={set('senha')} autoComplete="new-password" /></Campo>
            <Campo rotulo="Papel">
              <select value={u.papel} onChange={set('papel')}>{Object.entries(PAPEIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </Campo>
          </>}
        </>}
      </form>
      {!u.temLogin && !login && <Aviso>Sem login: a pessoa só usa o número do cadastro para liberar o PDV num computador já conectado ao ERP.</Aviso>}
    </Modal>
  );
}
