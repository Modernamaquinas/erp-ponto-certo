import { useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { Campo, Modal, Aviso, useConsulta, useAtrasado, useAvisar } from './ui.jsx';

// Formulário de edição genérico (produtos, clientes, fornecedores).
// campos: [{ campo, rotulo, tipo: 'texto'|'decimal'|'inteiro'|'data'|'check'|'area'|'select'|'cidade'|'digitos',
//            opcoes?: [[valor, rotulo]], largo?, obrigatorio?, max?, maiusculo?, validar?(valor) -> mensagem|null }]
const paraTela = (c, v) => {
  if (v === null || v === undefined) return c.tipo === 'check' ? false : '';
  if (c.tipo === 'decimal') return String(v).replace('.', ',');
  if (c.tipo === 'check') return Boolean(v);
  return String(v);
};

function paraBanco(c, v) {
  if (c.tipo === 'check') return Boolean(v);
  const s = String(v ?? '').trim();
  if (s === '') return null;
  if (c.tipo === 'decimal') { const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); if (!Number.isFinite(n)) throw new Error(`${c.rotulo}: número inválido`); return n; }
  if (c.tipo === 'inteiro' || c.tipo === 'cidade' || (c.tipo === 'select' && c.numerico)) { const n = Number(s); if (!Number.isInteger(n)) throw new Error(`${c.rotulo}: número inválido`); return n; }
  if (c.tipo === 'digitos') return s.replace(/\D/g, '') || null;
  return c.maiusculo === false ? s : s.toUpperCase();
}

export default function EditarCadastro({ titulo, tabela, id, valores, campos, aoFechar, aoSalvar, aviso }) {
  const avisar = useAvisar();
  const [v, setV] = useState(() => Object.fromEntries(campos.map((c) => [c.campo, paraTela(c, valores[c.campo])])));
  const [salvando, setSalvando] = useState(false);
  const set = (c) => (e) => setV({ ...v, [c.campo]: c.tipo === 'check' ? e.target.checked : e.target.value });

  async function salvar(e) {
    e.preventDefault();
    const dados = {};
    try {
      for (const c of campos) {
        const valor = paraBanco(c, v[c.campo]);
        if (c.obrigatorio && (valor === null || valor === '')) throw new Error(`${c.rotulo}: obrigatório`);
        const msg = c.validar && valor !== null ? c.validar(valor) : null;
        if (msg) throw new Error(`${c.rotulo}: ${msg}`);
        // só envia o que mudou (menos risco de conflito e o histórico fica limpo)
        const antes = valores[c.campo] ?? null;
        if (String(antes ?? '') !== String(valor ?? '')) dados[c.campo] = valor;
      }
    } catch (erro) { return avisar(erro.message, 'erro'); }
    if (!Object.keys(dados).length) { avisar('Nada foi alterado.'); return aoFechar(); }
    setSalvando(true);
    try {
      ou(await supabase.from(tabela).update(dados).eq('id', id));
      avisar('Cadastro salvo.');
      aoSalvar();
    } catch (erro) {
      avisar(/permission denied|row-level/i.test(erro.message) ? 'Seu usuário não pode alterar este cadastro (só administrador e financeiro).' : erro.message, 'erro');
      setSalvando(false);
    }
  }

  return (
    <Modal aberto largo titulo={titulo} aoFechar={aoFechar}
      rodape={<>
        <button type="button" className="btn btn-sec" onClick={aoFechar}>Cancelar</button>
        <button type="submit" form="form-editar-cadastro" className="btn btn-pri" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      </>}>
      {aviso && <Aviso>{aviso}</Aviso>}
      <form id="form-editar-cadastro" className="form-grade" onSubmit={salvar}>
        {campos.map((c) => {
          if (c.tipo === 'check') return <label key={c.campo} className="check"><input type="checkbox" checked={v[c.campo]} onChange={set(c)} /> {c.rotulo}</label>;
          if (c.tipo === 'cidade') return <CampoCidade key={c.campo} rotulo={c.rotulo} valor={v[c.campo]} inicial={valores._cidade} aoMudar={(x) => setV({ ...v, [c.campo]: x })} />;
          return (
            <Campo key={c.campo} rotulo={`${c.rotulo}${c.obrigatorio ? ' *' : ''}`} largo={c.largo}>
              {c.tipo === 'select' ? (
                <select value={v[c.campo]} onChange={set(c)}>
                  <option value="">—</option>
                  {(c.opcoes || []).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
                </select>
              ) : c.tipo === 'area' ? (
                <textarea rows={3} value={v[c.campo]} onChange={set(c)} maxLength={c.max} />
              ) : (
                <input value={v[c.campo]} onChange={set(c)} maxLength={c.max} type={c.tipo === 'data' ? 'date' : 'text'}
                  inputMode={['decimal', 'inteiro', 'digitos'].includes(c.tipo) ? 'decimal' : undefined} />
              )}
            </Campo>
          );
        })}
      </form>
    </Modal>
  );
}

function CampoCidade({ rotulo, valor, inicial, aoMudar }) {
  const [nome, setNome] = useState(inicial ? `${inicial.nome}/${inicial.uf}` : '');
  const [aberto, setAberto] = useState(false);
  const busca = useAtrasado(nome);
  const r = useConsulta(async () => {
    if (!aberto || busca.trim().length < 2) return { dados: [] };
    const termo = busca.split('/')[0].trim().toUpperCase().replace(/[%_]/g, '');
    return { dados: ou(await supabase.from('cidades').select('id, nome, uf').ilike('nome', `${termo}%`).order('nome').limit(12)).data };
  }, [busca, aberto]);
  return (
    <div className="busca-produto campo-largo">
      <Campo rotulo={rotulo} largo>
        <input value={nome} onChange={(e) => { setNome(e.target.value); setAberto(true); if (!e.target.value) aoMudar(''); }} placeholder="Digite o nome da cidade" />
      </Campo>
      {aberto && (r.dados || []).length > 0 && (
        <ul className="lista-escolha">
          {r.dados.map((c) => <li key={c.id}><button type="button" onClick={() => { aoMudar(String(c.id)); setNome(`${c.nome}/${c.uf}`); setAberto(false); }}>{c.nome}/{c.uf}</button></li>)}
        </ul>
      )}
      {!valor && nome && !aberto && <span className="texto-erro">Escolha a cidade na lista</span>}
    </div>
  );
}

// ---- validações comuns
const so = (s) => String(s).replace(/\D/g, '');
export function docValido(d) {
  d = so(d);
  if (/^(\d)\1+$/.test(d)) return false;
  const dv = (base, pesos) => { const r = base.split('').reduce((s, n, i) => s + Number(n) * pesos[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  if (d.length === 11) { const p = (n) => Array.from({ length: n }, (_, i) => n + 1 - i); return dv(d.slice(0, 9), p(9)) === +d[9] && dv(d.slice(0, 10), p(10)) === +d[10]; }
  if (d.length === 14) { const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; return dv(d.slice(0, 12), p1) === +d[12] && dv(d.slice(0, 13), [6, ...p1]) === +d[13]; }
  return false;
}
export const validarDoc = (v) => (docValido(v) ? null : 'CPF/CNPJ inválido (confira os dígitos)');
export const validarCep = (v) => (so(v).length === 8 ? null : 'CEP com 8 dígitos');
