// Conversa com o agente de impressão instalado no PC (agente-local/agente-impressao.ps1), que manda o arquivo
// cru para a impressora compartilhada (\\127.0.0.1\L42), como o PRINTLBL.BAT do DirectControl.
// A configuração é por computador (localStorage).
const CHAVE = 'pc-etiquetas';
export const PADRAO_ETIQUETAS = { agente: 'http://127.0.0.1:7172', impressora: '\\\\127.0.0.1\\L42', modelo: null };

export function lerCfgEtiquetas() {
  try { return { ...PADRAO_ETIQUETAS, ...JSON.parse(localStorage.getItem(CHAVE) || '{}') }; } catch { return { ...PADRAO_ETIQUETAS }; }
}
export function salvarCfgEtiquetas(cfg) {
  try { localStorage.setItem(CHAVE, JSON.stringify(cfg)); } catch { /* sem armazenamento: vale só nesta tela */ }
}

const base = (cfg) => String(cfg.agente || PADRAO_ETIQUETAS.agente).replace(/\/$/, '');

export async function statusAgente(cfg = lerCfgEtiquetas()) {
  try {
    const r = await fetch(`${base(cfg)}/status`, { signal: AbortSignal.timeout(2500) });
    return await r.json();
  } catch {
    return { ok: false };
  }
}

/** Texto PPLA -> bytes (só ASCII, já sem acentos) e envio ao agente. */
export async function imprimirNoAgente(texto, cfg = lerCfgEtiquetas()) {
  const bytes = Uint8Array.from(texto, (c) => c.charCodeAt(0) & 0xff);
  let r;
  try {
    r = await fetch(`${base(cfg)}/imprimir?impressora=${encodeURIComponent(cfg.impressora || PADRAO_ETIQUETAS.impressora)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes, signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error('O agente de impressão não respondeu neste computador. Instale/abra o agente (Etiquetas → Configurar) ou use "Baixar arquivo".');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.erro || `Falha ao imprimir (${r.status})`);
  return j;
}

/**
 * PDF (DANFE da NF-e, folha A4) direto na impressora A4 do computador (HP Laser 107w), pelo agente local.
 * Devolve false quando o agente não está instalado ou não tem impressora A4: aí quem chamou usa a janela do navegador.
 */
export async function imprimirPdfNoAgente(bytes, cfg = lerCfgEtiquetas()) {
  const st = await statusAgente(cfg);
  if (!st.ok || !st.impressoraA4 || !st.pdf) return false;
  let r;
  try {
    r = await fetch(`${base(cfg)}/imprimir-pdf`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: bytes, signal: AbortSignal.timeout(90000) });
  } catch {
    throw new Error(`Não consegui falar com o agente de impressão para mandar o DANFE à ${st.impressoraA4}.`);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.erro || `Falha ao imprimir o DANFE (${r.status})`);
  return true;
}

export function baixarArquivo(texto, nome = 'ETIQUETA.TXT') {
  const blob = new Blob([Uint8Array.from(texto, (c) => c.charCodeAt(0) & 0xff)], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
