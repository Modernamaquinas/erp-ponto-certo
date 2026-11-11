-- RLS do módulo fiscal (depende de 002 e 005). Emissão/cancelamento só pela API (service role).

alter table fiscal_config enable row level security;
alter table fiscal_numeracao enable row level security;  -- sem política: só service role
alter table notas_fiscais enable row level security;

create policy leitura on fiscal_config for select to authenticated using (pode_ler());
create policy admin_altera on fiscal_config for update to authenticated
  using (papel_atual() = 'admin') with check (papel_atual() = 'admin');

create policy leitura on notas_fiscais for select to authenticated using (pode_ler());

revoke execute on function reservar_numero_fiscal(int, int, text) from public, anon, authenticated;
