# Emissão de NFC-e e NF-e (SEFAZ-RS via Nuvem Fiscal)

## Como funciona
- O ERP monta a nota (`api/_lib/fiscal/montar.js`) no layout 4.00 da SEFAZ e envia para a **Nuvem Fiscal**,
  que assina com o certificado A1, transmite à SEFAZ-RS e gera o DANFE/DANFCE.
- O **certificado A1** e o **CSC da NFC-e** ficam guardados na Nuvem Fiscal. Eles não passam pela Vercel e
  não ficam no banco. Quem os envia é `npm run fiscal:configurar`, rodado no PC que tem o arquivo
  `certificado/ponto-certo.pfx`. Essa pasta está no `.gitignore`.
- Regras da Ponto Certo, iguais às do DirectControl:
  - Simples Nacional (CRT 1).
  - CSOSN 102 (CFOP 5102) ou 500 (CFOP 5405).
  - PIS/COFINS com CST 99 e valor zero.
  - Tributos aproximados (IBPT) por NCM.
  - Na NF-e para fora do RS, o CFOP 5xxx vira 6xxx.
- **Séries próprias do ERP:** NFC-e série 10 e NF-e série 2. O DirectControl usa NF-e série 1 e NFC-e séries
  3 e 5. Assim os dois sistemas podem emitir ao mesmo tempo sem colidir na numeração.
- **Numeração:** `reservar_numero_fiscal`. Quando a SEFAZ rejeita uma nota, o número dela é reaproveitado
  na próxima, para não abrir buraco. Se a SEFAZ não responder (status `erro`), use "Consultar" antes de
  emitir de novo.

## Dados vindos do DirectControl
- Emitente, conforme `PARAMETROSNFE`:
  - CNPJ 11.877.694/0001-66, IE 0290521327, Caxias do Sul/RS (IBGE 4305108);
  - regime Simples Nacional;
  - CSC da NFC-e: id 1. O código foi copiado para `NFCE_CSC` no `.env` local.
- Certificado: e-CNPJ A1, válido até 12/06/2027.
- Produtos:
  - NCM e CEST vêm da tabela `NCM` (`PRODUTOS_IMPOSTOS.NCM` está quase sempre vazio);
  - origem vem de `CST1`;
  - CSOSN vem de `CST2`;
  - percentuais IBPT vêm da tabela `NCM`.

## Instalação (uma vez)
1. Crie a conta em nuvemfiscal.com.br. Em **Credenciais de API**, gere o *client id* e o *client secret*.
2. Preencha no `.env` local: `NUVEMFISCAL_CLIENT_ID`, `NUVEMFISCAL_CLIENT_SECRET` e `EMPRESA_EMAIL` (o e-mail
   que vai no cadastro da empresa). A senha do certificado e o CSC já estão lá.
3. Rode `npm run fiscal:configurar`. Ele cadastra a empresa, instala o certificado, configura a NFC-e (com o
   CSC) e a NF-e em **homologação**, e consulta o status da SEFAZ.
4. Na Vercel, cadastre `NUVEMFISCAL_CLIENT_ID`, `NUVEMFISCAL_CLIENT_SECRET` e `NUVEMFISCAL_API=producao`, e
   faça o redeploy.
5. No ERP, em **Notas Fiscais**:
   - clique em "Verificar SEFAZ";
   - emita uma NFC-e e uma NF-e de teste;
   - confira o DANFE;
   - teste o cancelamento.
6. Para começar a valer de verdade:
   - rode `npm run fiscal:configurar -- producao`;
   - no ERP, mude **Configuração → Ambiente** para Produção (só o admin vê essa aba).

## Cuidados
- Enquanto o caixa estiver no DirectControl, não emita no ERP uma nota de venda que já saiu com NFC-e lá.
- Prazos de cancelamento: NFC-e até 30 minutos, NF-e até 24 horas. Depois disso, só com nota de devolução,
  que ainda não está no ERP.
- O certificado vence em 12/06/2027. Para renovar, troque o arquivo e rode `npm run fiscal:configurar` de novo.
- Produto sem NCM, ou com CSOSN 101/201/202, é barrado antes de gastar número. Corrija o cadastro no
  DirectControl, e a sincronização traz a correção.
