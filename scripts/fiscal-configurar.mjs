#!/usr/bin/env node
// Cadastra/atualiza a Ponto Certo na Focus NFe: dados do emitente, certificado A1, CSC da NFC-e e séries.
// Usa o token PRINCIPAL da conta (FOCUS_TOKEN). O certificado vai direto do PC para a Focus.
// Os tokens de emissão devolvidos (homologação e produção) são gravados no .env.
//
//   npm run fiscal:configurar               cadastra/atualiza
//   npm run fiscal:configurar -- --simular  só valida (dry_run da Focus), não grava nada
//
// .env: FOCUS_TOKEN, CERTIFICADO_ARQUIVO, CERTIFICADO_SENHA, NFCE_ID_CSC, NFCE_CSC, [NFCE_ID_CSC_HOMOLOGACAO,
//       NFCE_CSC_HOMOLOGACAO], [EMPRESA_EMAIL]
import 'dotenv/config';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { focus, ErroFocus } from '../api/_lib/fiscal/focus.js';
import { EMITENTE } from '../api/_lib/fiscal/montar.js';

const SIMULAR = process.argv.includes('--simular');
const precisa = (k) => { const v = process.env[k]; if (!v) throw new Error(`Defina ${k} no .env`); return v; };
const token = precisa('FOCUS_TOKEN');
const api = (metodo, caminho, corpo) => focus('producao', metodo, caminho, corpo, { token }); // API de empresas: só no host de produção

/** O .pfx da Ponto Certo usa RC2-40 (antigo); se a Focus recusar, reempacota com AES via openssl. */
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

function gravarEnv(valores) {
  let env = readFileSync('.env', 'utf8');
  for (const [k, v] of Object.entries(valores)) {
    if (!v) continue;
    env = new RegExp(`^${k}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : `${env.trimEnd()}\n${k}=${v}\n`;
  }
  writeFileSync('.env', env);
}

async function principal() {
  const arquivo = process.env.CERTIFICADO_ARQUIVO || 'certificado/ponto-certo.pfx';
  const senha = precisa('CERTIFICADO_SENHA');
  // Dados do emitente conforme PARAMETROSNFE do DirectControl. Séries próprias do ERP (o DirectControl usa
  // NF-e 1 e NFC-e 3/5); a numeração é enviada pelo ERP em cada nota.
  const empresa = {
    nome: 'PONTO CERTO COMERCIO DE FERRAGENS LTDA', nome_fantasia: 'PONTO CERTO FERRAGENS', cnpj: EMITENTE.cnpj,
    inscricao_estadual: '0290521327', regime_tributario: 1,
    logradouro: 'RUA THEREZA DALCANALI ZUGNO', numero: '280', bairro: 'PLANALTO RIO BRANCO', municipio: 'CAXIAS DO SUL',
    cep: '95096761', uf: 'RS', habilita_nfe: true, habilita_nfce: true, discrimina_impostos: false,
    csc_nfce_producao: precisa('NFCE_CSC'), id_token_nfce_producao: Number(precisa('NFCE_ID_CSC')),
    serie_nfe_producao: '2', serie_nfe_homologacao: '2', serie_nfce_producao: '10', serie_nfce_homologacao: '10',
  };
  if (process.env.EMPRESA_EMAIL) empresa.email = process.env.EMPRESA_EMAIL;
  if (process.env.NFCE_CSC_HOMOLOGACAO) {
    empresa.csc_nfce_homologacao = process.env.NFCE_CSC_HOMOLOGACAO;
    empresa.id_token_nfce_homologacao = Number(process.env.NFCE_ID_CSC_HOMOLOGACAO || 1);
  }

  const lista = await api('GET', `/v2/empresas?cnpj=${EMITENTE.cnpj}`);
  const existente = Array.isArray(lista) ? lista.find((e) => String(e.cnpj).replace(/\D/g, '') === EMITENTE.cnpj) : null;
  console.log(`Focus NFe: empresa ${existente ? `já cadastrada (id ${existente.id})` : 'ainda não cadastrada'}${SIMULAR ? '  |  SIMULAÇÃO' : ''}`);

  const salvar = async (pfx) => {
    const corpo = { ...empresa, arquivo_certificado_base64: pfx.toString('base64'), senha_certificado: senha };
    const q = SIMULAR ? '?dry_run=1' : '';
    return existente ? api('PUT', `/v2/empresas/${existente.id}${q}`, corpo) : api('POST', `/v2/empresas${q}`, corpo);
  };
  let r;
  try {
    r = await salvar(readFileSync(arquivo));
  } catch (e) {
    if (!(e instanceof ErroFocus) || !/certificado/i.test(e.message)) throw e;
    console.log(`  certificado recusado como está (${e.message}); reempacotando com openssl…`);
    r = await salvar(pfxModerno(arquivo, senha));
  }

  console.log(`  ${SIMULAR ? 'validação ok' : existente ? 'empresa atualizada' : 'empresa cadastrada'}: ${r.nome || empresa.nome}`);
  if (r.certificado_valido_ate) console.log(`  certificado de ${r.certificado_cnpj || '?'} válido até ${r.certificado_valido_ate}`);
  console.log(`  NFC-e: ${r.habilita_nfce ? 'habilitada' : '?'} | CSC produção: ${r.csc_nfce_producao ? 'ok' : 'falta'} | CSC homologação: ${r.csc_nfce_homologacao ? 'ok' : 'não informado'}`);
  if (!SIMULAR && (r.token_homologacao || r.token_producao)) {
    gravarEnv({ FOCUS_TOKEN_HOMOLOGACAO: r.token_homologacao, FOCUS_TOKEN_PRODUCAO: r.token_producao });
    console.log('  tokens de emissão gravados no .env (FOCUS_TOKEN_HOMOLOGACAO / FOCUS_TOKEN_PRODUCAO)');
  }
}

principal().catch((e) => {
  console.error('\nERRO:', e.message);
  if (e.corpo?.erros) console.error(JSON.stringify(e.corpo.erros, null, 2));
  process.exit(1);
});
