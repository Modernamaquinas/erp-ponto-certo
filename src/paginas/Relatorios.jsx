// Relatórios (/relatorios?aba=vendas|estoque|receber|pagar|financeiro): tudo agregado no banco (016_relatorios.sql),
// a tela só desenha. Período no topo, indicadores, gráficos e tabelas com "Exportar CSV" (Excel) e "Imprimir".
import { useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { moeda, numero, data as dataBr, hoje, somarDias, inicioDoMes, linkWhatsApp } from '../lib/formato.js';
import { navegar } from '../lib/contexto.js';
import { Pagina, Campo, Tabela, Aviso, useConsulta } from '../componentes/ui.jsx';
import { Colunas, ColunasDuplas, BarrasH, Indicador } from '../componentes/graficos.jsx';

const ABAS = [['vendas', 'Vendas'], ['estoque', 'Estoque'], ['receber', 'Contas a receber'], ['pagar', 'Contas a pagar'], ['financeiro', 'Financeiro']];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIAS_SEMANA = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const rotuloMes = (iso) => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;
const rotuloDia = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const rotuloPeriodo = (iso, agr) => (agr === 'mes' ? rotuloMes(iso) : rotuloDia(iso));
const pct = (v) => `${Number(v || 0).toFixed(1).replace('.', ',')}%`;
const qtd = (v) => numero(Number(v || 0));

function fimDoMes(iso) {
  const [a, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}
const PRESETS = [
  ['Hoje', () => [hoje(), hoje()]],
  ['7 dias', () => [somarDias(hoje(), -6), hoje()]],
  ['Este mês', () => [inicioDoMes(), hoje()]],
  ['Mês passado', () => { const ini = inicioDoMes(somarDias(inicioDoMes(), -1)); return [ini, fimDoMes(ini)]; }],
  ['30 dias', () => [somarDias(hoje(), -29), hoje()]],
  ['90 dias', () => [somarDias(hoje(), -89), hoje()]],
  ['Este ano', () => [`${hoje().slice(0, 4)}-01-01`, hoje()]],
  ['12 meses', () => [inicioDoMes(somarDias(hoje(), -334)), hoje()]],
];

/** CSV com ; e BOM (abre direto no Excel em pt-BR). colunas: [[titulo, fn(linha)]] */
function baixarCsv(nome, colunas, linhas) {
  const esc = (v) => { const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const txt = [colunas.map((c) => c[0]).join(';'), ...linhas.map((l) => colunas.map((c) => esc(c[1](l))).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`﻿${txt}`], { type: 'text/csv;charset=utf-8' }));
  a.download = `${nome}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function Secao({ titulo, csv, children }) {
  return (
    <div className="rel-secao">
      <div className="grafico-topo"><h2>{titulo}</h2>{csv && <button type="button" className="btn btn-sec btn-peq" onClick={csv}>Exportar CSV</button>}</div>
      {children}
    </div>
  );
}

function Periodo({ ini, fim, aoMudar }) {
  return (
    <div className="rel-periodo">
      <div className="rel-presets">
        {PRESETS.map(([r, f]) => {
          const [a, b] = f();
          return <button key={r} type="button" className={`btn btn-peq ${a === ini && b === fim ? 'btn-pri' : 'btn-sec'}`} onClick={() => aoMudar(a, b)}>{r}</button>;
        })}
      </div>
      <div className="filtros">
        <Campo rotulo="De"><input type="date" value={ini} max={fim} onChange={(e) => e.target.value && aoMudar(e.target.value, fim)} /></Campo>
        <Campo rotulo="Até"><input type="date" value={fim} min={ini} onChange={(e) => e.target.value && aoMudar(ini, e.target.value)} /></Campo>
      </div>
    </div>
  );
}

function useRelatorio(fn, args, deps) {
  return useConsulta(async () => ({ dados: ou(await supabase.rpc(fn, args)).data }), deps);
}

function Carregando({ erro }) {
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  return <p className="texto-fraco">Calculando…</p>;
}

// ---------------------------------------------------------------- vendas
function RelVendas({ ini, fim }) {
  const { dados: r, erro, carregando } = useRelatorio('rel_vendas', { p_ini: ini, p_fim: fim }, [ini, fim]);
  if (!r) return <Carregando erro={erro} />;
  const { resumo: s, anterior: a } = r;
  const agr = r.periodo.agrupamento;
  const margem = Number(s.total) - Number(s.frete) > 0 ? (Number(s.lucro) / (Number(s.total) - Number(s.frete))) * 100 : 0;
  const nomeArq = `vendas-${ini}-a-${fim}`;
  return (
    <div className={`rel-conteudo${carregando ? ' carregando' : ''}`}>
      <div className="indicadores">
        <Indicador rotulo="Faturamento" valor={s.total} anterior={a.total} detalhe={Number(s.frete) > 0 ? `inclui ${moeda(s.frete)} de frete` : null} />
        <Indicador rotulo="Vendas" valor={s.qtd} anterior={a.qtd} formatar={qtd} />
        <Indicador rotulo="Ticket médio" valor={s.ticket} anterior={a.ticket} />
        <Indicador rotulo="Lucro bruto" valor={s.lucro} anterior={a.lucro} tom="ok"
          detalhe={`margem ${pct(margem)}${Number(s.cobertura_custo) < 98 ? ` · ${pct(100 - Number(s.cobertura_custo))} da receita sem custo cadastrado` : ''}`} />
        <Indicador rotulo="Descontos concedidos" valor={s.desconto} anterior={a.desconto} inverter />
        <Indicador rotulo="Itens vendidos" valor={s.itens} anterior={a.itens} formatar={qtd} />
      </div>
      <Colunas titulo={`Faturamento por ${agr === 'mes' ? 'mês' : 'dia'}`} subtitulo="Só vendas finalizadas"
        dados={r.serie.map((x) => ({ rotulo: rotuloPeriodo(x.periodo, agr), valor: x.total, dica: [`${x.qtd} vendas`, Number(x.qtd) ? `ticket ${moeda(x.total / x.qtd)}` : ''] }))} />
      <div className="rel-grade">
        <BarrasH titulo="Por forma de recebimento" subtitulo="Troco descontado do dinheiro"
          dados={r.por_forma.map((x) => ({ rotulo: x.forma, valor: x.total, detalhe: `${x.qtd} vendas` }))} />
        <BarrasH titulo="Por grupo de produto" dados={r.por_grupo.map((x) => ({ rotulo: x.grupo, valor: x.total, detalhe: x.lucro !== null ? `lucro (itens com custo): ${moeda(x.lucro)}` : null }))} />
        <Colunas titulo="Por dia da semana" dados={[1, 2, 3, 4, 5, 6, 7].map((d) => { const x = r.por_dia_semana.find((y) => y.dia === d); return { rotulo: DIAS_SEMANA[d], valor: x?.total || 0, dica: [`${x?.qtd || 0} vendas`] }; })} />
        <Colunas titulo="Por horário" cor="info" dados={r.por_hora.map((x) => ({ rotulo: `${String(x.hora).padStart(2, '0')}h`, valor: x.total, dica: [`${x.qtd} vendas`] }))} />
        <BarrasH titulo="Situação das vendas" subtitulo="Estornadas/canceladas/abertas não entram nos totais" formatar={(v) => `${qtd(v)} vendas`}
          dados={r.por_situacao.map((x) => ({ rotulo: x.situacao.charAt(0).toUpperCase() + x.situacao.slice(1), valor: x.qtd, tom: x.situacao === 'finalizada' ? 'ok' : 'erro',
            detalhe: x.total !== null ? moeda(x.total) : null }))} />
        <BarrasH titulo="Documento fiscal" subtitulo="Vendas finalizadas" dados={r.por_documento.map((x) => ({ rotulo: x.documento, valor: x.total, detalhe: `${x.qtd} vendas` }))} />
      </div>
      <Secao titulo="Por vendedor" csv={() => baixarCsv(`${nomeArq}-vendedores`, [['Vendedor', (l) => l.vendedor], ['Vendas', (l) => l.qtd], ['Total', (l) => Number(l.total)], ['Ticket', (l) => Number(l.ticket)]], r.por_vendedor)}>
        <Tabela chave="vendedor" linhas={r.por_vendedor} colunas={[
          { titulo: 'Vendedor', campo: 'vendedor' }, { titulo: 'Vendas', render: (l) => qtd(l.qtd), alinhar: 'dir' },
          { titulo: 'Total', render: (l) => moeda(l.total), alinhar: 'dir' }, { titulo: 'Ticket médio', render: (l) => moeda(l.ticket), alinhar: 'dir' },
          { titulo: '% do total', render: (l) => pct((l.total / s.total) * 100), alinhar: 'dir' }]} />
      </Secao>
      <Secao titulo="Produtos mais vendidos (30)" csv={() => baixarCsv(`${nomeArq}-produtos`, [['Código', (l) => l.produto_id], ['Produto', (l) => l.nome], ['Qtd', (l) => Number(l.qtd)], ['Total', (l) => Number(l.total)], ['Lucro', (l) => (l.lucro === null ? '' : Number(l.lucro))]], r.top_produtos)}>
        <Tabela chave="produto_id" linhas={r.top_produtos} aoClicar={(l) => l.produto_id && navegar(`/produtos?id=${l.produto_id}`)} colunas={[
          { titulo: 'Cód.', campo: 'produto_id' }, { titulo: 'Produto', campo: 'nome' }, { titulo: 'Qtd', render: (l) => qtd(l.qtd), alinhar: 'dir' },
          { titulo: 'Total', render: (l) => moeda(l.total), alinhar: 'dir' },
          { titulo: 'Lucro', render: (l) => (l.lucro === null ? '—' : moeda(l.lucro)), alinhar: 'dir' },
          { titulo: 'Margem', render: (l) => (l.lucro === null || !Number(l.total) ? '—' : pct((l.lucro / l.total) * 100)), alinhar: 'dir' }]} />
      </Secao>
      <Secao titulo="Melhores clientes (20)" csv={() => baixarCsv(`${nomeArq}-clientes`, [['Código', (l) => l.cliente_id], ['Cliente', (l) => l.nome], ['Vendas', (l) => l.qtd], ['Total', (l) => Number(l.total)]], r.top_clientes)}>
        <Tabela chave="cliente_id" linhas={r.top_clientes} aoClicar={(l) => navegar(`/clientes/${l.cliente_id}`)} colunas={[
          { titulo: 'Cliente', campo: 'nome' }, { titulo: 'Compras', render: (l) => qtd(l.qtd), alinhar: 'dir' },
          { titulo: 'Total', render: (l) => moeda(l.total), alinhar: 'dir' }, { titulo: 'Ticket', render: (l) => moeda(l.total / l.qtd), alinhar: 'dir' }]} />
      </Secao>
    </div>
  );
}

// ---------------------------------------------------------------- estoque
function RelEstoque() {
  const [dias, setDias] = useState(180);
  const [lista, setLista] = useState('abaixo_minimo');
  const { dados: r, erro, carregando } = useRelatorio('rel_estoque', { p_dias_sem_giro: dias }, [dias]);
  if (!r) return <Carregando erro={erro} />;
  const s = r.resumo;
  const LISTAS = {
    abaixo_minimo: { nome: `Abaixo do mínimo (${s.abaixo_minimo})`, colunas: [['Estoque', (l) => qtd(l.estoque)], ['Mínimo', (l) => qtd(l.estoque_minimo)], ['Comprar', (l) => qtd(l.falta)], ['Curva', (l) => l.curva || '—'], ['Última venda', (l) => dataBr(l.data_ultima_saida)]] },
    negativos: { nome: `Estoque negativo (${s.negativos})`, colunas: [['Estoque', (l) => qtd(l.estoque)], ['Curva', (l) => l.curva || '—'], ['Última venda', (l) => dataBr(l.data_ultima_saida)]] },
    sem_giro: { nome: `Sem venda há ${s.dias_sem_giro}+ dias (${s.sem_giro})`, colunas: [['Estoque', (l) => qtd(l.estoque)], ['Valor (custo)', (l) => moeda(l.valor)], ['Última venda', (l) => dataBr(l.data_ultima_saida) || 'nunca'], ['Última entrada', (l) => dataBr(l.data_ultima_entrada)]] },
  };
  const L = LISTAS[lista];
  const linhas = r[lista];
  const colunasTabela = [{ titulo: 'Cód.', campo: 'id' }, { titulo: 'Produto', campo: 'nome' }, { titulo: 'Ref.', campo: 'referencia' }, { titulo: 'Grupo', campo: 'grupo' },
    ...L.colunas.map(([t, f]) => ({ titulo: t, render: f, alinhar: 'dir' }))];
  return (
    <div className={`rel-conteudo${carregando ? ' carregando' : ''}`}>
      <div className="indicadores">
        <Indicador rotulo="Estoque a preço de custo" valor={s.valor_custo} detalhe={Number(s.sem_custo) ? `${qtd(s.sem_custo)} itens com estoque sem custo` : null} />
        <Indicador rotulo="Estoque a preço de venda" valor={s.valor_venda} tom="ok" />
        <Indicador rotulo="Itens ativos" valor={s.itens} formatar={qtd} detalhe={`${qtd(s.com_estoque)} com estoque · ${qtd(s.zerados)} zerados`} />
        <Indicador rotulo="Abaixo do mínimo" valor={s.abaixo_minimo} formatar={qtd} tom={Number(s.abaixo_minimo) ? 'alerta' : undefined} />
        <Indicador rotulo="Estoque negativo" valor={s.negativos} formatar={qtd} tom={Number(s.negativos) ? 'erro' : undefined} detalhe="vendido sem entrada lançada" />
        <Indicador rotulo={`Parado (${s.dias_sem_giro}+ dias)`} valor={s.valor_sem_giro} tom="alerta" detalhe={`${qtd(s.sem_giro)} itens`} />
      </div>
      <div className="rel-grade">
        <BarrasH titulo="Curva ABC (vendas de 12 meses)" subtitulo="Valor em estoque, a custo, por classe. A = 80% do faturamento"
          dados={r.curva.map((x) => ({ rotulo: x.curva === 'Sem venda' ? 'Sem venda em 12 meses' : `Curva ${x.curva}`, valor: x.valor_estoque, detalhe: `${qtd(x.itens)} itens` }))} />
        <BarrasH titulo="Valor em estoque por grupo (custo)" dados={r.por_grupo.map((x) => ({ rotulo: x.grupo, valor: x.valor_custo, detalhe: `${qtd(x.itens)} itens · venda ${moeda(x.valor_venda)}` }))} />
      </div>
      <Secao titulo="Listas para ação" csv={() => baixarCsv(`estoque-${lista}-${hoje()}`, [['Código', (l) => l.id], ['Produto', (l) => l.nome], ['Referência', (l) => l.referencia], ['Grupo', (l) => l.grupo], ...L.colunas], linhas)}>
        <div className="abas" role="tablist">
          {Object.entries(LISTAS).map(([k, v]) => <button key={k} type="button" role="tab" aria-selected={lista === k} className={`aba${lista === k ? ' ativa' : ''}`} onClick={() => setLista(k)}>{v.nome}</button>)}
        </div>
        {lista === 'sem_giro' && (
          <div className="filtros"><Campo rotulo="Sem venda há (dias)"><select value={dias} onChange={(e) => setDias(Number(e.target.value))}>{[60, 90, 180, 365, 730].map((d) => <option key={d} value={d}>{d}</option>)}</select></Campo></div>
        )}
        <Tabela linhas={linhas} colunas={colunasTabela} aoClicar={(l) => navegar(`/produtos?id=${l.id}`)} vazio="Nenhum item nesta lista." />
        {linhas.length >= 300 && <p className="texto-fraco">Mostrando os 300 primeiros.</p>}
      </Secao>
    </div>
  );
}

// ---------------------------------------------------------------- contas a receber
function RelReceber({ ini, fim }) {
  const { dados: r, erro, carregando } = useRelatorio('rel_receber', { p_ini: ini, p_fim: fim }, [ini, fim]);
  if (!r) return <Carregando erro={erro} />;
  const s = r.resumo;
  const agr = fim > somarDias(ini, 62) ? 'mes' : 'dia';
  return (
    <div className={`rel-conteudo${carregando ? ' carregando' : ''}`}>
      <div className="indicadores">
        <Indicador rotulo="Em aberto" valor={s.aberto} detalhe={`${qtd(s.titulos)} títulos · ${qtd(s.clientes)} clientes`} />
        <Indicador rotulo="Vencido" valor={s.vencido} tom="erro" detalhe={`${pct(Number(s.aberto) ? (s.vencido / s.aberto) * 100 : 0)} do aberto · ${qtd(s.clientes_atraso)} clientes`} />
        <Indicador rotulo="A vencer" valor={s.a_vencer} tom="info" />
        <Indicador rotulo="Recebido no período" valor={s.recebido} tom="ok" />
        <Indicador rotulo="Vencendo no período (aberto)" valor={s.vencendo_periodo} />
      </div>
      <div className="rel-grade">
        <BarrasH titulo="Idade dos títulos em aberto" subtitulo="Saldo por faixa de atraso" mostrarPct
          dados={r.aging.map((x) => ({ rotulo: x.faixa, valor: x.saldo, tom: x.ordem <= 5 ? 'erro' : 'info', detalhe: `${qtd(x.titulos)} títulos` }))} />
        <Colunas titulo="Vencimentos dos próximos 12 meses" cor="info" dados={r.vencimentos.map((x) => ({ rotulo: rotuloMes(x.mes), valor: x.saldo }))} />
        <Colunas titulo={`Recebido por ${agr === 'mes' ? 'mês' : 'dia'}`} cor="ok" dados={r.recebido_serie.map((x) => ({ rotulo: rotuloPeriodo(x.periodo, agr), valor: x.total }))} />
        <BarrasH titulo="Recebido por forma" dados={r.recebido_forma.map((x) => ({ rotulo: x.forma, valor: x.total }))} />
      </div>
      <Secao titulo="Maiores devedores (50)" csv={() => baixarCsv(`receber-devedores-${hoje()}`, [['Código', (l) => l.cliente_id], ['Cliente', (l) => l.nome], ['Celular', (l) => l.celular], ['Títulos', (l) => l.titulos], ['Saldo', (l) => Number(l.saldo)], ['Vencido', (l) => Number(l.vencido)], ['Dias de atraso', (l) => l.dias_atraso]], r.devedores)}>
        <Tabela chave="cliente_id" linhas={r.devedores} aoClicar={(l) => l.cliente_id && navegar(`/clientes/${l.cliente_id}`)} colunas={[
          { titulo: 'Cliente', campo: 'nome' }, { titulo: 'Títulos', render: (l) => qtd(l.titulos), alinhar: 'dir' },
          { titulo: 'Saldo', render: (l) => moeda(l.saldo), alinhar: 'dir' },
          { titulo: 'Vencido', render: (l) => (Number(l.vencido) ? <span className="texto-erro">{moeda(l.vencido)}</span> : '—'), alinhar: 'dir' },
          { titulo: 'Atraso', render: (l) => (l.dias_atraso ? `${l.dias_atraso} dias` : '—'), alinhar: 'dir' },
          { titulo: '', render: (l) => { const u = Number(l.vencido) > 0 && linkWhatsApp(l.celular, `Olá! Aqui é da Ponto Certo Ferragens. Consta em aberto no seu crediário o valor de ${moeda(l.vencido)}. Podemos ajudar com o pagamento?`); return u ? <a href={u} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>WhatsApp</a> : null; } }]} />
      </Secao>
    </div>
  );
}

// ---------------------------------------------------------------- contas a pagar
function RelPagar({ ini, fim }) {
  const { dados: r, erro, carregando } = useRelatorio('rel_pagar', { p_ini: ini, p_fim: fim }, [ini, fim]);
  if (!r) return <Carregando erro={erro} />;
  const s = r.resumo;
  return (
    <div className={`rel-conteudo${carregando ? ' carregando' : ''}`}>
      {Number(s.a_conferir) > 0 && <Aviso>{qtd(s.a_conferir)} conta(s) ({moeda(s.a_conferir_valor)}) vieram vencidas do DirectControl e ficam fora destes totais até serem conferidas. <a href="#/pagar?situacao=conferir">Conferir</a></Aviso>}
      <div className="indicadores">
        <Indicador rotulo="Em aberto" valor={s.aberto} detalhe={`${qtd(s.titulos)} títulos`} />
        <Indicador rotulo="Vencido" valor={s.vencido} tom="erro" />
        <Indicador rotulo="Próximos 7 dias" valor={s.proximos_7} tom="alerta" />
        <Indicador rotulo="Próximos 30 dias" valor={s.proximos_30} />
        <Indicador rotulo="Pago no período" valor={s.pago_periodo} tom="ok" />
      </div>
      <div className="rel-grade">
        <Colunas titulo="A pagar nas próximas 8 semanas" cor="info" dados={r.semanas.map((x) => ({ rotulo: `sem. ${rotuloDia(x.semana)}`, valor: x.saldo, dica: [`${x.titulos} títulos`] }))} />
        <Colunas titulo="Vencimentos dos próximos 12 meses" cor="info" dados={r.vencimentos.map((x) => ({ rotulo: rotuloMes(x.mes), valor: x.saldo }))} />
        <BarrasH titulo="Pago no período por plano de contas" dados={r.por_plano.map((x) => ({ rotulo: x.plano, valor: x.pago }))} />
        <BarrasH titulo="Em aberto por fornecedor" dados={r.por_fornecedor.map((x) => ({ rotulo: x.nome, valor: x.saldo, tom: Number(x.vencido) > 0 ? 'erro' : undefined, detalhe: `${x.titulos} títulos${Number(x.vencido) ? ` · vencido ${moeda(x.vencido)}` : ''}` }))} />
      </div>
      <Secao titulo="Contas vencidas" csv={() => baixarCsv(`pagar-vencidas-${hoje()}`, [['Vencimento', (l) => dataBr(l.vencimento)], ['Fornecedor', (l) => l.fornecedor], ['Documento', (l) => l.documento], ['Histórico', (l) => l.historico], ['Saldo', (l) => Number(l.saldo)]], r.vencidas)}>
        <Tabela linhas={r.vencidas} aoClicar={() => navegar('/pagar?situacao=atrasado')} vazio="Nenhuma conta vencida." colunas={[
          { titulo: 'Vencimento', render: (l) => dataBr(l.vencimento) }, { titulo: 'Fornecedor', campo: 'fornecedor' }, { titulo: 'Documento', campo: 'documento' },
          { titulo: 'Histórico', campo: 'historico' }, { titulo: 'Saldo', render: (l) => moeda(l.saldo), alinhar: 'dir' }]} />
      </Secao>
    </div>
  );
}

// ---------------------------------------------------------------- financeiro
function RelFinanceiro({ ini, fim }) {
  const { dados: r, erro, carregando } = useRelatorio('rel_financeiro', { p_ini: ini, p_fim: fim }, [ini, fim]);
  if (!r) return <Carregando erro={erro} />;
  const c = r.caixa;
  const d = r.resultado;
  const agr = fim > somarDias(ini, 62) ? 'mes' : 'dia';
  const linhaDre = (rot, v, cls) => <tr className={cls}><td>{rot}</td><td className="al-dir">{moeda(v)}</td></tr>;
  return (
    <div className={`rel-conteudo${carregando ? ' carregando' : ''}`}>
      <div className="indicadores">
        <Indicador rotulo="Entradas no caixa" valor={c.entradas} tom="info" />
        <Indicador rotulo="Saídas do caixa" valor={c.saidas} />
        <Indicador rotulo="Saldo do caixa no período" valor={Number(c.entradas) - Number(c.saidas)} tom={Number(c.entradas) >= Number(c.saidas) ? 'ok' : 'erro'} />
        <Indicador rotulo="Resultado (lucro bruto − despesas pagas)" valor={d.resultado} tom={Number(d.resultado) >= 0 ? 'ok' : 'erro'} />
      </div>
      <ColunasDuplas titulo={`Caixa: entradas x saídas por ${agr === 'mes' ? 'mês' : 'dia'}`} nomes={['Entradas', 'Saídas']}
        dados={r.caixa_serie.map((x) => ({ rotulo: rotuloPeriodo(x.periodo, agr), a: x.entradas, b: x.saidas }))} />
      <div className="rel-grade">
        <div className="grafico">
          <div className="grafico-topo"><h2>Resultado do período (simplificado)</h2></div>
          <table className="tabela tabela-compacta dre"><tbody>
            {linhaDre('Vendas (sem frete)', d.vendas)}
            {linhaDre('(−) Custo das mercadorias vendidas', -d.custo_mercadoria)}
            {linhaDre('= Lucro bruto', d.lucro_bruto, 'dre-total')}
            {linhaDre('(−) Contas pagas no período', -d.despesas_pagas)}
            {linhaDre('= Resultado', d.resultado, Number(d.resultado) >= 0 ? 'dre-total dre-ok' : 'dre-total dre-erro')}
          </tbody></table>
          <p className="texto-fraco">Regime de caixa nas despesas (o que foi pago) e de competência nas vendas.
            {Number(d.cobertura_custo) < 98 && ` ${pct(100 - Number(d.cobertura_custo))} da receita é de itens sem custo cadastrado: o lucro real é menor.`}</p>
        </div>
        <div className="grafico">
          <div className="grafico-topo"><h2>Projeção: a receber x a pagar</h2></div>
          <table className="tabela tabela-compacta"><thead><tr><th>Vencimento</th><th className="al-dir">A receber</th><th className="al-dir">A pagar</th><th className="al-dir">Saldo</th></tr></thead>
            <tbody>{r.projecao.map((x) => {
              const sd = Number(x.receber) - Number(x.pagar);
              return <tr key={x.faixa}><td>{x.faixa}</td><td className="al-dir">{moeda(x.receber)}</td><td className="al-dir">{moeda(x.pagar)}</td><td className={`al-dir ${sd < 0 ? 'texto-erro' : 'texto-ok'}`}>{moeda(sd)}</td></tr>;
            })}</tbody></table>
        </div>
        <BarrasH titulo="Entradas no caixa por forma" dados={r.caixa_forma.filter((x) => Number(x.entradas) > 0).map((x) => ({ rotulo: x.forma, valor: x.entradas }))} />
        <BarrasH titulo="Saídas do caixa por plano de contas" dados={r.caixa_plano.filter((x) => Number(x.saidas) > 0).map((x) => ({ rotulo: x.plano, valor: x.saidas }))} />
      </div>
    </div>
  );
}

export default function Relatorios({ params }) {
  const aba = ABAS.some(([k]) => k === params.aba) ? params.aba : 'vendas';
  const [ini, setIni] = useState(params.de || inicioDoMes());
  const [fim, setFim] = useState(params.ate || hoje());
  const mudar = (a, b) => { setIni(a); setFim(b); };
  return (
    <Pagina titulo="Relatórios" subtitulo="Calculado na hora com os dados do ERP (inclui o que veio do DirectControl na última sincronização)"
      acoes={<><a className="btn btn-sec" href="#/contagem">Contagem de estoque</a><button type="button" className="btn btn-sec" onClick={() => window.print()}>Imprimir</button></>}>
      <div className="abas" role="tablist">
        {ABAS.map(([k, r]) => <button key={k} type="button" role="tab" aria-selected={aba === k} className={`aba${aba === k ? ' ativa' : ''}`} onClick={() => navegar(`/relatorios?aba=${k}`)}>{r}</button>)}
      </div>
      {aba !== 'estoque' && <Periodo ini={ini} fim={fim} aoMudar={mudar} />}
      {aba !== 'estoque' && <p className="rel-impresso">Período: {dataBr(ini)} a {dataBr(fim)}</p>}
      {aba === 'vendas' && <RelVendas ini={ini} fim={fim} />}
      {aba === 'estoque' && <RelEstoque />}
      {aba === 'receber' && <RelReceber ini={ini} fim={fim} />}
      {aba === 'pagar' && <RelPagar ini={ini} fim={fim} />}
      {aba === 'financeiro' && <RelFinanceiro ini={ini} fim={fim} />}
    </Pagina>
  );
}
