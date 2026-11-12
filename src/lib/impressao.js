// Impressão do DANFCE (cupom da NFC-e, HTML) e do DANFE (NF-e, PDF) pelo navegador.
// A configuração é POR COMPUTADOR (cada caixa tem sua impressora), por isso fica no localStorage.
// O navegador não escolhe a impressora sozinho: ele usa a padrão do Windows. Para imprimir direto na Epson
// sem a janela de impressão, o Chrome do caixa deve abrir com --kiosk-printing (ver tela Impressora).
import { api } from './supabase.js';
import { imprimirPdfNoAgente } from './agenteImpressao.js';

const CHAVE = 'pc-impressora';
export const PADRAO = { aposEmitir: 'perguntar', largura: '80', vias: 1, nfe: 'perguntar' };

export function lerImpressora() {
  try { return { ...PADRAO, ...JSON.parse(localStorage.getItem(CHAVE) || '{}') }; } catch { return { ...PADRAO }; }
}

export function salvarImpressora(cfg) {
  try { localStorage.setItem(CHAVE, JSON.stringify(cfg)); return true; } catch { return false; }
}

/** O que fazer depois de uma nota autorizada: 'perguntar' | 'automatico' | 'nunca'. */
export function acaoAposEmitir(modelo) {
  const c = lerImpressora();
  return modelo === 55 ? c.nfe : c.aposEmitir;
}

// Cupom de 80 mm (área útil ~72 mm) ou 58 mm (~48 mm) em impressora térmica.
function estiloCupom(largura) {
  if (largura === 'A4') return '<style id="pc-impressao">@page { size: A4; margin: 10mm; } @media print { body { margin: 0 auto !important; } }</style>';
  const util = largura === '58' ? '48mm' : '72mm';
  return `<style id="pc-impressao">
    @page { size: ${largura}mm auto; margin: 0; }
    @media print { html, body { width: ${util} !important; margin: 0 auto !important; padding: 0 !important; }
      body * { max-width: ${util} !important; } img { max-width: 100% !important; height: auto !important; } }
  </style>`;
}

function imprimirEmQuadro({ html, url }, vias = 1) {
  return new Promise((ok, falha) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    f.onload = () => {
      // o DANFCE monta o QR Code com JavaScript: espera ele desenhar
      setTimeout(async () => {
        try {
          for (let i = 0; i < vias; i++) {
            f.contentWindow.focus();
            f.contentWindow.print();
            if (i < vias - 1) await new Promise((r) => setTimeout(r, 1500));
          }
          ok();
        } catch (e) { falha(e); }
        setTimeout(() => f.remove(), 60000);
      }, html ? 1200 : 600);
    };
    if (html) f.srcdoc = html; else f.src = url;
    document.body.appendChild(f);
  });
}

/** Busca o DANFE/DANFCE da nota no servidor e manda para a impressora. */
export async function imprimirNota(notaId) {
  const cfg = lerImpressora();
  const r = await api('fiscal', { corpo: { acao: 'danfe', id: notaId } });
  const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
  const mime = (r.tipo || '').split(';')[0];
  const vias = Math.max(1, Math.min(3, Number(cfg.vias) || 1));
  if (/html/.test(mime)) {
    let html = new TextDecoder('utf-8').decode(bytes);
    html = html.includes('</head>') ? html.replace('</head>', `${estiloCupom(cfg.largura)}</head>`) : estiloCupom(cfg.largura) + html;
    return imprimirEmQuadro({ html }, vias);
  }
  // DANFE da NF-e (A4): vai para a HP Laser 107w pelo agente local. Sem agente, abre a impressão do navegador
  // (no atalho do caixa com --kiosk-printing isso cairia na térmica, por isso o agente é o caminho padrão).
  if (await imprimirPdfNoAgente(bytes)) return;
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  try { await imprimirEmQuadro({ url }, 1); } finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
}

/** Imprime um HTML montado no próprio ERP (comprovante de venda, orçamento) na largura configurada. */
export function imprimirHtml(corpo, { titulo = 'Impressão', largura } = {}) {
  const l = largura || lerImpressora().largura;
  const larguraTela = l === 'A4' ? '190mm' : l === '58' ? '48mm' : '72mm';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${titulo}</title>${estiloCupom(l)}
    <style>body{font:12px/1.35 'Courier New',monospace;color:#000;width:${larguraTela};margin:0 auto}
    h1{font-size:14px;margin:4px 0;text-align:center} .c{text-align:center} .d{text-align:right} hr{border:0;border-top:1px dashed #000;margin:6px 0}
    table{width:100%;border-collapse:collapse} td{vertical-align:top;padding:1px 0} .g{font-size:15px;font-weight:bold} img{max-width:60%}</style>
    </head><body>${corpo}</body></html>`;
  return imprimirEmQuadro({ html }, 1);
}

/** Baixa o DANFE (PDF) ou o XML de uma nota autorizada para o computador. */
export async function salvarArquivoNota(notaId, tipo = 'danfe') {
  const r = await api('fiscal', { corpo: { acao: tipo === 'xml' ? 'xml' : 'danfe', id: notaId } });
  const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: (r.tipo || 'application/octet-stream').split(';')[0] }));
  a.download = r.nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
