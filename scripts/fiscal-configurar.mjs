#!/usr/bin/env node
// Instala a Ponto Certo na Nuvem Fiscal: cadastro da empresa, certificado A1, CSC da NFC-e e ambiente.
// Roda no computador que tem o certificado (ele vai direto para a Nuvem Fiscal; não passa pela Vercel nem pelo banco).
//
//   npm run fiscal:configurar                 usa FISCAL_AMBIENTE do .env (padrão: homologacao)
//   npm run fiscal:configurar -- producao     muda a empresa para produção (só depois de testar em homologação)
//
// .env: NUVEMFISCAL_CLIENT_ID, NUVEMFISCAL_CLIENT_SECRET, NUVEMFISCAL_API (sandbox|producao),
//       CERTIFICADO_ARQUIVO, CERTIFICADO_SENHA, NFCE_ID_CSC, NFCE_CSC, EMPRESA_EMAIL
import 'dotenv/config';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nuvemFiscal, ErroNuvemFiscal, baseNuvemFiscal } from '../api/_lib/fiscal/nuvemfiscal.js';
import { EMITENTE } from '../api/_lib/fiscal/montar.js';

// Dados do emitente, conforme PARAMETROSNFE do DirectControl
const EMPRESA = {
  cpf_cnpj: EMITENTE.cnpj,
  nome_razao_social: 'PONTO CERTO COMERCIO DE FERRAGENS LTDA',
  nome_fantasia: 'PONTO CERTO FERRAGENS',
  inscricao_estadual: '0290521327',
  endereco: { logradouro: 'RUA THEREZA DALCANALI ZUGNO', numero: '280', bairro: 'PLANALTO RIO BRANCO',
    codigo_municipio: EMITENTE.cMun, cidade: 'CAXIAS DO SUL', uf: 'RS', codigo_pais: '1058', pais: 'BRASIL', cep: '95096761' },
};

const ambiente = process.argv[2] || process.env.FISCAL_AMBIENTE || 'homologacao';
if (!['homologacao', 'producao'].includes(ambiente)) throw new Error('Ambiente deve ser homologacao ou producao');
const precisa = (k) => { const v = process.env[k]; if (!v) throw new Error(`Defina ${k} no .env`); return v; };

/** O .pfx da Ponto Certo usa RC2-40 (antigo); se a API recusar, reempacota com AES via openssl. */
function pfxModerno(caminho, senha) {
  const dir = mkdtempSync(join(tmpdir(), 'pfx-'));
  try {
    const pem = join(dir, 'c.pem'); const novo = join(dir, 'c.pfx');
    const env = { ...process.env, PFX_SENHA: senha };
    execFileSync('openssl', ['pkcs12', '-legacy', '-in', caminho, '-passin', 'env:PFX_SENHA', '-nodes', '-out', pem], { env, stdio: 'pipe' });
    execFileSync('openssl', ['pkcs12', '-export', '-in', pem, '-out', novo, '-passout', 'env:PFX_SENHA'], { env, stdio: 'pipe' });
    return readFileSync(novo);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function principal() {
  console.log(`Nuvem Fiscal: ${baseNuvemFiscal()}  |  SEFAZ: ${ambiente}`);
  const email = precisa('EMPRESA_EMAIL');

  // 1. empresa
  let existe = true;
  try { await nuvemFiscal('GET', `/empresas/${EMPRESA.cpf_cnpj}`); } catch (e) {
    if (e instanceof ErroNuvemFiscal && e.statusOriginal === 404) existe = false; else throw e;
  }
  const empresa = { ...EMPRESA, email };
  if (existe) await nuvemFiscal('PUT', `/empresas/${EMPRESA.cpf_cnpj}`, empresa);
  else await nuvemFiscal('POST', '/empresas', empresa);
  console.log(`1/4 empresa ${existe ? 'atualizada' : 'cadastrada'}`);

  // 2. certificado A1
  const arquivo = process.env.CERTIFICADO_ARQUIVO || 'certificado/ponto-certo.pfx';
  const senha = precisa('CERTIFICADO_SENHA');
  const enviar = (buf) => nuvemFiscal('PUT', `/empresas/${EMPRESA.cpf_cnpj}/certificado`, { certificado: buf.toString('base64'), password: senha });
  let cert;
  try {
    cert = await enviar(readFileSync(arquivo));
  } catch (e) {
    if (!(e instanceof ErroNuvemFiscal) || e.statusOriginal >= 500) throw e;
    console.log(`    certificado recusado como está (${e.message}); reempacotando com openssl…`);
    cert = await enviar(pfxModerno(arquivo, senha));
  }
  console.log(`2/4 certificado instalado: ${cert.nome_razao_social || cert.subject_name || ''} válido até ${cert.not_valid_after || '?'}`);

  // 3. NFC-e (CSC) e NF-e
  await nuvemFiscal('PUT', `/empresas/${EMPRESA.cpf_cnpj}/nfce`, {
    CRT: EMITENTE.crt, ambiente, sefaz: { id_csc: Number(precisa('NFCE_ID_CSC')), csc: precisa('NFCE_CSC') },
  });
  await nuvemFiscal('PUT', `/empresas/${EMPRESA.cpf_cnpj}/nfe`, { CRT: EMITENTE.crt, ambiente });
  console.log(`3/4 NFC-e e NF-e configuradas (Simples Nacional, ${ambiente})`);

  // 4. SEFAZ respondendo?
  for (const t of ['nfce', 'nfe']) {
    const s = await nuvemFiscal('GET', `/${t}/sefaz/status?cpf_cnpj=${EMPRESA.cpf_cnpj}`);
    console.log(`4/4 SEFAZ ${t.toUpperCase()} (${s.autorizador || ''}, ${s.ambiente}): ${s.codigo_status} ${s.motivo_status}`);
  }
  console.log(`\nPronto. Agora defina o mesmo ambiente no ERP (Notas Fiscais > Configuração): ${ambiente}.`);
}

principal().catch((e) => { console.error('\nERRO:', e.message); process.exit(1); });
