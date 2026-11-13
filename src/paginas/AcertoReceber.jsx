// Acerto do crediário no balcão (/receber/acerto?ids=1,2,3): o cliente chega à loja, o caixa marca em Contas a Receber os títulos
// que ele vai pagar e é trazido para esta tela de pagamento. Aqui ainda dá para marcar/desmarcar qualquer título em aberto do
// cliente e pagar parte de um. Pagamento em uma ou mais formas, com troco no dinheiro. Banco: receber_acerto (026/027).
import { useMemo, useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { moeda, data, hoje, documento } from '../lib/formato.js';
import { navegar } from '../lib/contexto.js';
import { imprimirHtml } from '../lib/impressao.js';
import { Pagina, Campo, Aviso, Etiqueta, useConsulta, useAvisar } from '../componentes/ui.jsx';

const FORMAS = [['dinheiro', 'Dinheiro'], ['pix', 'PIX'], ['debito', 'Cartão de débito'], ['credito', 'Cartão de crédito'], ['cheque', 'Cheque']];
const NOME_FORMA = Object.fromEntries(FORMAS);
const num = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const txt = (v) => String(r2(v).toFixed(2)).replace('.', ',');
const diasAtraso = (venc) => Math.floor((new Date(`${hoje()}T12:00:00`) - new Date(`${venc}T12:00:00`)) / 86400000);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default function AcertoReceber({ params }) {
  const avisar = useAvisar();
  const idsIniciais = useMemo(() => String(params.ids || '').split(',').map(Number).filter(Boolean), [params.ids]);
  const [marcados, setMarcados] = useState(null); // Map id -> valor a pagar (texto)
  const [pags, setPags] = useState([{ forma: 'dinheiro', valor: '', recebido: '' }]);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const consulta = useConsulta(async () => {
    if (!idsIniciais.length) return { dados: null };
    const { data: sel } = ou(await supabase.from('contas_receber').select('cliente_id').in('id', idsIniciais));
    const clientes = [...new Set(sel.map((t) => t.cliente_id))];
    if (clientes.length !== 1) throw new Error('Selecione títulos de um único cliente.');
    const [cli, tit] = await Promise.all([
      supabase.from('clientes').select('id, nome, cpf_cnpj, telefone, celular').eq('id', clientes[0]).single().then(ou),
      supabase.from('contas_receber').select('id, vencimento, historico, documento, parcela, total_parcelas, valor, saldo, cobranca_id')
        .eq('cliente_id', clientes[0]).eq('status', 'aberto').order('vencimento').order('id').limit(500).then(ou),
    ]);
    const m = new Map(tit.data.filter((t) => idsIniciais.includes(t.id) && !t.cobranca_id).map((t) => [t.id, txt(Number(t.saldo))]));
    setMarcados(m);
    const total = [...m.values()].reduce((s, v) => s + num(v), 0);
    setPags([{ forma: 'dinheiro', valor: txt(total), recebido: '' }]);
    return { dados: { cliente: cli.data, titulos: tit.data } };
  }, [idsIniciais.join(',')]);

  const titulos = consulta.dados?.titulos || [];
  const cliente = consulta.dados?.cliente;
  const sel = marcados || new Map();
  const total = r2([...sel.values()].reduce((s, v) => s + num(v), 0));
  const efetivo = (p) => (p.forma === 'dinheiro' && num(p.recebido) > num(p.valor) ? num(p.recebido) : num(p.valor));
  const pago = r2(pags.reduce((s, p) => s + efetivo(p), 0));
  const falta = r2(Math.max(total - pago, 0));
  const troco = r2(Math.max(pago - total, 0));
  const dinheiro = pags.filter((p) => p.forma === 'dinheiro').reduce((s, p) => s + efetivo(p), 0);
  const trocoInvalido = troco > 0 && troco > dinheiro + 0.001;
  const valorInvalido = titulos.some((t) => sel.has(t.id) && (num(sel.get(t.id)) <= 0 || num(sel.get(t.id)) > Number(t.saldo) + 0.001));

  function marcar(t, ligado) {
    const m = new Map(sel);
    if (ligado) m.set(t.id, txt(Number(t.saldo))); else m.delete(t.id);
    setMarcados(m);
    const novo = r2([...m.values()].reduce((s, v) => s + num(v), 0));
    if (pags.length === 1) setPags([{ ...pags[0], valor: txt(novo) }]);
  }
  function valorTitulo(id, v) {
    const m = new Map(sel); m.set(id, v); setMarcados(m);
    const novo = r2([...m.values()].reduce((s, x) => s + num(x), 0));
    if (pags.length === 1) setPags([{ ...pags[0], valor: txt(novo) }]);
  }
  const setPag = (k, campo) => (e) => setPags((l) => l.map((p, j) => (j === k ? { ...p, [campo]: e.target.value } : p)));

  async function confirmar() {
    setSalvando(true);
    try {
      const corpo = {
        titulos: titulos.filter((t) => sel.has(t.id)).map((t) => ({ id: t.id, valor: r2(num(sel.get(t.id))) })),
        pagamentos: pags.filter((p) => efetivo(p) > 0).map((p) => ({ forma: p.forma, valor: r2(efetivo(p)) })),
      };
      const { data: r } = ou(await supabase.rpc('receber_acerto', { p: corpo }));
      setResultado(r);
    } catch (e) { avisar(e.message, 'erro'); }
    setSalvando(false);
  }

  if (resultado) return <Comprovante r={resultado} cliente={cliente} />;

  return (
    <Pagina titulo="Acerto do crediário" subtitulo={cliente ? `${cliente.id} — ${cliente.nome}` : 'Recebimento no balcão'}
      acoes={<button type="button" className="btn btn-sec" onClick={() => navegar(cliente ? `/receber?cliente=${cliente.id}` : '/receber')}>← Voltar</button>}>
      {!idsIniciais.length && <Aviso>Em Contas a Receber, marque os títulos que o cliente vai pagar e clique em "Receber selecionados".</Aviso>}
      {consulta.erro && <Aviso tipo="erro">{consulta.erro}</Aviso>}
      {consulta.carregando && <p>Carregando…</p>}
      {cliente && <>
        <p className="texto-fraco">{documento(cliente.cpf_cnpj)} {cliente.celular || cliente.telefone ? `· ${cliente.celular || cliente.telefone}` : ''}</p>
        <h3>Títulos em aberto ({titulos.length})</h3>
        <div className="tabela-caixa">
          <table className="tabela">
            <thead><tr><th></th><th>Vencimento</th><th>Histórico</th><th>Situação</th><th className="al-dir">Saldo</th><th className="al-dir">Pagar agora</th></tr></thead>
            <tbody>
              {titulos.map((t) => {
                const atraso = diasAtraso(t.vencimento);
                const ligado = sel.has(t.id);
                return (
                  <tr key={t.id} className={ligado ? 'selecionada' : ''}>
                    <td><input type="checkbox" checked={ligado} disabled={!!t.cobranca_id} onChange={(e) => marcar(t, e.target.checked)} aria-label={`Pagar título ${t.id}`} /></td>
                    <td>{data(t.vencimento)}</td>
                    <td>{t.historico || t.documento}{t.parcela ? ` (${t.parcela}/${t.total_parcelas || '?'})` : ''}</td>
                    <td>{t.cobranca_id ? <Etiqueta tipo="marca">Em cobrança Asaas</Etiqueta>
                      : atraso > 0 ? <Etiqueta tipo="erro">{atraso} dia(s) de atraso</Etiqueta> : <Etiqueta tipo="info">A vencer</Etiqueta>}</td>
                    <td className="al-dir">{moeda(t.saldo)}</td>
                    <td className="al-dir">{ligado
                      ? <input className="input-peq" inputMode="decimal" value={sel.get(t.id)} onChange={(e) => valorTitulo(t.id, e.target.value)} aria-label={`Valor a pagar do título ${t.id}`} />
                      : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {titulos.some((t) => t.cobranca_id) && <p className="texto-fraco">Títulos em cobrança Asaas são baixados sozinhos quando o boleto/PIX é pago. Para receber no balcão, cancele a cobrança antes em Cobranças.</p>}
        {valorInvalido && <Aviso tipo="erro">O valor a pagar de cada título precisa ser maior que zero e no máximo o saldo dele.</Aviso>}

        <h3 className="pdv-subtitulo">Pagamento</h3>
        {pags.map((p, k) => (
          <div key={k} className="filtros">
            <Campo rotulo="Forma"><select value={p.forma} onChange={setPag(k, 'forma')}>{FORMAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></Campo>
            <Campo rotulo="Valor"><input inputMode="decimal" value={p.valor} onChange={setPag(k, 'valor')} /></Campo>
            {p.forma === 'dinheiro' && <>
              <Campo rotulo="Dinheiro recebido (R$)"><input className="pdv-recebido" inputMode="decimal" value={p.recebido} onChange={setPag(k, 'recebido')} placeholder="0,00" /></Campo>
              {num(p.recebido) > 0 && (num(p.recebido) >= num(p.valor)
                ? <div className="pdv-troco-linha"><span>Troco</span><strong>{moeda(r2(num(p.recebido) - num(p.valor)))}</strong></div>
                : <div className="pdv-troco-linha falta"><span>Faltam</span><strong>{moeda(r2(num(p.valor) - num(p.recebido)))}</strong></div>)}
            </>}
            {pags.length > 1 && <button type="button" className="btn btn-sec btn-peq" onClick={() => setPags((l) => l.filter((_, j) => j !== k))}>Remover</button>}
          </div>
        ))}
        <button type="button" className="btn btn-sec btn-peq" onClick={() => setPags((l) => [...l, { forma: 'pix', valor: falta > 0 ? txt(falta) : '', recebido: '' }])}>+ dividir em outra forma</button>

        <div className="pdv-valores">
          <div className="pdv-valor v-total"><span>Total do acerto</span><strong>{moeda(total)}</strong></div>
          <div className="pdv-valor v-recebido"><span>Recebido</span><strong>{moeda(pago)}</strong></div>
          {falta > 0 && <div className="pdv-valor v-falta"><span>Falta</span><strong>{moeda(falta)}</strong></div>}
          {troco > 0 && <div className="pdv-valor v-troco"><span>Troco</span><strong>{moeda(troco)}</strong></div>}
        </div>
        {trocoInvalido && <Aviso tipo="erro">O valor acima do total só pode ser troco do dinheiro. Ajuste os valores do PIX/cartão.</Aviso>}
        <div className="form-linha">
          <button type="button" className="btn btn-pri" disabled={salvando || !sel.size || total <= 0 || falta > 0 || trocoInvalido || valorInvalido} onClick={confirmar}>
            {salvando ? 'Registrando…' : `Confirmar recebimento de ${moeda(total)}`}</button>
        </div>
        <p className="texto-fraco">Cada pagamento baixa os títulos marcados do vencimento mais antigo para o mais novo e entra no caixa do dia. Até a troca de sistema, dê a baixa também no DirectControl.</p>
      </>}
    </Pagina>
  );
}

function Comprovante({ r, cliente }) {
  function imprimir() {
    const linhas = r.titulos.map((t) => `<tr><td>${esc(data(t.vencimento))} ${esc(t.historico)}</td><td class="d">${esc(moeda(t.pago))}</td></tr>
      ${Number(t.saldo) > 0 ? `<tr><td colspan="2" style="font-size:11px">&nbsp;&nbsp;resta ${esc(moeda(t.saldo))}</td></tr>` : ''}`).join('');
    const formas = r.pagamentos.map((p) => `<tr><td>${esc(NOME_FORMA[p.forma] || p.forma)}</td><td class="d">${esc(moeda(p.valor))}</td></tr>`).join('');
    imprimirHtml(`<h1>PONTO CERTO FERRAGENS</h1><div class="c">COMPROVANTE DE RECEBIMENTO</div><div class="c">${esc(data(r.data))}</div><hr>
      <div>Cliente: ${esc(r.cliente_id)} - ${esc(r.cliente)}</div><hr>
      <table>${linhas}</table><hr>
      <table><tr><td class="g">TOTAL PAGO</td><td class="d g">${esc(moeda(r.total))}</td></tr>${formas}
      ${Number(r.troco) > 0 ? `<tr><td>Troco</td><td class="d">${esc(moeda(r.troco))}</td></tr>` : ''}</table><hr>
      <div class="c">Recebido por ${esc(r.usuario || '')}</div><br><div class="c">_______________________________</div><div class="c">assinatura</div>`,
    { titulo: 'Comprovante de recebimento' });
  }
  const restantes = r.titulos.filter((t) => Number(t.saldo) > 0);
  return (
    <Pagina titulo="Recebimento registrado" subtitulo={`${r.cliente_id} — ${r.cliente}`}
      acoes={<>
        <button type="button" className="btn btn-pri" onClick={imprimir}>Imprimir comprovante</button>
        <button type="button" className="btn btn-sec" onClick={() => navegar(`/receber?cliente=${r.cliente_id}`)}>Voltar para Contas a Receber</button>
      </>}>
      <div className="pdv-valores">
        <div className="pdv-valor v-total"><span>Total pago</span><strong>{moeda(r.total)}</strong></div>
        {Number(r.troco) > 0 && <div className="pdv-valor v-troco"><span>Troco</span><strong>{moeda(r.troco)}</strong></div>}
      </div>
      <ul className="lista-simples">
        {r.titulos.map((t) => <li key={t.id}>{data(t.vencimento)} · {t.historico} · pago {moeda(t.pago)} · {Number(t.saldo) > 0 ? `resta ${moeda(t.saldo)}` : 'quitado'}</li>)}
      </ul>
      <p>Formas: {r.pagamentos.map((p) => `${NOME_FORMA[p.forma] || p.forma} ${moeda(p.valor)}`).join(' + ')}</p>
      {restantes.length > 0 && <Aviso>{restantes.length} título(s) pago(s) em parte continuam em aberto com o saldo restante.</Aviso>}
      <Aviso tipo="alerta">Até a troca de sistema, dê a baixa destes títulos também no DirectControl.</Aviso>
    </Pagina>
  );
}
