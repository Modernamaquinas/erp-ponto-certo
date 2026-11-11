# Emissão de NFC-e e NF-e (SEFAZ-RS via Focus NFe)

A Nuvem Fiscal, escolhida antes, foi desativada em 2026 depois de ser comprada pelo ACBr. O provedor agora é a
**Focus NFe** (https://doc.focusnfe.com.br, API v2).

## Como funciona
- O ERP monta a nota no formato da Focus (`api/_lib/fiscal/montar.js`) e envia para ela
  (`api/_lib/fiscal/focus.js`). A Focus assina com o certificado A1, transmite à SEFAZ-RS e gera o DANFE
  (PDF para NF-e, HTML para NFC-e).
- Autenticação HTTP Basic: o token é o usuário e a senha fica vazia. Há três tokens:
  - `FOCUS_TOKEN`: token principal da conta. Serve só para o cadastro da empresa (API de empresas, que só
    existe no host de produção). Fica só no `.env` local.
  - `FOCUS_TOKEN_HOMOLOGACAO` e `FOCUS_TOKEN_PRODUCAO`: tokens **da empresa**, usados na emissão. Ficam no
    `.env` e na Vercel. O ambiente da nota segue **Notas Fiscais → Configuração**.
- Certificado A1 e CSC ficam guardados na Focus. Quem os envia é `npm run fiscal:configurar`, rodado no PC que
  tem `certificado/ponto-certo.pfx`. Essa pasta está no `.gitignore`.
- A referência da nota na Focus é `notas_fiscais.referencia` (`pc-<modelo>-<série>-<número>-<h|p><tentativa>`).
  A numeração é do ERP e vai nos campos `numero` e `serie`.
- A NFC-e é síncrona. A NF-e é assíncrona: o ERP espera até cerca de 18 s e, se ainda estiver processando,
  a nota aparece como "Processando" com o botão Consultar.
- Regras da Ponto Certo, iguais às do DirectControl:
  - Simples Nacional;
  - CSOSN 102 (CFOP 5102) ou 500 (CFOP 5405); 300, 400 e 900 também são aceitos;
  - PIS/COFINS com CST 99 e valor zero;
  - tributos aproximados (IBPT) calculados pelo ERP (`discrimina_impostos` desligado na Focus);
  - na NF-e para fora do RS, o CFOP 5xxx vira 6xxx.
- **Séries do ERP:** NFC-e série 10 e NF-e série 2. O DirectControl usa NF-e série 1 e NFC-e séries 3 e 5.
- **Numeração:** `reservar_numero_fiscal`. Uma nota recusada (pela Focus ou pela SEFAZ) devolve o número, que é
  usado na próxima. Se não houver resposta (status `erro`), use "Consultar" antes de emitir de novo.

## Situação em 11/11/2026
- A empresa está cadastrada na Focus pelo script, com certificado (válido até 12/06/2027), CSC de produção (id 1)
  e séries 10/2.
- Teste na SEFAZ-RS de **homologação**, feito fora do ERP, com números 999001:
  - NF-e e NFC-e autorizadas (código 100);
  - DANFE e XML baixados;
  - as duas canceladas (código 135).
- Não foi informado CSC de homologação, e a NFC-e foi autorizada mesmo assim. Se a SEFAZ passar a exigir, gere
  o CSC de homologação no portal da SEFAZ-RS e preencha `NFCE_CSC_HOMOLOGACAO` / `NFCE_ID_CSC_HOMOLOGACAO`.

## Passos que faltam
1. Na Vercel, cadastre `FOCUS_TOKEN_HOMOLOGACAO` e `FOCUS_TOKEN_PRODUCAO` (os valores estão no `.env`) e faça o
   redeploy.
2. No ERP, em **Notas Fiscais**:
   - clique em "Verificar conexão";
   - emita uma NFC-e e uma NF-e de teste;
   - abra o DANFE;
   - cancele as duas.
3. Para valer de verdade: **Configuração → Ambiente → Produção** (só o admin vê essa aba).

## Cuidados
- Enquanto o caixa estiver no DirectControl, não emita no ERP uma nota de venda que já saiu com NFC-e lá.
- Prazos de cancelamento: NFC-e até 30 minutos, NF-e até 24 horas. Depois disso, só com nota de devolução,
  que ainda não está no ERP.
- O certificado vence em 12/06/2027. Para renovar, troque o arquivo e rode `npm run fiscal:configurar` de novo.
  Use `-- --simular` para validar antes.
- Produto sem NCM, ou com CSOSN 101/201/202, é barrado antes de gastar número.
