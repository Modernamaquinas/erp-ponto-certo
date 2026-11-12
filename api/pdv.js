// POST /api/pdv  { acao, ... } — PDV e orçamentos. Qualquer usuário logado; cada operação exige o código
// de 4 dígitos do operador, conferido no banco (permissões de desconto, estoque e custo).
//   operador            { codigo }                       -> { operador }
//   finalizar           { codigo, itens, pagamentos, ... , emitir_nfce?, cpf?, cartoes? } -> { venda_id, troco, nota? }
//   emitir_nfce         { venda_id, cpf? }               -> { nota }   (nova tentativa)
//   orcamento_salvar    { codigo, id?, itens, ... }      -> { id }
//   orcamento_cancelar  { codigo, id }
import { supabaseServico, exigirUsuario, rota, ErroHttp } from './_lib/supabase.js';
import { emitirNfceDaVenda } from './_lib/pdv.js';

export const config = { maxDuration: 60 };
const TODOS = ['admin', 'financeiro', 'vendedor'];

function erroBanco(e) {
  // mensagens das funções do banco (raise exception) vão direto para o operador
  return new ErroHttp(400, String(e.message || e).replace(/^.*?ERROR:\s*/, ''));
}

async function operador(sb, codigo) {
  if (!/^\d{4}$/.test(String(codigo || ''))) throw new ErroHttp(400, 'Digite o código de 4 dígitos do operador');
  const { data } = await sb.from('operadores').select('id, nome, desconto_maximo, vende_sem_estoque, vende_abaixo_custo, converte_orcamento')
    .eq('codigo', String(codigo)).eq('ativo', true).maybeSingle();
  if (!data) throw new ErroHttp(403, 'Código de operador inválido');
  return data;
}

export default rota(async (req, res) => {
  if (req.method !== 'POST') throw new ErroHttp(405, 'Use POST');
  const usuario = await exigirUsuario(req, TODOS);
  const sb = supabaseServico();
  const c = req.body || {};

  switch (c.acao) {
    case 'operador':
      return res.json({ operador: await operador(sb, c.codigo) });

    case 'finalizar': {
      const op = await operador(sb, c.codigo);
      const p = { operador_codigo: String(c.codigo), cliente_id: c.cliente_id || null, cliente_nome: c.cliente_nome || null, cpf: c.cpf || null,
        observacao: c.observacao || null, num_caixa: c.num_caixa || null, orcamento_id: c.orcamento_id || null,
        desconto_geral: c.desconto_geral || 0, itens: c.itens || [], pagamentos: c.pagamentos || [] };
      const { data: vendaId, error } = await sb.rpc('finalizar_venda', { p });
      if (error) throw erroBanco(error);
      const venda = (await sb.from('vendas').select('id, total').eq('id', vendaId).single()).data;
      const pago = (c.pagamentos || []).reduce((s, x) => s + Number(x.valor || 0), 0);
      const resposta = { venda_id: vendaId, total: Number(venda.total), troco: Math.round((pago - Number(venda.total)) * 100) / 100 };
      if (c.emitir_nfce !== false) {
        // a venda já está gravada: se a NFC-e falhar, ela pode ser emitida de novo depois (acao emitir_nfce)
        try {
          resposta.nota = await emitirNfceDaVenda(sb, { nome: `${op.nome} (op.)` }, vendaId, { cpf: c.cpf, cartoes: c.cartoes || [] });
        } catch (e) {
          resposta.erro_nfce = e.message;
        }
      }
      return res.json(resposta);
    }

    case 'emitir_nfce':
      return res.json({ nota: await emitirNfceDaVenda(sb, usuario, Number(c.venda_id), { cpf: c.cpf }) });

    case 'orcamento_salvar': {
      await operador(sb, c.codigo);
      const p = { id: c.id || null, operador_codigo: String(c.codigo), cliente_id: c.cliente_id || null, cliente_nome: c.cliente_nome || null,
        validade: c.validade || null, observacao: c.observacao || null, tipo: c.tipo === 'prevenda' ? 'prevenda' : 'orcamento', desconto_geral: c.desconto_geral || 0, itens: c.itens || [] };
      const { data, error } = await sb.rpc('salvar_orcamento', { p });
      if (error) throw erroBanco(error);
      return res.json({ id: data });
    }

    case 'orcamento_cancelar': {
      await operador(sb, c.codigo);
      const { data } = await sb.from('orcamentos').update({ status: 'cancelado' }).eq('id', Number(c.id)).eq('status', 'aberto').select('id');
      if (!data?.length) throw new ErroHttp(400, 'Orçamento não está aberto');
      return res.json({ ok: true });
    }

    default:
      throw new ErroHttp(400, 'Ação inválida');
  }
});
