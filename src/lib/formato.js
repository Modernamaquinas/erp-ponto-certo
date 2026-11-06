const moedaFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

export const moeda = (v) => moedaFmt.format(Number(v || 0));
export const numero = (v) => (v === null || v === undefined ? '' : numFmt.format(Number(v)));

/** 'AAAA-MM-DD' -> 'DD/MM/AAAA' sem passar por Date (evita erro de fuso). */
export function data(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function dataHora(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function hoje() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export function somarDias(iso, dias) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

export function inicioDoMes(iso = hoje()) {
  return `${iso.slice(0, 7)}-01`;
}

export function documento(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v || '';
}

export function telefone(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return v || '';
}

/** Mesma normalização do banco (normaliza_busca): minúsculo e sem acento. */
export function normalizaBusca(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Busca por várias partes: cada palavra precisa aparecer em `busca`. */
export function filtrarBusca(consulta, termo) {
  for (const parte of normalizaBusca(termo).split(/\s+/).filter(Boolean)) {
    consulta = consulta.ilike('busca', `%${parte.replace(/[%_]/g, '')}%`);
  }
  return consulta;
}

/** Link do WhatsApp (wa.me) com DDI 55. */
export function linkWhatsApp(celular, texto) {
  let d = String(celular || '').replace(/\D/g, '');
  if (!d) return null;
  if (!d.startsWith('55')) d = `55${d}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}
