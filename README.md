# ERP Ponto Certo

Sistema de gestão web da **Ponto Certo Comércio de Ferragens Ltda** (CNPJ 11.877.694/0001-66), substituindo
o DirectControl (Acertsoft) em fases, com cobrança do crediário pelo **Asaas** (boleto + PIX, baixa automática).

Stack: React + Vite (frontend) · Supabase/Postgres (dados, login, RLS) · funções serverless na Vercel (`api/`).

## Fases

| Fase | O que roda no ERP | O que continua no DirectControl |
|---|---|---|
| **1 (esta)** | Painel, crediário/contas a receber, **cobrança Asaas**, contas a pagar, consultas de clientes, produtos, fornecedores, vendas, compras e caixa | PDV, NFC-e/NF-e, TEF, cadastro de produtos/preços/clientes |
| 2 | PDV web, NFC-e e NF-e por API fiscal (Focus NFe / Nuvem Fiscal), cadastros editáveis, entrada de notas por XML | — |
| 3 | Desligar o DirectControl | — |

Na Fase 1, o DirectControl é **só lido** (nunca alterado). Uma sincronização a cada 15 min traz as novidades
para o ERP.

## Implantação (passo a passo)

1. **Supabase**: crie um projeto (região São Paulo) e rode, no SQL Editor, `supabase/migrations/001_schema.sql`
   e depois `002_seguranca.sql`, `003_cartoes.sql`, `004_cartoes_seguranca.sql`, `005_fiscal.sql` e `006_fiscal_seguranca.sql` (ou, com `DATABASE_URL` no
   `.env`: `node scripts/aplicar-sql.mjs supabase/migrations/00X_....sql`).
2. **`.env`**: copie `.env.example` para `.env` e preencha (chaves do Supabase, `DATABASE_URL`, Asaas).
3. **Instale**: `npm install`.
4. **Primeiro administrador**: `node scripts/criar-admin.mjs voce@email.com "SenhaForte123" "Seu Nome"`.
5. **Carga inicial** (num computador da loja, que enxerga o servidor `DESKTOP-8LQ068N`):
   `npm run migrar`. Ela lê tudo e confere os totais (títulos em aberto, vendas, estoque, clientes) entre
   origem e destino, inclusive as transações TEF aprovadas.
   Para testar a partir de um backup `.gbk`, restaure-o antes com
   `gbak -c -user SYSDBA -password masterkey backup.gbk localhost:C:\caminho\copia.fdb` e rode
   `npm run migrar -- --fdb "C:\caminho\copia.fdb"`.
6. **Sincronização automática** (no mesmo computador da loja):
   `powershell -ExecutionPolicy Bypass -File scripts\migracao\agendar-sincronizacao.ps1`.
7. **Vercel**: importe o projeto (framework Vite) e cadastre as variáveis do `.env` (todas, exceto as de
   Firebird/`DATABASE_URL`).
8. **Asaas**: em *Integrações > Webhooks*, cadastre `https://SEUDOMINIO/api/asaas-webhook` com o token de
   `ASAAS_WEBHOOK_TOKEN`, eventos de **Cobranças**. Teste em `ASAAS_AMBIENTE=sandbox` antes de trocar para
   `producao`. As notificações ao cliente (e-mail/SMS/WhatsApp) e a régua de cobrança são configuradas no
   painel do Asaas.

## Rotina da Fase 1

- **Fechamento do crediário** (Contas a Receber): gera *uma* cobrança por cliente com todos os títulos em
  aberto até a data escolhida. O Asaas avisa o cliente e, quando ele paga, os títulos são baixados sozinhos.
- **Baixas a repetir no DirectControl** (Cobranças): o que foi pago pelo Asaas ou baixado no ERP ainda
  aparece em aberto no DirectControl. É preciso dar a baixa lá também, para o caixa não cobrar de novo. A
  lista some sozinha quando a sincronização encontra o título quitado.
- **Conflitos** (Cobranças): se um título com cobrança Asaas for pago no balcão, o ERP avisa para cancelar a
  cobrança.
- **Contas a pagar herdadas**: o DirectControl nunca registrou pagamentos de contas a pagar. As 2.159 contas
  vencidas vieram marcadas como "conferir" e podem ser baixadas em lote (Contas a Pagar > Herdadas sem baixa).

## Desenvolvimento

- `npm run dev`: só o frontend. `npx vercel dev`: frontend + `api/`.
- `npm test`: testes de conversão e de segurança (RLS) num Postgres embutido (PGlite).
  `FDB_TESTE="C:\...\copia.fdb" npm test` inclui a migração completa real, com conferência de totais.
- Mapa DirectControl → ERP: `scripts/migracao/tabelas.mjs`.
