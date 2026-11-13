// Marketplaces: o ERP fala com o Mercado Livre pela edge function ml-estoque do Supabase do painel financeiro da Ponto Certo (mesmo acesso e mesma
// renovação de token dos painéis da Moderna). Variáveis (Vercel e .env):
//   ML_ESTOQUE_URL   https://<projeto do painel da Ponto Certo>.supabase.co/functions/v1/ml-estoque
//   ERP_ML_SECRET    o mesmo valor do secret ERP_ML_SECRET daquele projeto
//   MARKETPLACE_CRON_SECRET  cabeçalho da rotina agendada (pg_cron do Supabase do ERP)
const CANAL = 'mercadolivre';

export function mlConfigurado() {
  return Boolean(process.env.ML_ESTOQUE_URL && process.env.ERP_ML_SECRET);
}

export async function chamarMl(acao, corpo = {}, { tempo = 55000 } = {}) {
  if (!mlConfigurado()) throw Object.assign(new Error('Integração com o Mercado Livre não configurada (ML_ESTOQUE_URL / ERP_ML_SECRET)'), { status: 503 });
  const r = await fetch(process.env.ML_ESTOQUE_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-erp-secret': process.env.ERP_ML_SECRET },
    body: JSON.stringify({ acao, ...corpo }), signal: AbortSignal.timeout(tempo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Mercado Livre: ${j.erro || r.status}`), { status: 502 });
  return j;
}

const ou = ({ data, error }) => { if (error) throw Object.assign(new Error(error.message), { status: 400 }); return data; };

/** Lê os anúncios da Ponto Certo no ML e grava/atualiza no ERP (vincula pelo GTIN o que der). */
export async function lerAnunciosMl(sb) {
  const { anuncios } = await chamarMl('anuncios');
  const lista = anuncios.filter((a) => a.item_id && !a.erro).map((a) => ({
    anuncio_id: a.item_id, titulo: a.titulo, status: a.status, estoque: a.estoque, preco: a.preco, link: a.link, foto: a.foto,
    gtin: a.gtin && !String(a.gtin).includes(',') ? String(a.gtin).trim() : null, sku: a.sku || null,
  }));
  return ou(await sb.rpc('marketplace_ler_anuncios', { p_canal: CANAL, p: lista }));
}

/**
 * Envia ao ML a quantidade calculada dos anúncios pendentes (sincronização ligada). Seguro chamar sempre: sem pendências não chama o ML.
 * Devolve { enviados, erros }.
 */
export async function enviarEstoqueMl(sb, { tempo = 25000 } = {}) {
  if (!mlConfigurado()) return { enviados: 0, erros: 0, desligado: true };
  const pend = ou(await sb.rpc('marketplace_pendentes', { p_canal: CANAL, p_limite: 100 }));
  if (!pend?.length) return { enviados: 0, erros: 0 };
  const { resultados } = await chamarMl('estoque', { itens: pend.map((p) => ({ item_id: p.anuncio_id, quantidade: Number(p.quantidade) })) }, { tempo });
  ou(await sb.rpc('marketplace_registrar_envio', { p_canal: CANAL,
    p: resultados.map((r) => ({ anuncio_id: r.item_id, ok: r.ok, quantidade: r.ok ? Number(r.quantidade) : null, erro: r.erro || null })) }));
  return { enviados: resultados.filter((r) => r.ok).length, erros: resultados.filter((r) => !r.ok).length };
}

/** Importa os pedidos do ML desde a última leitura (com 15 min de folga) e registra as vendas no ERP. */
export async function importarPedidosMl(sb, { desde } = {}) {
  const cfg = ou(await sb.from('marketplace_config').select('*').eq('canal', CANAL).single());
  if (!cfg.importar_vendas && !desde) return { lidos: 0, desligado: true };
  const inicio = desde || new Date(new Date(cfg.ultimo_pedido_em || Date.now() - 2 * 86400000).getTime() - 15 * 60000).toISOString();
  const agora = new Date().toISOString();
  const { pedidos } = await chamarMl('pedidos', { desde: inicio });
  const resumo = { lidos: pedidos.length, registrados: 0, estornados: 0, pendentes_vinculo: 0 };
  for (const p of pedidos) {
    const r = ou(await sb.rpc('marketplace_registrar_pedido', { p: {
      canal: CANAL, pedido_id: p.pedido_id, status: p.status, data: p.fechado || p.criado, total: p.total,
      itens: p.itens.map((i) => ({ anuncio_id: i.item_id, titulo: i.titulo, quantidade: i.quantidade, preco_unitario: i.preco_unitario })) } }));
    if (r.acao === 'registrado') resumo.registrados += 1;
    if (r.acao === 'estornado') resumo.estornados += 1;
    if (r.acao === 'pendente_vinculo') resumo.pendentes_vinculo += 1;
  }
  if (!desde) ou(await sb.from('marketplace_config').update({ ultimo_pedido_em: agora }).eq('canal', CANAL));
  return resumo;
}

/** Rotina completa (agendada): pedidos novos -> estoque -> envio dos pendentes. */
export async function sincronizarMl(sb) {
  const cfg = ou(await sb.from('marketplace_config').select('sincronizar, importar_vendas').eq('canal', CANAL).single());
  const out = {};
  if (cfg.importar_vendas) out.pedidos = await importarPedidosMl(sb);
  if (cfg.sincronizar) out.estoque = await enviarEstoqueMl(sb);
  return out;
}
