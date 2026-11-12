-- Etiquetas (depende de 002 e 012): todos os usuários leem e imprimem; só o admin altera modelos.
alter table etiqueta_modelos enable row level security;
alter table etiqueta_campos enable row level security;

create policy leitura on etiqueta_modelos for select to authenticated using (pode_ler());
create policy leitura on etiqueta_campos for select to authenticated using (pode_ler());

create policy admin_insere on etiqueta_modelos for insert to authenticated with check (papel_atual() = 'admin');
create policy admin_altera on etiqueta_modelos for update to authenticated using (papel_atual() = 'admin') with check (papel_atual() = 'admin');
create policy admin_exclui on etiqueta_modelos for delete to authenticated using (papel_atual() = 'admin');
create policy admin_insere on etiqueta_campos for insert to authenticated with check (papel_atual() = 'admin');
create policy admin_altera on etiqueta_campos for update to authenticated using (papel_atual() = 'admin') with check (papel_atual() = 'admin');
create policy admin_exclui on etiqueta_campos for delete to authenticated using (papel_atual() = 'admin');

grant select, insert, update, delete on etiqueta_modelos, etiqueta_campos to authenticated;
