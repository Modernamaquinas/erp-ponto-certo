// NF-e recebidas (notas de compra emitidas contra o CNPJ da loja) pela Focus NFe — Manifestação do Destinatário (MD-e).
// Requer "habilita_manifestacao" ligado no cadastro da empresa na Focus (painel → Empresas → Manifestação). Sempre produção:
// homologação não recebe notas reais de fornecedores.
//
// A SEFAZ só entrega o XML completo depois da "ciência da operação". Sem ela, a Focus tem apenas o resumo (ou nada, se a
// distribuição ainda não chegou). Por isso: 1) tenta baixar o XML; 2) se não houver e o usuário autorizou, registra a ciência
// (evento na SEFAZ, sem efeito fiscal para a loja) e pede para tentar de novo em alguns minutos.
import { focus, ErroFocus } from './focus.js';

const AMBIENTE = 'producao';
const CNPJ_LOJA = '11877694000166';
const NAO_LIGADA = 'A consulta de notas recebidas não está ligada na Focus NFe para a Ponto Certo (Manifestação do destinatário). Por enquanto, use o arquivo XML.';

async function conferirHabilitada() {
  try {
    await focus(AMBIENTE, 'GET', `/v2/nfes_recebidas?cnpj=${CNPJ_LOJA}&versao=999999999999`, null, { timeout: 30000 });
  } catch (e) {
    if (e instanceof ErroFocus && e.statusOriginal === 400) throw Object.assign(new Error(NAO_LIGADA), { status: 409 });
    throw e;
  }
}

export async function buscarNfeRecebida(chave, { manifestar = false } = {}) {
  const c = String(chave || '').replace(/\D/g, '');
  if (c.length !== 44) throw Object.assign(new Error('Chave de acesso precisa ter 44 dígitos'), { status: 400 });
  if (c.slice(20, 22) !== '55') throw Object.assign(new Error('A chave não é de NF-e (modelo 55)'), { status: 400 });

  try {
    const arq = await focus(AMBIENTE, 'GET', `/v2/nfes_recebidas/${c}.xml`, null, { binario: true, timeout: 40000 });
    const xml = arq.dados.toString('utf8');
    if (/<infNFe[\s>]/.test(xml) && /<det[\s>]/.test(xml)) return { situacao: 'ok', xml };
    // só o resumo (resNFe): falta a ciência
  } catch (e) {
    if (!(e instanceof ErroFocus)) throw e;
    if (e.statusOriginal === 400 && /não autorizado/i.test(e.message)) {
      throw Object.assign(new Error(NAO_LIGADA), { status: 409 });
    }
    if (e.statusOriginal !== 404) throw e;
  }

  // nota ainda sem XML completo: antes, confere se a MD-e está ligada para o CNPJ (sem ela a Focus só diz 404)
  await conferirHabilitada();
  let resumo = null;
  try { resumo = await focus(AMBIENTE, 'GET', `/v2/nfes_recebidas/${c}.json`, null, { timeout: 30000 }); } catch { /* ainda não distribuída */ }
  if (!manifestar) {
    return { situacao: resumo ? 'precisa_ciencia' : 'nao_encontrada', resumo: resumo && {
      emitente: resumo.nome_emitente, cnpj: resumo.documento_emitente, valor: resumo.valor_total, emissao: resumo.data_emissao,
      situacao: resumo.situacao, manifestacao: resumo.manifestacao_destinatario } };
  }
  const m = await focus(AMBIENTE, 'POST', `/v2/nfes_recebidas/${c}/manifesto`, { tipo: 'ciencia' }, { timeout: 40000 });
  const ok = m.status === 'evento_registrado' || m.status_sefaz === '573'; // 573 = já tinha ciência
  if (!ok) throw Object.assign(new Error(`SEFAZ não registrou a ciência: ${m.mensagem_sefaz || m.mensagem || 'sem resposta'}`), { status: 502 });
  return { situacao: 'ciencia_registrada', mensagem: 'Ciência registrada na SEFAZ. O XML completo costuma chegar em alguns minutos: busque de novo.' };
}
