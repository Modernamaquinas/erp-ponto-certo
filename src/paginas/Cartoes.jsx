import { useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { moeda, data, hoje, inicioDoMes, somarDias } from '../lib/formato.js';
import { navegar } from '../lib/contexto.js';
import { Pagina, Filtros, Campo, Tabela, Paginacao, Modal, Etiqueta, Aviso, Cartao, useConsulta, useAvisar } from '../componentes/ui.jsx';

// Cartões e PIX passados no TEF (PayGo Web): Cielo, Stone, PagSeguro, Vero e PIX Shipay.
const POR_PAGINA = 50;
const REDES = ['CIELO', 'PAGSEGURO', 'STONE', 'VERO', 'SHIPAY'];
export const MODALIDADES = {
  debito: 'Débito', credito: 'Crédito à vista', credito_parcelado_loja: 'Crédito parcelado (loja)',
  credito_parcelado_adm: 'Crédito parcelado (administradora)', pix: 'PIX', voucher: 'Voucher', outro: 'Outro',
};
const SITUACAO = { aprovada: ['ok', 'Aprovada'], nao_concluida: ['neutra', 'Não concluída'], cancelada: ['erro', 'Cancelada'] };
const ABAS = [['transacoes', 'Transações'], ['receber', 'A receber'], ['taxas', 'Taxas das maquininhas']];
const quando = (dh) => (dh ? `${data(dh)} ${String(dh).slice(11, 16)}` : '');

export default function Cartoes({ params }) {
  const aba = params.aba || 'transacoes';
  return (
    <Pagina titulo="Cartões e PIX" subtitulo="TEF do caixa (PayGo Web) — Cielo, PagSeguro, Stone, Vero e PIX">
      <div className="abas" role="tablist">
        {ABAS.map(([id, rotulo]) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} className={`aba${aba === id ? ' ativa' : ''}`}
            onClick={() => navegar(id === 'transacoes' ? '/cartoes' : `/cartoes?aba=${id}`)}>{rotulo}</button>
        ))}
      </div>
      {aba === 'transacoes' && <Transacoes />}
      {aba === 'receber' && <AReceber />}
      {aba === 'taxas' && <Taxas />}
    </Pagina>
  );
}

function FiltroRede({ valor, aoMudar }) {
  return (
    <Campo rotulo="Adquirente">
      <select value={valor} onChange={aoMudar}>
        <option value="">Todas</option>
        {REDES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </Campo>
  );
}

function Transacoes() {
  const [f, setF] = useState({ de: inicioDoMes(), ate: hoje(), rede: '', situacao: 'aprovada', nsu: '' });
  const [pagina, setPagina] = useState(1);
  const mudar = (k) => (e) => { setPagina(1); setF((x) => ({ ...x, [k]: e.target.value })); };
  const aplicar = (q, comRede = true) => {
    if (f.nsu) return q.or(`nsu.eq.${f.nsu.replace(/[^\w-]/g, '')},autorizacao.eq.${f.nsu.replace(/[^\w-]/g, '')}`);
    q = q.gte('data', f.de).lte('data', f.ate).eq('operacao', 'venda');
    if (f.situacao) q = q.eq('situacao', f.situacao);
    if (comRede && f.rede) q = q.eq('rede', f.rede);
    return q;
  };

  const lista = useConsulta(async () => {
    const de = (pagina - 1) * POR_PAGINA;
    const r = ou(await aplicar(supabase.from('tef_transacoes').select('*', { count: 'exact' }))
      .order('data_hora', { ascending: false }).order('id', { ascending: false }).range(de, de + POR_PAGINA - 1));
    return { dados: r.data, total: r.count };
  }, [f, pagina]);

  // Somas por adquirente no banco (sem o filtro de adquirente, para comparar todas)
  const resumo = useConsulta(async () => {
    const r = ou(await aplicar(supabase.from('tef_transacoes').select('rede, total:valor.sum(), qtd:id.count()'), false));
    return { dados: r.data.map((x) => ({ rede: x.rede || 'SEM ADQUIRENTE', total: Number(x.total), qtd: Number(x.qtd) })).sort((a, b) => b.total - a.total) };
  }, [f]);
  const total = (resumo.dados || []).reduce((s, x) => s + x.total, 0);

  return (
    <>
      <Filtros>
        <Campo rotulo="De"><input type="date" value={f.de} onChange={mudar('de')} /></Campo>
        <Campo rotulo="Até"><input type="date" value={f.ate} onChange={mudar('ate')} /></Campo>
        <FiltroRede valor={f.rede} aoMudar={mudar('rede')} />
        <Campo rotulo="Situação">
          <select value={f.situacao} onChange={mudar('situacao')}>
            <option value="aprovada">Aprovadas</option>
            <option value="nao_concluida">Não concluídas</option>
            <option value="cancelada">Canceladas</option>
            <option value="">Todas</option>
          </select>
        </Campo>
        <Campo rotulo="NSU ou autorização"><input value={f.nsu} onChange={mudar('nsu')} /></Campo>
      </Filtros>
      {resumo.dados && !f.nsu && (
        <div className="cartoes">
          {resumo.dados.map((x) => (
            <Cartao key={x.rede} rotulo={x.rede} valor={moeda(x.total)}
              detalhe={`${x.qtd} transações · ${total ? Math.round((x.total / total) * 100) : 0}%`}
              tipo={f.rede === x.rede ? 'destaque' : undefined}
              onClick={() => { setPagina(1); setF((y) => ({ ...y, rede: y.rede === x.rede ? '' : x.rede })); }} />
          ))}
        </div>
      )}
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} vazio="Nenhuma transação no período."
        colunas={[
          { titulo: 'Data', render: (t) => quando(t.data_hora) },
          { titulo: 'Venda', render: (t) => (t.venda_id ? <a href={`#/vendas?numero=${t.venda_id}`} className="cod">{t.venda_id}</a> : '') },
          { titulo: 'Adquirente', campo: 'rede' },
          { titulo: 'Modalidade', render: (t) => `${MODALIDADES[t.modalidade] || ''}${t.parcelas > 1 ? ` ${t.parcelas}x` : ''}` },
          { titulo: 'Bandeira', campo: 'bandeira' },
          { titulo: 'NSU', campo: 'nsu', classe: 'cod' },
          { titulo: 'Autorização', campo: 'autorizacao', classe: 'cod' },
          { titulo: 'Valor', alinhar: 'dir', render: (t) => moeda(t.valor) },
          { titulo: 'Situação', render: (t) => <Etiqueta tipo={SITUACAO[t.situacao][0]}>{t.situacao === 'nao_concluida' && t.mensagem ? t.mensagem : SITUACAO[t.situacao][1]}</Etiqueta> },
        ]} />
      <Paginacao pagina={pagina} total={lista.total} porPagina={POR_PAGINA} aoMudar={setPagina} />
    </>
  );
}

function AReceber() {
  const [f, setF] = useState({ de: hoje(), ate: somarDias(hoje(), 60), rede: '' });
  const mudar = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const aplicar = (q) => {
    q = q.gte('previsao', f.de).lte('previsao', f.ate);
    return f.rede ? q.eq('rede', f.rede) : q;
  };
  // Agrupado por dia e adquirente no banco: poucas linhas mesmo com milhares de parcelas.
  const dias = useConsulta(async () => {
    const r = ou(await aplicar(supabase.from('v_cartoes_recebiveis')
      .select('previsao, rede, bruto:valor_bruto.sum(), liquido:valor_liquido.sum(), qtd:transacao_id.count()')));
    const porDia = new Map();
    for (const x of r.data) {
      const d = porDia.get(x.previsao) || { id: x.previsao, previsao: x.previsao, bruto: 0, liquido: 0, redes: [] };
      d.bruto += Number(x.bruto); d.liquido += Number(x.liquido || 0);
      d.redes.push(x.rede);
      porDia.set(x.previsao, d);
    }
    return { dados: [...porDia.values()].sort((a, b) => a.previsao.localeCompare(b.previsao)) };
  }, [f]);
  const semTaxa = useConsulta(async () => {
    const r = ou(await aplicar(supabase.from('v_cartoes_recebiveis').select('bruto:valor_bruto.sum(), qtd:transacao_id.count()')).is('taxa_percentual', null));
    return { dados: { bruto: Number(r.data[0]?.bruto || 0), qtd: Number(r.data[0]?.qtd || 0) } };
  }, [f]);
  const tot = (dias.dados || []).reduce((s, d) => ({ bruto: s.bruto + d.bruto, liquido: s.liquido + d.liquido }), { bruto: 0, liquido: 0 });
  const st = semTaxa.dados;

  return (
    <>
      <Filtros>
        <Campo rotulo="Cai de"><input type="date" value={f.de} onChange={mudar('de')} /></Campo>
        <Campo rotulo="Até"><input type="date" value={f.ate} onChange={mudar('ate')} /></Campo>
        <FiltroRede valor={f.rede} aoMudar={mudar('rede')} />
      </Filtros>
      {st && st.qtd > 0 && (
        <Aviso tipo="alerta">
          {st.qtd} parcela(s) somando {moeda(st.bruto)} sem taxa cadastrada: o valor líquido delas não entra na soma e a data
          usa o prazo padrão (débito D+1, crédito D+30). <a href="#/cartoes?aba=taxas">Cadastrar taxas</a>
        </Aviso>
      )}
      <div className="cartoes">
        <Cartao rotulo="Bruto a receber" valor={moeda(tot.bruto)} />
        <Cartao rotulo="Líquido previsto" valor={moeda(tot.liquido)} detalhe={st?.qtd ? 'só das parcelas com taxa' : 'já descontadas as taxas'} />
        <Cartao rotulo="Taxas" valor={moeda(tot.bruto - (st?.bruto || 0) - tot.liquido)} />
      </div>
      <Tabela carregando={dias.carregando} erro={dias.erro} linhas={dias.dados} vazio="Nada a receber no período."
        colunas={[
          { titulo: 'Previsão', render: (d) => data(d.previsao) },
          { titulo: 'Adquirentes', render: (d) => d.redes.join(', ') },
          { titulo: 'Bruto', alinhar: 'dir', render: (d) => moeda(d.bruto) },
          { titulo: 'Líquido', alinhar: 'dir', render: (d) => moeda(d.liquido) },
        ]} />
      <p className="texto-fraco">Previsão calculada pelas taxas e prazos cadastrados. A conferência com o extrato da adquirente
        (conciliação) vem depois.</p>
    </>
  );
}

function Taxas() {
  const avisar = useAvisar();
  const [editando, setEditando] = useState(null);
  const lista = useConsulta(async () => ({
    dados: ou(await supabase.from('cartao_taxas').select('*').order('rede').order('modalidade').order('parcelas_ate')).data,
  }), []);
  const temCielo = (lista.dados || []).some((t) => t.rede === 'CIELO');

  async function excluir(t) {
    try {
      ou(await supabase.from('cartao_taxas').delete().eq('id', t.id));
      avisar('Taxa excluída.');
      lista.recarregar();
    } catch (e) { avisar(e.message, 'erro'); }
  }

  return (
    <>
      {lista.dados && !temCielo && (
        <Aviso>Cadastre as taxas da <strong>Cielo</strong> (débito, crédito à vista e parceladas). Elas estão no contrato ou no
          app/site Cielo, em "Taxas e tarifas". Sem elas, a previsão de recebimento não desconta a taxa.</Aviso>
      )}
      <div className="barra-acoes">
        <button type="button" className="btn btn-pri" onClick={() => setEditando({})}>Nova taxa</button>
      </div>
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} aoClicar={setEditando}
        vazio="Nenhuma taxa cadastrada."
        colunas={[
          { titulo: 'Adquirente', campo: 'rede' },
          { titulo: 'Modalidade', render: (t) => MODALIDADES[t.modalidade] },
          { titulo: 'Parcelas', alinhar: 'centro', render: (t) => (t.modalidade.startsWith('credito_parcelado') ? `até ${t.parcelas_ate}x` : '') },
          { titulo: 'Taxa', alinhar: 'dir', render: (t) => `${Number(t.taxa_percentual).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}%` },
          { titulo: 'Recebe em', alinhar: 'dir', render: (t) => (t.dias_recebimento === 0 ? 'na hora' : `${t.dias_recebimento} dia(s)`) },
          { titulo: '', render: (t) => <button type="button" className="btn btn-sec btn-peq" onClick={(e) => { e.stopPropagation(); excluir(t); }}>Excluir</button> },
        ]} />
      {editando && <EditarTaxa taxa={editando} aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); lista.recarregar(); }} />}
    </>
  );
}

const PRAZO_SUGERIDO = { debito: 1, pix: 0, credito: 30, credito_parcelado_loja: 30, credito_parcelado_adm: 30, voucher: 30, outro: 30 };

function EditarTaxa({ taxa, aoFechar, aoSalvar }) {
  const avisar = useAvisar();
  const [t, setT] = useState({
    rede: taxa.rede || 'CIELO', modalidade: taxa.modalidade || 'debito', parcelas_ate: String(taxa.parcelas_ate || 1),
    taxa_percentual: taxa.taxa_percentual != null ? String(taxa.taxa_percentual).replace('.', ',') : '',
    dias_recebimento: taxa.dias_recebimento != null ? String(taxa.dias_recebimento) : '1',
  });
  const [salvando, setSalvando] = useState(false);
  const set = (k) => (e) => {
    const v = e.target.value;
    setT((x) => ({ ...x, [k]: v, ...(k === 'modalidade' && !taxa.id ? { dias_recebimento: String(PRAZO_SUGERIDO[v]), parcelas_ate: '1' } : {}) }));
  };
  const parcelado = t.modalidade.startsWith('credito_parcelado');

  async function salvar(e) {
    e.preventDefault();
    const linha = {
      rede: t.rede.trim().toUpperCase(), modalidade: t.modalidade, parcelas_ate: parcelado ? Number(t.parcelas_ate) : 1,
      taxa_percentual: Number(String(t.taxa_percentual).replace(',', '.')), dias_recebimento: Number(t.dias_recebimento),
    };
    if (!linha.rede) return avisar('Informe a adquirente.', 'erro');
    if (!(linha.taxa_percentual >= 0 && linha.taxa_percentual < 100)) return avisar('Taxa inválida.', 'erro');
    if (!(linha.dias_recebimento >= 0) || !Number.isInteger(linha.dias_recebimento)) return avisar('Prazo inválido.', 'erro');
    if (parcelado && !(linha.parcelas_ate >= 2 && linha.parcelas_ate <= 24)) return avisar('Parcelas: de 2 a 24.', 'erro');
    setSalvando(true);
    try {
      ou(taxa.id ? await supabase.from('cartao_taxas').update(linha).eq('id', taxa.id) : await supabase.from('cartao_taxas').insert(linha));
      avisar('Taxa salva.');
      aoSalvar();
    } catch (erro) {
      avisar(/duplicate|unique/i.test(erro.message) ? 'Já existe taxa para essa adquirente, modalidade e faixa de parcelas.' : erro.message, 'erro');
      setSalvando(false);
    }
  }

  return (
    <Modal aberto titulo={taxa.id ? 'Editar taxa' : 'Nova taxa'} aoFechar={aoFechar}
      rodape={<>
        <button type="button" className="btn btn-sec" onClick={aoFechar}>Cancelar</button>
        <button type="submit" form="form-taxa" className="btn btn-pri" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      </>}>
      <form id="form-taxa" className="form-grade" onSubmit={salvar}>
        <Campo rotulo="Adquirente">
          <input list="redes-tef" value={t.rede} onChange={set('rede')} />
          <datalist id="redes-tef">{REDES.map((r) => <option key={r} value={r} />)}</datalist>
        </Campo>
        <Campo rotulo="Modalidade">
          <select value={t.modalidade} onChange={set('modalidade')}>
            {Object.entries(MODALIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        {parcelado && (
          <Campo rotulo="Vale até quantas parcelas">
            <input type="number" min="2" max="24" value={t.parcelas_ate} onChange={set('parcelas_ate')} />
          </Campo>
        )}
        <Campo rotulo="Taxa (%)"><input inputMode="decimal" value={t.taxa_percentual} onChange={set('taxa_percentual')} placeholder="ex.: 1,39" /></Campo>
        <Campo rotulo="Recebe em (dias)"><input type="number" min="0" max="400" value={t.dias_recebimento} onChange={set('dias_recebimento')} /></Campo>
      </form>
      {parcelado && <p className="texto-fraco">Ex.: uma taxa "até 6x" e outra "até 12x". Vale a menor faixa que cobre a venda.
        No parcelado pela loja cada parcela cai 30 dias depois da anterior.</p>}
    </Modal>
  );
}
