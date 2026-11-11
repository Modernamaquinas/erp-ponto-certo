-- Edição de produtos, clientes e fornecedores no ERP. Roda também no PGlite; permissões em 011.
-- Um registro alterado por um usuário do ERP fica marcado (alterado_erp) e a sincronização com o DirectControl
-- deixa de sobrescrever o cadastro dele (o estoque continua vindo do DirectControl até a virada).

alter table produtos add column alterado_erp boolean not null default false;
alter table clientes add column alterado_erp boolean not null default false;
alter table fornecedores add column alterado_erp boolean not null default false;

-- Marca só quando quem altera é um usuário do ERP (papel "authenticated" do Supabase) e só se mudou algo além das
-- colunas listadas em TG_ARGV (ex.: dados de cobrança do cliente, que já são do ERP).
create or replace function marca_alterado_erp() returns trigger
language plpgsql as $$
declare ignorar text[] := array['atualizado_em', 'busca', 'alterado_erp'] || tg_argv;
begin
  if current_user = 'authenticated' and (to_jsonb(new) - ignorar) is distinct from (to_jsonb(old) - ignorar) then
    new.alterado_erp := true;
  end if;
  return new;
end $$;

create trigger produtos_alterado_erp before update on produtos for each row
  execute function marca_alterado_erp('estoque', 'data_ultima_saida', 'data_ultima_entrada');
create trigger clientes_alterado_erp before update on clientes for each row
  execute function marca_alterado_erp('email_cobranca', 'celular_cobranca', 'cobranca_ativa', 'obs_cobranca', 'asaas_customer_id', 'ultima_compra');
create trigger fornecedores_alterado_erp before update on fornecedores for each row
  execute function marca_alterado_erp();
