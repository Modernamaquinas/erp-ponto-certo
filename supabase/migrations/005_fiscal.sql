-- ERP Ponto Certo — emissão de NFC-e (modelo 65) e NF-e (modelo 55) pela API da Nuvem Fiscal.
-- Certificado A1 e CSC ficam na Nuvem Fiscal (instalados por scripts/fiscal-configurar.mjs), nunca no banco.
-- Roda também no PGlite; o RLS fica em 006_fiscal_seguranca.sql.

-- Dados fiscais do produto que faltavam (origem e % de tributos aproximados — Lei 12.741/IBPT, por NCM)
alter table produtos add column origem int not null default 0 check (origem between 0 and 8);
alter table produtos add column ibpt_federal numeric(7,3);
alter table produtos add column ibpt_estadual numeric(7,3);
alter table produtos add column ibpt_municipal numeric(7,3);

-- Configuração única. Séries próprias do ERP (o DirectControl usa NF-e série 1 e NFC-e séries 3 e 5):
-- enquanto os dois sistemas emitem, a numeração de um nunca colide com a do outro.
create table fiscal_config (
  id                 int primary key default 1 check (id = 1),
  ambiente           text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  serie_nfce         int not null default 10 check (serie_nfce between 1 and 889),
  serie_nfe          int not null default 2 check (serie_nfe between 1 and 889),
  natureza_operacao  text not null default 'VENDA DE MERCADORIA',
  inf_complementar   text,
  atualizado_em      timestamptz not null default now()
);
insert into fiscal_config (id) values (1);
create trigger fiscal_config_toca before update on fiscal_config for each row execute function toca_atualizado_em();

create table fiscal_numeracao (
  modelo    int not null check (modelo in (55, 65)),
  serie     int not null,
  ambiente  text not null check (ambiente in ('homologacao', 'producao')),
  proximo   int not null default 1 check (proximo between 1 and 999999999),
  primary key (modelo, serie, ambiente)
);

create table notas_fiscais (
  id                 bigint primary key generated always as identity,
  modelo             int not null check (modelo in (55, 65)),
  serie              int not null,
  numero             int not null,
  ambiente           text not null check (ambiente in ('homologacao', 'producao')),
  tentativa          int not null default 1,
  status             text not null default 'processando'
                     check (status in ('processando', 'autorizada', 'rejeitada', 'denegada', 'cancelada', 'erro')),
  numero_reaproveitado boolean not null default false,  -- rejeitada cujo número já foi usado de novo
  venda_id           bigint references vendas(id),
  cliente_id         bigint references clientes(id),
  destinatario_nome  text,
  destinatario_doc   text,
  valor_total        numeric(14,2) not null,
  chave              text,
  protocolo          text,
  provedor_id        text unique,                       -- id da Nuvem Fiscal
  referencia         text not null unique,
  codigo_status      int,
  motivo             text,
  payload            jsonb,                             -- o que foi enviado (auditoria / reemissão)
  emitida_em         timestamptz,
  cancelada_em       timestamptz,
  justificativa_cancelamento text,
  usuario            text,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
-- uma nota válida por número; tentativas rejeitadas do mesmo número convivem
create unique index notas_fiscais_numero on notas_fiscais (modelo, serie, numero, ambiente)
  where status not in ('rejeitada', 'erro');
create index notas_fiscais_criado on notas_fiscais (criado_em desc);
create index notas_fiscais_venda on notas_fiscais (venda_id);
create trigger notas_fiscais_toca before update on notas_fiscais for each row execute function toca_atualizado_em();

-- Reserva o número da próxima nota. Número de nota rejeitada (que não chegou a existir na SEFAZ) é reaproveitado
-- antes de avançar a sequência, para não abrir buraco na numeração (que exigiria inutilização).
create or replace function reservar_numero_fiscal(p_modelo int, p_serie int, p_ambiente text)
returns table (numero int, tentativa int)
language plpgsql as $$
#variable_conflict use_column
declare v_nota bigint; v_num int; v_tent int;
begin
  select n.id, n.numero into v_nota, v_num from notas_fiscais n
   where n.modelo = p_modelo and n.serie = p_serie and n.ambiente = p_ambiente
     and n.status = 'rejeitada' and not n.numero_reaproveitado
     and not exists (select 1 from notas_fiscais o where o.modelo = n.modelo and o.serie = n.serie
                     and o.ambiente = n.ambiente and o.numero = n.numero and o.status not in ('rejeitada', 'erro'))
   order by n.numero limit 1 for update skip locked;
  if v_nota is not null then
    update notas_fiscais set numero_reaproveitado = true
     where modelo = p_modelo and serie = p_serie and ambiente = p_ambiente and numero = v_num and status = 'rejeitada';
    select coalesce(max(n.tentativa), 0) + 1 into v_tent from notas_fiscais n
     where n.modelo = p_modelo and n.serie = p_serie and n.ambiente = p_ambiente and n.numero = v_num;
    return query select v_num, v_tent;
    return;
  end if;
  insert into fiscal_numeracao (modelo, serie, ambiente) values (p_modelo, p_serie, p_ambiente) on conflict do nothing;
  update fiscal_numeracao f set proximo = f.proximo + 1
   where f.modelo = p_modelo and f.serie = p_serie and f.ambiente = p_ambiente
  returning f.proximo - 1 into v_num;
  return query select v_num, 1;
end $$;
