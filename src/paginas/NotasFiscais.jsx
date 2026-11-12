import { useState } from 'react';
import { supabase, api, ou } from '../lib/supabase.js';
import { moeda, numero, data, dataHora, documento, hoje, somarDias, filtrarBusca } from '../lib/formato.js';
import { navegar, usePerfil, podeFinanceiro } from '../lib/contexto.js';
import { imprimirNota, acaoAposEmitir, lerImpressora, salvarImpressora } from '../lib/impressao.js';
import { Pagina, Filtros, Campo, Tabela, Paginacao, Modal, Etiqueta, Aviso, Detalhes, useConsulta, useAtrasado, useAvisar } from '../componentes/ui.jsx';

// NFC-e (65) e NF-e (55) emitidas pelo ERP via Focus NFe. As notas do DirectControl continuam lá (Fase 1).
const POR_PAGINA = 50;
const STATUS = {
  processando: ['info', 'Processando'], autorizada: ['ok', 'Autorizada'], rejeitada: ['alerta', 'Rejeitada'],
  denegada: ['erro', 'Denegada'], cancelada: ['neutra', 'Cancelada'], erro: ['erro', 'Sem resposta'],
};
const MODELO = { 65: 'NFC-e', 55: 'NF-e' };
const FORMAS = [['dinheiro', 'Dinheiro'], ['pix', 'PIX'], ['debito', 'Cartão de débito'], ['credito', 'Cartão de crédito'],
  ['boleto', 'Boleto'], ['crediario', 'Crediário da loja'], ['transferencia', 'Transferência'], ['outros', 'Outros']];
const etiqueta = (s) => <Etiqueta tipo={STATUS[s]?.[0]}>{STATUS[s]?.[1] || s}</Etiqueta>;

// DANFE (PDF) e DANFCE (HTML) abrem numa aba; XML é baixado.
function abrirArquivo({ nome, base64, tipo }) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const mime = (tipo || '').split(';')[0] || 'application/octet-stream';
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  if (/pdf|html/.test(mime)) window.open(url, '_blank', 'noopener');
  else { const a = document.createElement('a'); a.href = url; a.download = nome; a.click(); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function NotasFiscais({ params }) {
  const perfil = usePerfil();
  const aba = params.aba || 'notas';
  const cfg = useConsulta(async () => ({ dados: ou(await supabase.from('fiscal_config').select('*').eq('id', 1).single()).data }), []);
  const abas = [['notas', 'Notas emitidas'], ['emitir', 'Emitir nota'], ['impressora', 'Impressora'], ...(perfil.papel === 'admin' ? [['config', 'Configuração']] : [])];
  const ambiente = cfg.dados?.ambiente;
  return (
    <Pagina titulo="Notas Fiscais" subtitulo="NFC-e e NF-e emitidas pelo ERP (SEFAZ-RS, via Focus NFe)"
      acoes={ambiente && <Etiqueta tipo={ambiente === 'producao' ? 'ok' : 'alerta'}>{ambiente === 'producao' ? 'Produção' : 'Homologação (teste, sem valor fiscal)'}</Etiqueta>}>
      <div className="abas" role="tablist">
        {abas.map(([id, rotulo]) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} className={`aba${aba === id ? ' ativa' : ''}`}
            onClick={() => navegar(id === 'notas' ? '/notas' : `/notas?aba=${id}`)}>{rotulo}</button>
        ))}
      </div>
      <StatusSefaz />
      {aba === 'notas' && <ListaNotas />}
      {aba === 'emitir' && cfg.dados && <EmitirNota cfg={cfg.dados} />}
      {aba === 'impressora' && <ConfigImpressora />}
      {aba === 'config' && cfg.dados && <Configuracao cfg={cfg.dados} aoSalvar={cfg.recarregar} />}
    </Pagina>
  );
}

function StatusSefaz() {
  const [s, setS] = useState(null);
  const [carregando, setCarregando] = useState(false);
  async function verificar() {
    setCarregando(true);
    try { setS(await api('fiscal', { corpo: { acao: 'status' } })); } catch (e) { setS({ ok: false, erro: e.message }); }
    setCarregando(false);
  }
  return (
    <div className="resumo-linha">
      <button type="button" className="btn btn-sec btn-peq" onClick={verificar} disabled={carregando}>{carregando ? 'Verificando…' : 'Verificar conexão'}</button>
      {s?.erro && <span className="texto-erro">{s.erro}</span>}
      {s && s.configurada === false && <span className="texto-erro">Focus NFe sem token de {s.ambiente} na Vercel (FOCUS_TOKEN_{String(s.ambiente).toUpperCase()}).</span>}
      {s?.configurada && s.ok && <span>Focus NFe conectada ({s.ambiente}) ✓</span>}
    </div>
  );
}

function ListaNotas() {
  const avisar = useAvisar();
  const [f, setF] = useState({ de: somarDias(hoje(), -30), ate: hoje(), modelo: '', status: '' });
  const [pagina, setPagina] = useState(1);
  const [aberta, setAberta] = useState(null);
  const mudar = (k) => (e) => { setPagina(1); setF((x) => ({ ...x, [k]: e.target.value })); };
  const lista = useConsulta(async () => {
    const de = (pagina - 1) * POR_PAGINA;
    let q = supabase.from('notas_fiscais').select('id, modelo, serie, numero, ambiente, status, destinatario_nome, destinatario_doc, valor_total, chave, protocolo, motivo, emitida_em, cancelada_em, justificativa_cancelamento, usuario, criado_em, venda_id', { count: 'exact' })
      .gte('criado_em', `${f.de}T00:00:00-03:00`).lte('criado_em', `${f.ate}T23:59:59-03:00`);
    if (f.modelo) q = q.eq('modelo', Number(f.modelo));
    if (f.status) q = q.eq('status', f.status);
    const r = ou(await q.order('criado_em', { ascending: false }).range(de, de + POR_PAGINA - 1));
    return { dados: r.data, total: r.count };
  }, [f, pagina]);

  async function acao(nota, acao) {
    try {
      const r = await api('fiscal', { corpo: { acao, id: nota.id } });
      if (acao === 'danfe' || acao === 'xml') abrirArquivo(r);
      else { avisar(`Situação: ${STATUS[r.nota.status]?.[1] || r.nota.status}`); setAberta(r.nota); lista.recarregar(); }
    } catch (e) { avisar(e.message, 'erro'); }
  }

  return (
    <>
      <Filtros>
        <Campo rotulo="De"><input type="date" value={f.de} onChange={mudar('de')} /></Campo>
        <Campo rotulo="Até"><input type="date" value={f.ate} onChange={mudar('ate')} /></Campo>
        <Campo rotulo="Modelo">
          <select value={f.modelo} onChange={mudar('modelo')}><option value="">Todos</option><option value="65">NFC-e</option><option value="55">NF-e</option></select>
        </Campo>
        <Campo rotulo="Situação">
          <select value={f.status} onChange={mudar('status')}>
            <option value="">Todas</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}
          </select>
        </Campo>
      </Filtros>
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} aoClicar={setAberta} vazio="Nenhuma nota emitida pelo ERP no período."
        colunas={[
          { titulo: 'Data', render: (n) => dataHora(n.emitida_em || n.criado_em) },
          { titulo: 'Nota', render: (n) => <><strong>{MODELO[n.modelo]}</strong> {n.serie}/{n.numero}{n.ambiente === 'homologacao' && <> <Etiqueta tipo="alerta">teste</Etiqueta></>}</> },
          { titulo: 'Destinatário', render: (n) => n.destinatario_nome || (n.destinatario_doc ? documento(n.destinatario_doc) : 'CONSUMIDOR') },
          { titulo: 'Valor', alinhar: 'dir', render: (n) => moeda(n.valor_total) },
          { titulo: 'Situação', render: (n) => etiqueta(n.status) },
          { titulo: '', render: (n) => (['autorizada', 'cancelada'].includes(n.status)
            ? <button type="button" className="btn btn-sec btn-peq" onClick={(e) => { e.stopPropagation(); acao(n, 'danfe'); }}>DANFE</button>
            : ['processando', 'erro'].includes(n.status)
              ? <button type="button" className="btn btn-sec btn-peq" onClick={(e) => { e.stopPropagation(); acao(n, 'consultar'); }}>Consultar</button> : null) },
        ]} />
      <Paginacao pagina={pagina} total={lista.total} porPagina={POR_PAGINA} aoMudar={setPagina} />
      {aberta && <DetalheNota nota={aberta} aoFechar={() => setAberta(null)} aoAcao={acao} aoCancelar={() => { setAberta(null); lista.recarregar(); }} />}
    </>
  );
}

function DetalheNota({ nota: n, aoFechar, aoAcao, aoCancelar }) {
  const perfil = usePerfil();
  const avisar = useAvisar();
  const [cancelando, setCancelando] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [enviando, setEnviando] = useState(false);
  async function cancelar() {
    setEnviando(true);
    try {
      await api('fiscal', { corpo: { acao: 'cancelar', id: n.id, justificativa } });
      avisar('Nota cancelada na SEFAZ.');
      aoCancelar();
    } catch (e) { avisar(e.message, 'erro'); setEnviando(false); }
  }
  return (
    <Modal aberto largo titulo={`${MODELO[n.modelo]} ${n.serie}/${n.numero}`} aoFechar={aoFechar}
      rodape={<>
        {['autorizada', 'cancelada'].includes(n.status) && <>
          <button type="button" className="btn btn-sec" onClick={() => aoAcao(n, 'xml')}>XML</button>
          <button type="button" className="btn btn-sec" onClick={() => aoAcao(n, 'danfe')}>DANFE</button>
          {n.status === 'autorizada' && <BotaoImprimir id={n.id} classe="btn btn-pri" />}
        </>}
        {['processando', 'erro'].includes(n.status) && <button type="button" className="btn btn-sec" onClick={() => aoAcao(n, 'consultar')}>Consultar SEFAZ</button>}
        {n.status === 'autorizada' && podeFinanceiro(perfil) && !cancelando &&
          <button type="button" className="btn btn-perigo" onClick={() => setCancelando(true)}>Cancelar nota</button>}
      </>}>
      <Detalhes itens={[
        ['Situação', etiqueta(n.status)], ['Ambiente', n.ambiente === 'producao' ? 'Produção' : 'Homologação (sem valor fiscal)'],
        ['Valor', moeda(n.valor_total)], ['Destinatário', n.destinatario_nome || (n.destinatario_doc ? documento(n.destinatario_doc) : 'Consumidor')],
        ['Chave de acesso', n.chave && <span className="cod">{n.chave}</span>], ['Protocolo', n.protocolo],
        ['Retorno da SEFAZ', n.motivo], ['Emitida em', n.emitida_em && dataHora(n.emitida_em)], ['Emitida por', n.usuario],
        ['Venda', n.venda_id], ['Cancelada em', n.cancelada_em && dataHora(n.cancelada_em)], ['Motivo do cancelamento', n.justificativa_cancelamento],
      ]} />
      {n.status === 'rejeitada' && <Aviso tipo="alerta">A SEFAZ recusou esta nota, e o número dela será usado na próxima. Corrija o cadastro (NCM, CFOP, cliente) e emita de novo.</Aviso>}
      {n.status === 'erro' && <Aviso tipo="erro">Não houve resposta da SEFAZ. Clique em "Consultar SEFAZ" antes de emitir de novo, para não duplicar a nota.</Aviso>}
      {cancelando && (
        <div className="form-grade">
          <Campo rotulo="Justificativa do cancelamento (mín. 15 letras)" largo>
            <input value={justificativa} onChange={(e) => setJustificativa(e.target.value)} maxLength={255} autoFocus />
          </Campo>
          <div className="form-acoes">
            <button type="button" className="btn btn-sec" onClick={() => setCancelando(false)}>Voltar</button>
            <button type="button" className="btn btn-perigo" disabled={enviando || justificativa.trim().length < 15} onClick={cancelar}>
              {enviando ? 'Cancelando…' : 'Confirmar cancelamento'}</button>
          </div>
          <p className="texto-fraco">NFC-e: até 30 minutos depois da emissão. NF-e: até 24 horas. Depois disso só com nota de devolução.</p>
        </div>
      )}
    </Modal>
  );
}

export function BuscaProduto({ aoEscolher }) {
  const [termo, setTermo] = useState('');
  const busca = useAtrasado(termo);
  const r = useConsulta(async () => {
    if (busca.trim().length < 2) return { dados: [] };
    let q = supabase.from('produtos').select('id, nome, preco_venda, ncm, cfop, cst_csosn, codigo_barras, estoque, unidade').eq('ativo', true);
    if (/^\d{8,14}$/.test(busca.trim())) q = q.eq('codigo_barras', busca.trim());
    else if (/^\d{1,7}$/.test(busca.trim())) q = q.eq('id', Number(busca.trim()));
    else q = filtrarBusca(q, busca);
    return { dados: ou(await q.order('nome').limit(15)).data };
  }, [busca]);
  return (
    <div className="busca-produto">
      <Campo rotulo="Adicionar produto (nome, código ou código de barras)" largo>
        <input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="ex.: fita isolante" />
      </Campo>
      {(r.dados || []).length > 0 && (
        <ul className="lista-escolha">
          {r.dados.map((p) => (
            <li key={p.id}><button type="button" onClick={() => { aoEscolher(p); setTermo(''); }}>
              <span className="cod">{p.id}</span> {p.nome} — {moeda(p.preco_venda)}{!p.ncm && <Etiqueta tipo="erro">sem NCM</Etiqueta>}
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BuscaCliente({ cliente, aoEscolher }) {
  const [termo, setTermo] = useState('');
  const busca = useAtrasado(termo);
  const r = useConsulta(async () => {
    if (busca.trim().length < 2) return { dados: [] };
    let q = supabase.from('clientes').select('id, nome, cpf_cnpj, cidades(nome, uf)').eq('ativo', true);
    q = /^\d{11,14}$/.test(busca.replace(/\D/g, '')) ? q.eq('cpf_cnpj', busca.replace(/\D/g, '')) : filtrarBusca(q, busca);
    return { dados: ou(await q.order('nome').limit(10)).data };
  }, [busca]);
  if (cliente) {
    return (
      <div className="resumo-linha">
        <span>Cliente: <strong>{cliente.nome}</strong> {documento(cliente.cpf_cnpj)} {cliente.cidades && `— ${cliente.cidades.nome}/${cliente.cidades.uf}`}</span>
        <button type="button" className="btn btn-sec btn-peq" onClick={() => aoEscolher(null)}>Trocar</button>
      </div>
    );
  }
  return (
    <div className="busca-produto">
      <Campo rotulo="Cliente (nome ou CPF/CNPJ)" largo><input value={termo} onChange={(e) => setTermo(e.target.value)} /></Campo>
      {(r.dados || []).length > 0 && (
        <ul className="lista-escolha">
          {r.dados.map((c) => <li key={c.id}><button type="button" onClick={() => { aoEscolher(c); setTermo(''); }}>
            {c.nome} — {documento(c.cpf_cnpj) || 'sem documento'} {c.cidades && `(${c.cidades.nome}/${c.cidades.uf})`}</button></li>)}
        </ul>
      )}
    </div>
  );
}

const num = (v) => Number(String(v ?? '').replace(',', '.')) || 0;

function EmitirNota({ cfg }) {
  const perfil = usePerfil();
  const avisar = useAvisar();
  const [modelo, setModelo] = useState(65);
  const [cliente, setCliente] = useState(null);
  const [cpf, setCpf] = useState('');
  const [itens, setItens] = useState([]);
  const [pagamentos, setPagamentos] = useState([{ forma: 'dinheiro', valor: '' }]);
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [perguntaImprimir, setPerguntaImprimir] = useState(null);

  const total = itens.reduce((s, i) => s + Math.round(num(i.quantidade) * num(i.valor_unitario) * 100) / 100 - num(i.desconto), 0);
  const pago = pagamentos.reduce((s, p) => s + num(p.valor), 0);
  const setItem = (k, campo) => (e) => setItens((l) => l.map((x, j) => (j === k ? { ...x, [campo]: e.target.value } : x)));
  const setPag = (k, campo) => (e) => setPagamentos((l) => l.map((x, j) => (j === k ? { ...x, [campo]: e.target.value } : x)));
  const podeNfe = podeFinanceiro(perfil);

  async function emitir() {
    setEnviando(true); setResultado(null);
    try {
      const pags = pagamentos.length === 1 && !num(pagamentos[0].valor) ? [{ ...pagamentos[0], valor: total }] : pagamentos;
      const r = await api('fiscal', { corpo: {
        acao: 'emitir', modelo, cliente_id: cliente?.id, cpf: modelo === 65 && !cliente ? cpf : undefined, inf_complementar: obs || undefined,
        itens: itens.map((i) => ({ produto_id: i.id, quantidade: num(i.quantidade), valor_unitario: num(i.valor_unitario), desconto: num(i.desconto) })),
        pagamentos: pags.map((p) => ({ forma: p.forma, valor: num(p.valor) })),
      } });
      setResultado(r.nota);
      if (r.nota.status === 'autorizada') {
        const acao = acaoAposEmitir(r.nota.modelo);
        if (acao === 'automatico') imprimirNota(r.nota.id).catch((e) => avisar(`Impressão: ${e.message}`, 'erro'));
        else if (acao === 'perguntar') setPerguntaImprimir(r.nota);
        avisar(`${MODELO[modelo]} ${r.nota.numero} autorizada.`);
        setItens([]); setPagamentos([{ forma: 'dinheiro', valor: '' }]); setCliente(null); setCpf(''); setObs('');
      } else avisar(`SEFAZ: ${r.nota.motivo || STATUS[r.nota.status][1]}`, 'erro');
    } catch (e) { avisar(e.message, 'erro'); }
    setEnviando(false);
  }

  return (
    <div className="emitir-nota">
      {cfg.ambiente === 'homologacao' && <Aviso tipo="alerta">Ambiente de <strong>homologação</strong>: as notas vão para a SEFAZ de teste e não têm valor fiscal. Use para validar antes de passar para produção.</Aviso>}
      {cfg.ambiente === 'producao' && <Aviso>Enquanto o caixa estiver no DirectControl, não emita aqui nota de uma venda que já teve NFC-e lá.</Aviso>}
      <Filtros>
        <Campo rotulo="Modelo">
          <select value={modelo} onChange={(e) => setModelo(Number(e.target.value))}>
            <option value={65}>NFC-e (consumidor, série {cfg.serie_nfce})</option>
            {podeNfe && <option value={55}>NF-e (série {cfg.serie_nfe})</option>}
          </select>
        </Campo>
        {modelo === 65 && !cliente && <Campo rotulo="CPF/CNPJ na nota (opcional)"><input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" /></Campo>}
      </Filtros>
      <BuscaCliente cliente={cliente} aoEscolher={setCliente} />
      {modelo === 55 && !cliente && <p className="texto-fraco">NF-e exige cliente com CPF/CNPJ e endereço completo no cadastro.</p>}

      <h3>Produtos</h3>
      <BuscaProduto aoEscolher={(p) => setItens((l) => [...l, { ...p, quantidade: '1', valor_unitario: String(p.preco_venda).replace('.', ','), desconto: '' }])} />
      <Tabela linhas={itens.map((x, k) => ({ ...x, k }))} chave="k" vazio="Nenhum produto adicionado."
        colunas={[
          { titulo: 'Produto', render: (i) => <><span className="cod">{i.id}</span> {i.nome} {!i.ncm && <Etiqueta tipo="erro">sem NCM</Etiqueta>}</> },
          { titulo: 'Qtd', render: (i) => <input className="input-peq" inputMode="decimal" value={i.quantidade} onChange={setItem(i.k, 'quantidade')} /> },
          { titulo: 'Unitário', render: (i) => <input className="input-peq" inputMode="decimal" value={i.valor_unitario} onChange={setItem(i.k, 'valor_unitario')} /> },
          { titulo: 'Desconto', render: (i) => <input className="input-peq" inputMode="decimal" value={i.desconto} onChange={setItem(i.k, 'desconto')} placeholder="0,00" /> },
          { titulo: 'Total', alinhar: 'dir', render: (i) => moeda(num(i.quantidade) * num(i.valor_unitario) - num(i.desconto)) },
          { titulo: '', render: (i) => <button type="button" className="btn btn-sec btn-peq" onClick={() => setItens((l) => l.filter((_, j) => j !== i.k))}>Remover</button> },
        ]} />

      <h3>Pagamento</h3>
      {pagamentos.map((p, k) => (
        <Filtros key={k}>
          <Campo rotulo="Forma"><select value={p.forma} onChange={setPag(k, 'forma')}>{FORMAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></Campo>
          <Campo rotulo="Valor"><input inputMode="decimal" value={p.valor} onChange={setPag(k, 'valor')} placeholder={pagamentos.length === 1 ? numero(total) : ''} /></Campo>
          {pagamentos.length > 1 && <button type="button" className="btn btn-sec btn-peq" onClick={() => setPagamentos((l) => l.filter((_, j) => j !== k))}>Remover</button>}
        </Filtros>
      ))}
      <button type="button" className="btn btn-sec btn-peq" onClick={() => setPagamentos((l) => [...l, { forma: 'pix', valor: '' }])}>+ outra forma</button>
      <Campo rotulo="Informações complementares (opcional)" largo><input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} /></Campo>

      <div className="resumo-linha">
        <span>Total da nota: <strong>{moeda(total)}</strong></span>
        {pagamentos.some((p) => num(p.valor)) && <span>Pago: <strong>{moeda(pago)}</strong>{pago > total && ` (troco ${moeda(pago - total)})`}</span>}
        <button type="button" className="btn btn-pri" disabled={enviando || !itens.length || (modelo === 55 && !cliente)} onClick={emitir}>
          {enviando ? 'Enviando à SEFAZ…' : `Emitir ${MODELO[modelo]}`}</button>
      </div>
      {perguntaImprimir && (
        <Modal aberto titulo={`${MODELO[perguntaImprimir.modelo]} ${perguntaImprimir.serie}/${perguntaImprimir.numero} autorizada`} aoFechar={() => setPerguntaImprimir(null)}
          rodape={<>
            <button type="button" className="btn btn-sec" onClick={() => setPerguntaImprimir(null)}>Não imprimir</button>
            <BotaoImprimir id={perguntaImprimir.id} classe="btn btn-pri" texto="Imprimir nota" autoFoco aoTerminar={() => setPerguntaImprimir(null)} />
          </>}>
          <p>Venda concluída e nota autorizada pela SEFAZ. Deseja imprimir {perguntaImprimir.modelo === 65 ? 'o cupom (DANFCE)' : 'o DANFE'}?</p>
          <p className="texto-fraco">Para não perguntar mais, mude em Notas Fiscais → Impressora.</p>
        </Modal>
      )}
      {resultado && resultado.status !== 'autorizada' && (
        <Aviso tipo="erro">{STATUS[resultado.status]?.[1]}: {resultado.motivo}</Aviso>
      )}
      {resultado?.status === 'autorizada' && (
        <Aviso tipo="ok">{MODELO[resultado.modelo]} {resultado.serie}/{resultado.numero} autorizada. Chave {resultado.chave}.{' '}
          <a href="#/notas">Ver notas</a> <BotaoImprimir id={resultado.id} classe="btn btn-sec btn-peq" /></Aviso>
      )}
    </div>
  );
}

function Configuracao({ cfg, aoSalvar }) {
  const avisar = useAvisar();
  const [c, setC] = useState({ ...cfg, inf_complementar: cfg.inf_complementar || '' });
  const [salvando, setSalvando] = useState(false);
  const set = (k) => (e) => setC({ ...c, [k]: e.target.value });
  async function salvar(e) {
    e.preventDefault();
    if (c.ambiente === 'producao' && cfg.ambiente !== 'producao'
      && !window.confirm('Passar para PRODUÇÃO? As próximas notas terão valor fiscal. Rode antes "npm run fiscal:configurar -- producao".')) return;
    setSalvando(true);
    try {
      ou(await supabase.from('fiscal_config').update({ ambiente: c.ambiente, serie_nfce: Number(c.serie_nfce), serie_nfe: Number(c.serie_nfe),
        natureza_operacao: c.natureza_operacao.trim().toUpperCase(), inf_complementar: c.inf_complementar.trim() || null }).eq('id', 1));
      avisar('Configuração salva.');
      aoSalvar();
    } catch (erro) { avisar(erro.message, 'erro'); }
    setSalvando(false);
  }
  return (
    <form className="form-grade" onSubmit={salvar} style={{ maxWidth: 640, marginTop: 16 }}>
      <Campo rotulo="Ambiente da SEFAZ">
        <select value={c.ambiente} onChange={set('ambiente')}>
          <option value="homologacao">Homologação (teste)</option>
          <option value="producao">Produção</option>
        </select>
      </Campo>
      <Campo rotulo="Natureza da operação"><input value={c.natureza_operacao} onChange={set('natureza_operacao')} maxLength={60} /></Campo>
      <Campo rotulo="Série da NFC-e"><input type="number" min="1" max="889" value={c.serie_nfce} onChange={set('serie_nfce')} /></Campo>
      <Campo rotulo="Série da NF-e"><input type="number" min="1" max="889" value={c.serie_nfe} onChange={set('serie_nfe')} /></Campo>
      <Campo rotulo="Texto fixo nas informações complementares" largo><input value={c.inf_complementar} onChange={set('inf_complementar')} maxLength={500} /></Campo>
      <p className="texto-fraco campo-largo">O DirectControl usa NF-e série 1 e NFC-e séries 3 e 5. Mantenha séries diferentes enquanto os dois emitirem.
        Certificado e CSC ficam na Focus NFe (instalados pelo script <code>npm run fiscal:configurar</code>).</p>
      <div className="form-acoes"><button type="submit" className="btn btn-pri" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button></div>
    </form>
  );
}

function BotaoImprimir({ id, classe = 'btn btn-sec btn-peq', texto = 'Imprimir', autoFoco, aoTerminar }) {
  const avisar = useAvisar();
  const [imprimindo, setImprimindo] = useState(false);
  async function imprimir(e) {
    e?.stopPropagation();
    setImprimindo(true);
    try { await imprimirNota(id); aoTerminar?.(); } catch (erro) { avisar(`Impressão: ${erro.message}`, 'erro'); }
    setImprimindo(false);
  }
  return <button type="button" className={classe} onClick={imprimir} disabled={imprimindo} autoFocus={autoFoco}>{imprimindo ? 'Preparando…' : texto}</button>;
}

function ConfigImpressora() {
  const avisar = useAvisar();
  const [c, setC] = useState(lerImpressora);
  const set = (k) => (e) => setC({ ...c, [k]: e.target.value });
  function salvar(e) {
    e.preventDefault();
    if (salvarImpressora({ ...c, vias: Number(c.vias) || 1 })) avisar('Configuração de impressão salva neste computador.');
    else avisar('O navegador bloqueou o armazenamento local; a configuração não foi salva.', 'erro');
  }
  return (
    <form className="form-grade" onSubmit={salvar} style={{ maxWidth: 720, marginTop: 16 }}>
      <p className="texto-fraco campo-largo">Vale só para <strong>este computador</strong>, já que cada caixa tem a sua impressora.</p>
      <Campo rotulo="Depois de autorizar uma NFC-e">
        <select value={c.aposEmitir} onChange={set('aposEmitir')}>
          <option value="perguntar">Perguntar "Imprimir nota?"</option>
          <option value="automatico">Imprimir automaticamente</option>
          <option value="nunca">Não imprimir</option>
        </select>
      </Campo>
      <Campo rotulo="Depois de autorizar uma NF-e">
        <select value={c.nfe} onChange={set('nfe')}>
          <option value="perguntar">Perguntar "Imprimir nota?"</option>
          <option value="automatico">Imprimir automaticamente</option>
          <option value="nunca">Não imprimir</option>
        </select>
      </Campo>
      <Campo rotulo="Largura do papel do cupom">
        <select value={c.largura} onChange={set('largura')}>
          <option value="80">80 mm (Epson TM-T20II — impressora da loja)</option>
          <option value="58">58 mm</option>
          <option value="A4">Folha A4 (impressora comum)</option>
        </select>
      </Campo>
      <Campo rotulo="Vias do cupom">
        <select value={c.vias} onChange={set('vias')}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select>
      </Campo>
      <div className="form-acoes"><button type="submit" className="btn btn-pri">Salvar</button></div>
      <div className="campo-largo">
        <h3>Como deixar a Epson imprimindo direto</h3>
        <ol className="texto-ajuda">
          <li><strong>Pré-configuração automática:</strong> em Etiquetas → Configurar, baixe e rode o <code>instalar.cmd</code> (como administrador).
            Ele compartilha a Elgin L42 Pro Full como <code>L42</code>, deixa a <strong>Epson TM-T20II</strong> como padrão do Windows, prepara a
            <strong>HP Laser 107w</strong> para o DANFE A4 e cria
            na área de trabalho o atalho <strong>"ERP Ponto Certo - Caixa"</strong>, que imprime o cupom direto. Os passos abaixo são o mesmo, à mão.</li>
          <li>Instale o driver da Epson (Epson Advanced Printer Driver) e deixe a impressora como <strong>padrão do Windows</strong>.
            Em Preferências de impressão, escolha o papel <strong>80 x 297 mm</strong> (ou "Roll Paper 80mm").</li>
          <li>O cupom da NFC-e (DANFCE) sai na térmica. O DANFE da NF-e é folha A4 e vai direto para a <strong>HP Laser 107w</strong> pelo agente de impressão
            (instalado pelo <code>instalar.cmd</code>); sem o agente, ele abre a janela de impressão para você escolher a HP.</li>
          <li>Para imprimir <strong>sem a janela de impressão</strong>, crie um atalho do Chrome no caixa com o destino:<br />
            <code>"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing https://erp-ponto-certo.vercel.app</code><br />
            Abrindo o ERP por esse atalho, tudo vai direto para a impressora padrão.</li>
          <li>Se a sua Epson for uma impressora <strong>fiscal antiga (ECF)</strong>, ela não imprime NFC-e. A NFC-e precisa de impressora não fiscal (térmica comum).</li>
        </ol>
        <BotaoTeste />
      </div>
    </form>
  );
}

function BotaoTeste() {
  const teste = () => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
    f.srcdoc = '<html><head><style>@page{size:80mm auto;margin:0}body{width:72mm;font:12px monospace;text-align:center}</style></head><body><b>PONTO CERTO FERRAGENS</b><br/>Teste de impressão do ERP<br/>' + new Date().toLocaleString('pt-BR') + '<br/>--------------------------------<br/>Se você está lendo isto, a impressora está ok.</body></html>';
    f.onload = () => { f.contentWindow.print(); setTimeout(() => f.remove(), 30000); };
    document.body.appendChild(f);
  };
  return <button type="button" className="btn btn-sec" onClick={teste}>Imprimir página de teste</button>;
}
