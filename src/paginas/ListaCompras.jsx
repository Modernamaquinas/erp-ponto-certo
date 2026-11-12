// Lista de compras (/compras/lista): itens em falta (estoque ≤ 0) ou no estoque mínimo, agrupados pelo último fornecedor, com
// sugestão de quantidade (repor até o maior entre o mínimo e a cobertura de N dias pela média de venda). A quantidade é editável,
// e a lista sai em CSV, impressa ou por WhatsApp para o fornecedor. Cálculo no banco: lista_compras (020).
import { useMemo, useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { moeda, numero, data, linkWhatsApp, hoje } from '../lib/formato.js';
import { navegar } from '../lib/contexto.js';
import { Pagina, Campo, Aviso, Etiqueta, useConsulta } from '../componentes/ui.jsx';

const num = (v) => Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0;

function baixarCsv(nome, linhas) {
  const esc = (v) => { const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const cab = ['Fornecedor', 'Código', 'Cód. fornecedor', 'Produto', 'Referência', 'EAN', 'Un', 'Estoque', 'Mínimo', 'Vendido no período', 'Comprar', 'Último custo', 'Total estimado', 'Última compra'];
  const txt = [cab.join(';'), ...linhas.map((i) => [i.fornecedor || 'Sem fornecedor', i.id, i.codigo_fornecedor, i.nome, i.referencia, i.codigo_barras, i.unidade, Number(i.estoque),
    i.estoque_minimo === null ? '' : Number(i.estoque_minimo), Number(i.vendido), i.qtd, i.ultimo_custo === null ? '' : Number(i.ultimo_custo),
    i.ultimo_custo === null ? '' : Math.round(i.qtd * i.ultimo_custo * 100) / 100, data(i.ultima_compra)].map(esc).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`﻿${txt}`], { type: 'text/csv;charset=utf-8' }));
  a.download = `${nome}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export default function ListaCompras() {
  const [f, setF] = useState({ situacao: 'todos', grupo_id: '', fornecedor_id: '', dias: '90', cobertura: '30', incluir_sem_giro: false });
  const [qtds, setQtds] = useState({}); // id -> quantidade editada
  const [tirados, setTirados] = useState(new Set());
  const grupos = useConsulta(async () => ({ dados: ou(await supabase.from('grupos_produto').select('id, nome').order('nome')).data }), []);
  const lista = useConsulta(async () => ({ dados: ou(await supabase.rpc('lista_compras', { p: {
    situacao: f.situacao, grupo_id: f.grupo_id || null, fornecedor_id: f.fornecedor_id || null, dias: Number(f.dias), cobertura: Number(f.cobertura), incluir_sem_giro: f.incluir_sem_giro } })) }), [f]);
  const mudar = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })); setQtds({}); setTirados(new Set()); };

  const itens = useMemo(() => (lista.dados?.itens || []).filter((i) => !tirados.has(i.id))
    .map((i) => ({ ...i, qtd: qtds[i.id] !== undefined ? num(qtds[i.id]) : Number(i.sugestao) })), [lista.dados, qtds, tirados]);
  const porFornecedor = useMemo(() => {
    const m = new Map();
    for (const i of itens) { const k = i.fornecedor_id || 0; if (!m.has(k)) m.set(k, { id: k, nome: i.fornecedor || 'Sem fornecedor identificado', celular: i.fornecedor_celular, itens: [] }); m.get(k).itens.push(i); }
    return [...m.values()];
  }, [itens]);
  const fornecedores = useMemo(() => {
    const m = new Map();
    for (const i of lista.dados?.itens || []) if (i.fornecedor_id) m.set(i.fornecedor_id, i.fornecedor);
    return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }, [lista.dados]);
  const total = itens.reduce((s, i) => s + i.qtd * Number(i.ultimo_custo || 0), 0);
  const r = lista.dados?.resumo;

  function pedidoWhatsApp(g) {
    const linhas = g.itens.filter((i) => i.qtd > 0).map((i) => `• ${numero(i.qtd)} ${i.unidade || 'UN'} — ${i.nome}${i.codigo_fornecedor ? ` (cód. ${i.codigo_fornecedor})` : ''}`);
    return linkWhatsApp(g.celular, `Olá! Pedido da Ponto Certo Ferragens (${hoje().split('-').reverse().join('/')}):\n\n${linhas.join('\n')}\n\nPor favor, confirme preços e prazo. Obrigado!`);
  }

  return (
    <Pagina titulo="Lista de compras" subtitulo="Itens em falta ou no estoque mínimo, com sugestão pela venda média"
      acoes={<>
        <button type="button" className="btn btn-sec" disabled={!itens.length} onClick={() => baixarCsv(`lista-compras-${hoje()}`, itens)}>Exportar CSV</button>
        <button type="button" className="btn btn-sec" onClick={() => window.print()}>Imprimir</button>
        <a className="btn btn-sec" href="#/compras/entrada">Entrada de nota</a>
      </>}>
      <div className="filtros">
        <Campo rotulo="Situação"><select value={f.situacao} onChange={mudar('situacao')}>
          <option value="todos">Em falta e no mínimo</option><option value="falta">Em falta (estoque ≤ 0)</option><option value="minimo">No mínimo (ainda tem)</option></select></Campo>
        <Campo rotulo="Grupo"><select value={f.grupo_id} onChange={mudar('grupo_id')}><option value="">Todos</option>{(grupos.dados || []).map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}</select></Campo>
        <Campo rotulo="Fornecedor"><select value={f.fornecedor_id} onChange={mudar('fornecedor_id')}><option value="">Todos</option>{fornecedores.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></Campo>
        <Campo rotulo="Média de venda dos últimos"><select value={f.dias} onChange={mudar('dias')}>{[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} dias</option>)}</select></Campo>
        <Campo rotulo="Comprar para (cobertura)"><select value={f.cobertura} onChange={mudar('cobertura')}>{[7, 15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} dias</option>)}</select></Campo>
        <label className="campo-check"><input type="checkbox" checked={f.incluir_sem_giro} onChange={mudar('incluir_sem_giro')} /> <span>Incluir zerados sem venda e sem mínimo</span></label>
      </div>
      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
      {r && (
        <div className="indicadores">
          <div className="indicador ind-erro"><span className="ind-rotulo">Em falta</span><strong className="ind-valor">{numero(r.em_falta)}</strong></div>
          <div className="indicador ind-alerta"><span className="ind-rotulo">No mínimo</span><strong className="ind-valor">{numero(r.no_minimo)}</strong></div>
          <div className="indicador ind-info"><span className="ind-rotulo">Na lista</span><strong className="ind-valor">{numero(itens.length)}</strong><span className="ind-detalhe">{porFornecedor.length} fornecedor(es)</span></div>
          <div className="indicador"><span className="ind-rotulo">Valor estimado</span><strong className="ind-valor">{moeda(total)}</strong><span className="ind-detalhe">pelo último custo</span></div>
        </div>
      )}
      {lista.carregando && !lista.dados && <p className="texto-fraco">Calculando…</p>}
      {lista.dados && !itens.length && <Aviso tipo="ok">Nada em falta nem no estoque mínimo com esses filtros.</Aviso>}
      {porFornecedor.map((g) => {
        const zap = g.celular && pedidoWhatsApp(g);
        const sub = g.itens.reduce((s, i) => s + i.qtd * Number(i.ultimo_custo || 0), 0);
        return (
          <section key={g.id} className="painel-caixa lista-forn">
            <div className="grafico-topo">
              <h2>{g.nome} <small className="texto-fraco">— {g.itens.length} itens · {moeda(sub)}</small></h2>
              {zap && <a className="btn btn-zap btn-peq" href={zap} target="_blank" rel="noopener noreferrer">Pedido por WhatsApp</a>}
            </div>
            <div className="tabela-caixa">
              <table className="tabela tabela-compacta">
                <thead><tr><th>Cód.</th><th>Produto</th><th>Cód. forn.</th><th className="al-dir">Estoque</th><th className="al-dir">Mínimo</th>
                  <th className="al-dir">Vendido</th><th className="al-dir">Comprar</th><th className="al-dir">Últ. custo</th><th>Última compra</th><th /></tr></thead>
                <tbody>{g.itens.map((i) => (
                  <tr key={i.id}>
                    <td className="cod">{i.id}</td>
                    <td><button type="button" className="btn-link" onClick={() => navegar(`/produtos?id=${i.id}`)}>{i.nome}</button>
                      {' '}<Etiqueta tipo={i.situacao === 'falta' ? 'erro' : 'alerta'}>{i.situacao === 'falta' ? 'em falta' : 'no mínimo'}</Etiqueta></td>
                    <td>{i.codigo_fornecedor}</td>
                    <td className={`al-dir${Number(i.estoque) <= 0 ? ' texto-erro' : ''}`}>{numero(i.estoque)}</td>
                    <td className="al-dir">{i.estoque_minimo === null ? '—' : numero(i.estoque_minimo)}</td>
                    <td className="al-dir" title={`média ${numero(i.media_dia)}/dia`}>{numero(i.vendido)}</td>
                    <td className="al-dir"><input className="input-peq" inputMode="decimal" value={qtds[i.id] ?? String(i.sugestao)} onChange={(e) => setQtds((q) => ({ ...q, [i.id]: e.target.value }))} /> {i.unidade}</td>
                    <td className="al-dir">{i.ultimo_custo === null ? '—' : moeda(i.ultimo_custo)}</td>
                    <td>{data(i.ultima_compra)}</td>
                    <td><button type="button" className="btn btn-sec btn-peq" title="Tirar da lista" onClick={() => setTirados((s) => new Set(s).add(i.id))}>✕</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        );
      })}
      {lista.dados?.itens?.length >= 3000 && <p className="texto-fraco">Mostrando os 3.000 itens mais vendidos: use os filtros.</p>}
    </Pagina>
  );
}
