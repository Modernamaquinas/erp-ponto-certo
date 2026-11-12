// POST /api/fiscal  { acao, ... } — NFC-e/NF-e pela Focus NFe.
//   status                         qualquer usuário: token da Focus do ambiente atual é aceito?
//   emitir   { modelo, ... }       NFC-e: qualquer usuário (caixa); NF-e: admin/financeiro
//   consultar|danfe|xml { id }     qualquer usuário
//   cancelar { id, justificativa } admin/financeiro
//   link     { id }                qualquer usuário: links assinados (DANFE e XML) para mandar ao cliente
// GET /api/fiscal?arquivo=danfe|xml&id&exp&sig  público, só com link assinado (link.js)
import { supabaseServico, exigirUsuario, rota, ErroHttp } from './_lib/supabase.js';
import { emitirNota, consultarNota, cancelarNota, danfeNota, xmlNota, verificarFocus, configFiscal } from './_lib/fiscal/emitir.js';
import { focusConfigurada } from './_lib/fiscal/focus.js';
import { assinarLinkNota, linkNotaValido, VALIDADE_LINK_DIAS } from './_lib/fiscal/link.js';

export const config = { maxDuration: 60 };
const TODOS = ['admin', 'financeiro', 'vendedor'];

export default rota(async (req, res) => {
  if (req.method === 'GET' && req.query?.arquivo) return arquivoPublico(req, res);
  if (req.method !== 'POST') throw new ErroHttp(405, 'Use POST');
  const corpo = req.body || {};
  const fin = corpo.acao === 'cancelar' || (corpo.acao === 'emitir' && Number(corpo.modelo) === 55);
  const usuario = await exigirUsuario(req, fin ? ['admin', 'financeiro'] : TODOS);
  const sb = supabaseServico();
  const id = Number(corpo.id);

  switch (corpo.acao) {
    case 'status': {
      const { ambiente } = await configFiscal(sb);
      if (!focusConfigurada(ambiente)) return res.json({ configurada: false, ambiente });
      return res.json({ configurada: true, ambiente, ...(await verificarFocus(ambiente)) });
    }
    case 'emitir':
      return res.json({ nota: await emitirNota(sb, usuario, corpo) });
    case 'consultar':
      return res.json({ nota: await consultarNota(sb, id) });
    case 'cancelar':
      return res.json({ nota: await cancelarNota(sb, usuario, id, corpo.justificativa) });
    case 'danfe':
      return res.json(await danfeNota(sb, id));
    case 'xml':
      return res.json(await xmlNota(sb, id));
    case 'link': {
      const { data: n } = await sb.from('notas_fiscais').select('id, status').eq('id', id).maybeSingle();
      if (!n || n.status !== 'autorizada') throw new ErroHttp(400, 'Só nota autorizada gera link');
      const origem = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
      return res.json({ danfe: `${origem}/api/fiscal?${assinarLinkNota(id, 'danfe')}`, xml: `${origem}/api/fiscal?${assinarLinkNota(id, 'xml')}`, dias: VALIDADE_LINK_DIAS });
    }
    default:
      throw new ErroHttp(400, 'Ação inválida');
  }
});

// Link do WhatsApp: entrega o PDF/XML direto, sem login. Assinatura e validade conferidas antes de tocar no banco.
async function arquivoPublico(req, res) {
  const q = req.query;
  if (!linkNotaValido(q)) throw new ErroHttp(403, 'Link inválido ou vencido. Peça um novo à Ponto Certo Ferragens.');
  const sb = supabaseServico();
  const arq = q.arquivo === 'xml' ? await xmlNota(sb, Number(q.id)) : await danfeNota(sb, Number(q.id));
  res.setHeader('Content-Type', q.arquivo === 'xml' ? 'application/xml' : (arq.tipo || 'application/pdf'));
  res.setHeader('Content-Disposition', `${q.arquivo === 'xml' ? 'attachment' : 'inline'}; filename="${arq.nome}"`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.status(200).end(Buffer.from(arq.base64, 'base64'));
}
