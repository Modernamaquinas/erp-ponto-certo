import { useEffect, useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { moeda, numero } from '../lib/formato.js';
import { gerarPPLA, colunasDoModelo, usaVariavel, totalEtiquetas } from '../lib/etiquetas.js';
import PreviaEtiqueta from '../componentes/PreviaEtiqueta.jsx';
import { lerCfgEtiquetas, salvarCfgEtiquetas, statusAgente, imprimirNoAgente, baixarArquivo } from '../lib/agenteImpressao.js';
import { Pagina, Campo, Tabela, Modal, Aviso, Etiqueta, useConsulta, useAvisar } from '../componentes/ui.jsx';
import { BuscaProduto } from './NotasFiscais.jsx';

// Etiquetas de gôndola/produto na Elgin L42 (PPLA), com os modelos do DirectControl.
// Entradas: produtos avulsos, ?produto=id (botão no cadastro) ou ?compra=id (itens da nota de compra).
const CAMPOS_PRODUTO = 'id, nome, preco_venda, codigo_barras, referencia, unidade';
const inteiro = (v) => Math.max(0, Math.trunc(Number(String(v ?? '').replace(',', '.')) || 0));

export default function Etiquetas({ params }) {
  const avisar = useAvisar();
  const [cfg, setCfg] = useState(lerCfgEtiquetas);
  const [modeloId, setModeloId] = useState(cfg.modelo);
  const [itens, setItens] = useState([]); // { produto, quantidade }
  const [opc, setOpc] = useState({ parcelas: '', desconto: '' });
  const [compra, setCompra] = useState(null);
  const [agente, setAgente] = useState(null);
  const [imprimindo, setImprimindo] = useState(false);
  const [configurando, setConfigurando] = useState(false);
  const [leitura, setLeitura] = useState('');

  const modelos = useConsulta(async () => ({
    dados: ou(await supabase.from('etiqueta_modelos').select('*').eq('ativo', true).order('padrao', { ascending: false }).order('descricao')).data,
  }), []);
  const ppla = (modelos.dados || []).filter((m) => m.linguagem === 'PPLA');
  const modelo = ppla.find((m) => m.id === Number(modeloId)) || ppla.find((m) => m.padrao) || ppla[0];
  const campos = useConsulta(async () => (modelo ? { dados: ou(await supabase.from('etiqueta_campos').select('*').eq('modelo_id', modelo.id)).data } : { dados: [] }), [modelo?.id]);
  const empresa = useConsulta(async () => ({ dados: ou(await supabase.from('empresa').select('nome_fantasia, razao_social').maybeSingle()).data }), []);
  const loja = empresa.dados?.nome_fantasia || empresa.dados?.razao_social || '';

  useEffect(() => { statusAgente(cfg).then(setAgente); }, [cfg.agente]);

  // carga inicial: um produto (?produto=) ou os itens de uma nota de compra (?compra=)
  useEffect(() => {
    (async () => {
      if (params.produto) {
        const p = ou(await supabase.from('produtos').select(CAMPOS_PRODUTO).eq('id', Number(params.produto)).single()).data;
        setItens([{ produto: p, quantidade: '1' }]);
      } else if (params.compra) {
        const c = ou(await supabase.from('compras').select('id, numero_nota, data_entrada, data_emissao, fornecedores(nome)').eq('id', Number(params.compra)).single()).data;
        const its = ou(await supabase.from('compra_itens').select(`produto_id, quantidade, produtos(${CAMPOS_PRODUTO})`).eq('compra_id', c.id).order('item')).data;
        setCompra(c);
        setItens(its.filter((i) => i.produtos).map((i) => ({ produto: i.produtos, quantidade: String(Math.max(1, Math.ceil(Number(i.quantidade) || 1))) })));
      }
    })().catch((e) => avisar(e.message, 'erro'));
  }, [params.produto, params.compra]);

  const lista = campos.dados || [];
  const opcoes = { loja, parcelas: inteiro(opc.parcelas), desconto: Number(String(opc.desconto).replace(',', '.')) || 0, data_compra: compra?.data_entrada || compra?.data_emissao };
  const prontos = itens.map((i) => ({ produto: i.produto, quantidade: inteiro(i.quantidade) })).filter((i) => i.quantidade > 0);
  const total = totalEtiquetas(prontos);
  const ncol = colunasDoModelo(lista);
  const pedeParcelas = usaVariavel(lista, 'PARCELAS') || usaVariavel(lista, 'VALOR_PARC');
  const pedeDesconto = usaVariavel(lista, 'DESC_PERCENT');

  function adicionar(p, qtd = 1) {
    setItens((l) => {
      const k = l.findIndex((i) => i.produto.id === p.id);
      if (k >= 0) return l.map((i, j) => (j === k ? { ...i, quantidade: String(inteiro(i.quantidade) + qtd) } : i));
      return [...l, { produto: p, quantidade: String(qtd) }];
    });
  }

  // leitor de código de barras USB (ou digitação) + Enter: soma 1 etiqueta do produto
  async function lerCodigo(e) {
    e.preventDefault();
    const c = leitura.trim();
    if (!c) return;
    let q = supabase.from('produtos').select(CAMPOS_PRODUTO).eq('ativo', true);
    q = /^\d{8,14}$/.test(c) ? q.eq('codigo_barras', c) : /^\d{1,7}$/.test(c) ? q.eq('id', Number(c)) : null;
    if (!q) return avisar('Use o campo de busca para procurar pelo nome.', 'erro');
    const p = ou(await q.limit(1)).data[0];
    if (!p) avisar(`Código ${c} não cadastrado.`, 'erro'); else adicionar(p);
    setLeitura('');
  }

  function escolherModelo(id) {
    setModeloId(id);
    const novo = { ...cfg, modelo: Number(id) };
    setCfg(novo); salvarCfgEtiquetas(novo);
  }

  const arquivo = () => gerarPPLA(modelo, lista, prontos, opcoes);
  async function imprimir() {
    if (!total) return avisar('Informe a quantidade de etiquetas.', 'erro');
    if (total > 2000) return avisar('Mais de 2.000 etiquetas de uma vez: divida em partes.', 'erro');
    setImprimindo(true);
    try {
      await imprimirNoAgente(arquivo(), cfg);
      avisar(`${total} etiqueta${total > 1 ? 's' : ''} enviada${total > 1 ? 's' : ''} para ${cfg.impressora}.`);
    } catch (e) { avisar(e.message, 'erro'); statusAgente(cfg).then(setAgente); }
    setImprimindo(false);
  }

  return (
    <Pagina titulo="Etiquetas" subtitulo={compra ? `Itens da nota de compra ${compra.numero_nota || compra.id} — ${compra.fornecedores?.nome || ''}` : 'Etiquetas de produto na impressora térmica (Elgin L42)'}
      acoes={<>
        <span className={`agente-status ${agente?.ok ? 'ok' : 'erro'}`}>{agente === null ? 'Procurando agente…' : agente.ok ? `Agente pronto · ${agente.computador}` : 'Agente de impressão não encontrado'}</span>
        <button type="button" className="btn btn-sec btn-peq" onClick={() => setConfigurando(true)}>Configurar</button>
      </>}>
      {modelos.erro && <Aviso tipo="erro">{modelos.erro}</Aviso>}
      {modelos.dados && !ppla.length && <Aviso tipo="erro">Nenhum modelo de etiqueta PPLA cadastrado. Rode a migração das etiquetas do DirectControl.</Aviso>}
      {agente && !agente.ok && <Aviso>Para imprimir direto na L42, instale o agente neste computador (botão <strong>Configurar</strong>). Sem ele, use <strong>Baixar arquivo</strong>.</Aviso>}

      <div className="etq">
        <div className="etq-principal">
          <div className="form-grade">
            <Campo rotulo="Modelo" largo>
              <select value={modelo?.id || ''} onChange={(e) => escolherModelo(e.target.value)}>
                {ppla.map((m) => <option key={m.id} value={m.id}>{m.descricao}{m.padrao ? ' (padrão da loja)' : ''}</option>)}
              </select>
            </Campo>
            {pedeParcelas && <Campo rotulo="Parcelas"><input inputMode="numeric" value={opc.parcelas} onChange={(e) => setOpc({ ...opc, parcelas: e.target.value })} placeholder="ex.: 3" /></Campo>}
            {pedeDesconto && <Campo rotulo="Desconto à vista (%)"><input inputMode="decimal" value={opc.desconto} onChange={(e) => setOpc({ ...opc, desconto: e.target.value })} placeholder="ex.: 5" /></Campo>}
          </div>
          <form onSubmit={(e) => lerCodigo(e).catch((x) => avisar(x.message, 'erro'))}>
            <Campo rotulo="Leitor de código de barras (cada leitura soma 1 etiqueta)" largo>
              <input value={leitura} onChange={(e) => setLeitura(e.target.value)} placeholder="passe o código e Enter" autoComplete="off" />
            </Campo>
          </form>
          <BuscaProduto aoEscolher={(p) => adicionar(p)} />
          <Tabela linhas={itens.map((i, k) => ({ ...i, k }))} chave="k" vazio="Adicione os produtos que vão ganhar etiqueta."
            colunas={[
              { titulo: 'Produto', render: (i) => <><span className="cod">{i.produto.id}</span> {i.produto.nome}{!i.produto.codigo_barras && <> <Etiqueta tipo="info">sem código de barras: usa o código</Etiqueta></>}</> },
              { titulo: 'Preço', alinhar: 'dir', render: (i) => moeda(i.produto.preco_venda) },
              { titulo: 'Etiquetas', render: (i) => <input className="input-peq" inputMode="numeric" value={i.quantidade} aria-label="Quantidade de etiquetas"
                onChange={(e) => setItens((l) => l.map((x, j) => (j === i.k ? { ...x, quantidade: e.target.value.replace(/\D/g, '') } : x)))} /> },
              { titulo: '', render: (i) => <button type="button" className="btn btn-sec btn-peq" aria-label="Remover" onClick={() => setItens((l) => l.filter((_, j) => j !== i.k))}>✕</button> },
            ]} />
        </div>

        <aside className="etq-lateral">
          <h3>Prévia</h3>
          {modelo && lista.length > 0
            ? <PreviaEtiqueta modelo={modelo} campos={lista} produto={prontos[0]?.produto || EXEMPLO} opcoes={opcoes} />
            : <p className="texto-fraco">Carregando modelo…</p>}
          <p className="texto-fraco">Aproximada: a posição dos campos é a do modelo; a letra real sai da impressora.</p>
          <div className="pdv-totais">
            <div><span>Etiquetas</span><strong>{numero(total)}</strong></div>
            <div><span>Colunas no rolo</span><strong>{ncol}</strong></div>
          </div>
          <button type="button" className="btn btn-pri pdv-finalizar" disabled={!total || imprimindo || !modelo} onClick={imprimir}>{imprimindo ? 'Enviando…' : 'Imprimir etiquetas'}</button>
          <button type="button" className="btn btn-sec" disabled={!total || !modelo} onClick={() => baixarArquivo(arquivo())}>Baixar arquivo</button>
          {itens.length > 0 && <button type="button" className="btn btn-sec" onClick={() => { setItens([]); setCompra(null); }}>Limpar lista</button>}
        </aside>
      </div>

      {configurando && <Configurar cfg={cfg} agente={agente} aoFechar={() => setConfigurando(false)}
        aoSalvar={(c) => { setCfg(c); salvarCfgEtiquetas(c); setConfigurando(false); statusAgente(c).then(setAgente); }} />}
    </Pagina>
  );
}

const EXEMPLO = { id: 1234, nome: 'PRODUTO DE EXEMPLO PARA A ETIQUETA 10MM', codigo_barras: '7890000000000', preco_venda: 12.9, referencia: 'REF-1', unidade: 'UN' };

function Configurar({ cfg, agente, aoFechar, aoSalvar }) {
  const [c, setC] = useState(cfg);
  return (
    <Modal aberto largo titulo="Impressora de etiquetas deste computador" aoFechar={aoFechar}
      rodape={<><button type="button" className="btn btn-sec" onClick={aoFechar}>Cancelar</button>
        <button type="button" className="btn btn-pri" onClick={() => aoSalvar(c)}>Salvar</button></>}>
      <div className="form-grade">
        <Campo rotulo="Impressora compartilhada" largo><input value={c.impressora} onChange={(e) => setC({ ...c, impressora: e.target.value })} placeholder="\\127.0.0.1\L42" /></Campo>
        <Campo rotulo="Endereço do agente"><input value={c.agente} onChange={(e) => setC({ ...c, agente: e.target.value })} /></Campo>
      </div>
      <p>Situação: {agente?.ok ? <Etiqueta tipo="ok">agente rodando em {agente.computador}</Etiqueta> : <Etiqueta tipo="erro">agente não encontrado</Etiqueta>}</p>
      <h3>Instalar o agente (uma vez por computador)</h3>
      <ol className="lista-passos">
        <li>Baixe os dois arquivos para a mesma pasta: <a href="/agente/agente-impressao.ps1" download>agente-impressao.ps1</a> e <a href="/agente/instalar.cmd" download>instalar.cmd</a>.</li>
        <li>Dê dois cliques em <strong>instalar.cmd</strong> (se o Windows avisar, clique em "Mais informações" → "Executar assim mesmo"). Ele passa a abrir sozinho com o Windows, sem janela.</li>
        <li>Se a L42 estiver em outro computador, compartilhe a impressora lá e informe acima <code>\\NOME-DO-PC\L42</code>.</li>
        <li>Na primeira impressão o Chrome pode pedir permissão para acessar a rede local: clique em <strong>Permitir</strong>.</li>
      </ol>
      <p className="texto-fraco">O agente faz o mesmo que o PRINTLBL.BAT do DirectControl: copia o arquivo da etiqueta para a impressora compartilhada. Só aceita pedidos do próprio computador e do endereço do ERP.</p>
    </Modal>
  );
}
