# TEF (Cielo e demais adquirentes) — como está e o que falta para a Fase 2

## Como funciona hoje (DirectControl)

O caixa usa **TEF PayGo Web** (Setis), pelo componente ACBr do DirectControl (`PGWebLib.dll`, servidor
`pos-transac.pgweb.io:31735`, ponto de captura 70862). O PayGo é **multi-adquirente**: o mesmo PinPad
passa Cielo, PagSeguro, Stone, Vero (Banrisul) e PIX pela Shipay. A Cielo entrou em 2026.

No banco, cada tentativa fica em `TEF_TRANSACAO` (26 mil linhas até 06/11/2026). Aprovada = adquirente +
autorização com `HEADER/STATUS` `CNF/0` (formato antigo) ou `CRT/2` (atual). `77`/`3` = "operação cancelada".
`DATA_HORA_LOCAL` é `DDMMhhmmss`, sem ano (ver `dataHoraTef` em `scripts/migracao/transformar.mjs`).

## O que o ERP já tem (Fase 1)

- `tef_transacoes`: o histórico do DirectControl, sincronizado como as vendas (`--incremental` relê a janela).
  A conferência da carga completa compara a quantidade e o valor das aprovadas.
- `cartao_taxas`: taxa (MDR) e prazo por adquirente, modalidade e faixa de parcelas. Cadastro na tela
  **Cartões e PIX → Taxas**. As taxas da Cielo estão no contrato ou no app/site Cielo ("Taxas e tarifas").
- `v_cartoes_recebiveis`: uma linha por parcela, com bruto, líquido e data prevista. Parcelado pela loja
  cai mês a mês; pela administradora, de uma vez. Sem taxa cadastrada, o líquido fica nulo e o prazo é o padrão.
- `pdv_registrar_tef(jsonb)`: por onde o PDV do ERP grava o resultado do TEF (qualquer usuário ativo).
  Um cancelamento aprovado marca a original como `cancelada`, e a re-sincronização não desfaz isso.
- `src/lib/tef.js`: o cliente que o PDV vai usar para falar com o agente do caixa. Tem modo simulador
  (`VITE_TEF_MODO=simulador`).

## Fase 2: agente TEF no PC do caixa

O ERP roda no navegador, e o navegador não acessa a DLL do PayGo nem o PinPad. Por isso a Fase 2 precisa de
um **agente local**: um programa pequeno no Windows do caixa que carrega a `PGWebLib.dll` e atende em
`http://127.0.0.1:7171`.

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /status` | — | `{ ok, gerenciador, versao, pinpad }` |
| `POST /pagamento` | `{ valor, modalidade, parcelas, venda_id, operador }` | `{ id, situacao, rede, modalidade, bandeira, parcelas, valor, nsu, autorizacao, cnpj_adquirente, mensagem, comprovante }` |
| `POST /confirmar` | `{ id }` | `{ ok }` |
| `POST /desfazer` | `{ id }` | `{ ok }` |
| `POST /cancelamento` | `{ nsu, valor, data, rede }` | o mesmo formato de `/pagamento` |

As modalidades são `debito`, `credito`, `credito_parcelado_loja`, `credito_parcelado_adm`, `pix` e `voucher`.
Erros vêm como HTTP 4xx/5xx com `{ mensagem }`.

O pagamento é feito em duas etapas, como o PayGo exige:
1. `/pagamento` aprova e deixa a transação pendente.
2. O PDV grava a venda e emite a NFC-e.
3. O PDV chama `/confirmar`. Se algo falhou no passo 2, chama `/desfazer`. Sem confirmação, o PayGo desfaz
   sozinho e estorna o cliente.

Depois o PDV chama `registrarTef()`, que grava o resultado em `tef_transacoes`.

O agente também precisa:
- responder ao preflight CORS do Chrome com `Access-Control-Allow-Private-Network: true`, porque um site
  https chamando 127.0.0.1 passa pelo Private Network Access;
- aceitar só a origem `https://erp-ponto-certo.vercel.app`.

## Pendências fora do código (para a Fase 2)

1. **Homologação no PayGo.** O PayGo da loja está registrado com a AcertSoft como software house
   (`TEF_CONFIGURACAO.SOFTWARE_HOUSE`). Para o ERP usar o PayGo, ele precisa de cadastro e homologação
   próprios na Setis/PayGo, com ponto de captura e credenciais de homologação. Isso é pedido ao suporte
   comercial do PayGo.
2. **Taxas da Cielo** (e das demais adquirentes) cadastradas na tela, para a previsão de recebimento valer.
3. **Conciliação** com o extrato da Cielo (EDI ou API do Cielo Conciliador). Depende de a Cielo liberar o
   acesso ao estabelecimento. Fica para depois do PDV.
